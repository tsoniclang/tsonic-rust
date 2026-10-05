import type { Node } from "@tsonic/tsts";
import type { RustClosureCaptureFact } from "../../../analysis/facts/operations/keys.js";
import type { RustExpr, RustType } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustCapturedFieldOwner } from "../objects/value-fields.js";
import { rustCapturedFieldLocation, rustCapturedFieldStorage, rustCapturedFieldType } from "../objects/captured-fields.js";
import { requireRustCarrierRequirements } from "../types/generic-requirements.js";
import { diagnosticInput, rustActiveErrorType } from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { closedMetadataEquals } from "../../../target-model/metadata/closed-data.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { substituteRustTargetGenerics } from "../../../target-model/types/index.js";
import { planExpression } from "./entry.js";
import { checkRustDataWrite } from "../objects/data-writes.js";
import { rustValueBlock } from "../../target-ast/value-block.js";
import { planRustReceiverAlias } from "../objects/polymorphism/receiver-aliases.js";

export function validateRustCapturedReceivers(
  node: Node, receivers: RustClosureCaptureFact["receivers"], context: RustPlanContext,
): boolean {
  const selected = context.input.program.objectRepresentations.receiverCaptures.receiversFor(node);
  const valid = selected.length === receivers.length && selected.every((source, index) => {
    const capture = receivers[index];
    const definition = capture === undefined ? undefined : context.input.program.projectTypes.definitionForCarrier(capture.carrier);
    const representation = context.input.program.objectRepresentations.representationFor(definition);
    return capture !== undefined && representation !== undefined && representation.kind !== "value" &&
      source.owner === capture.owner && source.reference === capture.reference &&
      source.references.length === capture.references.length && source.references.every((reference, offset) =>
        reference === capture.references[offset] &&
        rustTargetTypeRefEquals(context.input.program.facts.getRuntimeCarrierFact(reference)?.carrier, capture.carrier));
  });
  if (!valid) context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
    "rust.backend.receiver-capture", "A retained native receiver differs from its sealed owner, source references or carrier."));
  return valid;
}

export function planRustCapturedReceivers(
  node: Node, receivers: RustClosureCaptureFact["receivers"], creation: RustPlanContext,
  invocation: RustPlanContext, options: { readonly staticStorage: boolean; readonly sharedStateName?: string; readonly offset: number },
): { readonly bindings: readonly { readonly name: string; readonly value: RustExpr }[];
  readonly context: RustPlanContext } | undefined {
  if (!validateRustCapturedReceivers(node, receivers, creation)) return undefined;
  const bindings: { readonly name: string; readonly value: RustExpr }[] = [];
  const retained: RustExpr[] = [];
  for (const [index, capture] of receivers.entries()) {
    if (!requireRustCarrierRequirements(capture.carrier, options.staticStorage ? ["clone", "static"] : ["clone"],
      capture.reference, { ...creation, callableDeclaration: node })) return undefined;
    if (options.sharedStateName !== undefined) {
      retained.push({ kind: "field", receiver: { kind: "field", receiver: { kind: "path", path: options.sharedStateName }, name: "state" },
        name: String(options.offset + index) });
      continue;
    }
    if (creation.syntheticNames === undefined) return undefined;
    const source = planExpression(capture.reference, creation);
    const value = source === undefined ? undefined : creation.projectDispatchRoot === undefined ||
      creation.expressionOverrides?.has(capture.reference) === true ? source
      : planRustReceiverAlias(source, capture.carrier, capture.carrier, creation, true);
    if (value === undefined) {
      creation.diagnostics.push(missingFactDiagnostic(diagnosticInput(creation, capture.reference),
        "rust.backend.receiver-owner", "A lexical receiver capture lost its exact existing native ownership handle."));
      return undefined;
    }
    const name = allocateRustSyntheticName(creation.syntheticNames, "captured_receiver");
    bindings.push({ name, value });
    retained.push({ kind: "path", path: name });
  }
  return { bindings, context: rustCapturedReceiverContext(receivers, invocation, index => retained[index]!) };
}

export function rustCapturedReceiverContext(
  receivers: RustClosureCaptureFact["receivers"], context: RustPlanContext, ownerFor: (index: number) => RustExpr,
): RustPlanContext {
  if (receivers.length === 0) return context;
  const overrides = new Map(context.expressionOverrides ?? []);
  for (const [index, capture] of receivers.entries()) {
    const carrier = substituteRustTargetGenerics(capture.carrier, context.typeParameterSubstitutions ?? new Map(),
      context.lifetimeSubstitutions ?? new Map());
    for (const reference of capture.references) overrides.set(reference, {
      expression: ownerFor(index), carrier, valueForm: "storage",
    });
  }
  return { ...context, expressionOverrides: overrides, projectDispatchRoot: undefined };
}

export function rustCapturedReceiverFieldType(
  capture: RustClosureCaptureFact["receiverFields"][number], type: RustType, context: RustPlanContext,
): RustType {
  const owner = rustCapturedFieldType(capture.storage, type);
  return context.input.program.frozenDataWrites.retainsFieldIdentity(capture.declaration)
    ? { kind: "tuple", elements: [{ kind: "named", path: "rt::ObjectIdentity" }, owner] } : owner;
}

export function validateRustCapturedReceiverFields(
  node: Node, fields: RustClosureCaptureFact["receiverFields"], context: RustPlanContext,
): boolean {
  const selected = context.input.program.objectRepresentations.receiverCaptures.capturesFor(node);
  const valid = selected.length === fields.length && selected.every((source, index) => {
    const capture = fields[index];
    return capture !== undefined && source.declaration === capture.declaration && source.receiver === capture.receiver &&
      source.reference === capture.reference && source.references.length === capture.references.length &&
      source.references.every((reference, offset) => reference === capture.references[offset] &&
        rustTargetTypeRefEquals(context.input.program.facts.getRuntimeCarrierFact(reference)?.carrier, capture.carrier)) &&
      closedMetadataEquals(rustCapturedFieldStorage(capture.declaration, context), capture.storage);
  });
  if (!valid) context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
    "rust.backend.receiver-field-capture", "A live receiver field capture differs from its sealed source membership, carrier and physical storage."));
  return valid;
}

export function planRustCapturedReceiverFields(
  node: Node, fields: RustClosureCaptureFact["receiverFields"], creation: RustPlanContext,
  invocation: RustPlanContext, options: { readonly staticStorage: boolean; readonly sharedStateName?: string; readonly offset: number },
): { readonly bindings: readonly { readonly name: string; readonly value: RustExpr }[];
  readonly context: RustPlanContext } | undefined {
  const bindings: { readonly name: string; readonly value: RustExpr }[] = [];
  const retained: RustExpr[] = [];
  if (!validateRustCapturedReceiverFields(node, fields, creation)) return undefined;
  for (const [index, capture] of fields.entries()) {
    if (!requireRustCarrierRequirements(capture.carrier, options.staticStorage ? ["static"] : [], capture.reference, creation)) return undefined;
    if (options.sharedStateName !== undefined) {
      retained.push({ kind: "field", receiver: { kind: "field", receiver: { kind: "path", path: options.sharedStateName }, name: "state" },
        name: String(options.offset + index) });
      continue;
    }
    if (creation.syntheticNames === undefined) return undefined;
    const owner = planRustCapturedFieldOwner(capture.reference, creation);
    if (owner === undefined) {
      creation.diagnostics.push(missingFactDiagnostic(diagnosticInput(creation, capture.reference),
        "rust.backend.receiver-field-owner", "A live receiver field capture lost its exact initialized physical owner."));
      return undefined;
    }
    const name = allocateRustSyntheticName(creation.syntheticNames, "captured_field");
    const guarded = creation.input.program.frozenDataWrites.retainsFieldIdentity(capture.declaration);
    const receiver = guarded && creation.capturedFieldIdentities?.get(capture.reference) === undefined
      ? planExpression(capture.receiver, creation) : undefined;
    const identity = creation.capturedFieldIdentities?.get(capture.reference) ?? (receiver === undefined ? undefined
      : { kind: "call" as const, path: "rt::ObjectIdentityCarrier::object_identity",
        args: [{ kind: "reference" as const, expr: receiver }] });
    if (guarded && identity === undefined) {
      creation.diagnostics.push(missingFactDiagnostic(diagnosticInput(creation, capture.reference),
        "rust.backend.receiver-field-identity", "A frozen retained field requires its exact live object identity owner."));
      return undefined;
    }
    bindings.push({ name, value: guarded ? { kind: "tuple-literal", elements: [
      { kind: "method-call", receiver: identity!, method: "clone", args: [] }, owner,
    ] } : owner });
    retained.push({ kind: "path", path: name });
  }
  return { bindings, context: rustCapturedReceiverFieldContext(fields, invocation, index => retained[index]!) };
}

export function rustCapturedReceiverFieldContext(
  fields: RustClosureCaptureFact["receiverFields"], context: RustPlanContext,
  ownerFor: (index: number) => RustExpr,
): RustPlanContext {
  const locations = new Map(context.valueFieldLocations ?? []);
  const owners = new Map(context.capturedFieldOwners ?? []);
  const identities = new Map(context.capturedFieldIdentities ?? []);
  for (const [index, capture] of fields.entries()) {
    const retained = ownerFor(index);
    const guarded = context.input.program.frozenDataWrites.retainsFieldIdentity(capture.declaration);
    const identity: RustExpr = { kind: "field", receiver: retained, name: "0" };
    const owner: RustExpr = guarded ? { kind: "field", receiver: retained, name: "1" } : retained;
    const carrier = substituteRustTargetGenerics(capture.carrier, context.typeParameterSubstitutions ?? new Map(),
      context.lifetimeSubstitutions ?? new Map());
    for (const reference of capture.references) {
      owners.set(reference, owner);
      const location = rustCapturedFieldLocation(capture.storage, owner, carrier);
      if (guarded) identities.set(reference, identity);
      locations.set(reference, !guarded ? location : { ...location, write: (value, writeContext) => {
        const errorType = rustActiveErrorType(writeContext);
        if (errorType === undefined || writeContext.syntheticNames === undefined) return undefined;
        const name = allocateRustSyntheticName(writeContext.syntheticNames, "field_value");
        const effect = location.write({ kind: "path", path: name }, writeContext);
        return effect === undefined ? undefined : rustValueBlock([{ name, value }], checkRustDataWrite("receiver", identity, effect, errorType));
      } });
    }
  }
  return { ...context, valueFieldLocations: locations, capturedFieldOwners: owners, capturedFieldIdentities: identities };
}
