import type { Node } from "@tsonic/tsts";
import type { RustClosureCaptureFact } from "../../../target-model/records/operations/operation-selections.js";
import type { RustExpr, RustType } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustCapturedFieldOwner } from "../objects/value-fields.js";
import { rustCapturedFieldLocation, rustCapturedFieldType } from "../objects/captured-fields.js";
import { requireRustCarrierRequirements } from "../types/generic-requirements.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { substituteRustTargetGenerics } from "../../../target-model/types/index.js";
import { planExpression } from "./entry.js";
import { checkRustDataWrite } from "../objects/data-writes.js";
import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { planRustReceiverAlias } from "../objects/polymorphism/receiver-aliases.js";
import { cloneRustExpression } from "../../target-ast/syntax/expressions.js";

export function rustRecursiveReceiverFieldContext(
  field: NonNullable<RustClosureCaptureFact["recursiveField"]>, owner: RustExpr, context: RustPlanContext,
): RustPlanContext {
  const overrides = new Map(context.expressionOverrides ?? []);
  for (const reference of field.references) overrides.set(reference, {
    expression: owner, carrier: field.carrier, valueForm: "storage", storageForm: "plain",
  });
  return { ...context, expressionOverrides: overrides };
}

export function planRustCapturedReceivers(
  node: Node, receivers: RustClosureCaptureFact["receivers"], creation: RustPlanContext,
  invocation: RustPlanContext, options: { readonly staticStorage: boolean; readonly sharedStateName?: string; readonly offset: number },
): { readonly bindings: readonly { readonly name: string; readonly value: RustExpr }[];
  readonly context: RustPlanContext } | undefined {
  return planRustReceiverOwners(node, receivers, creation, invocation, options);
}

export function planRustReceiverOwners(
  node: Node, receivers: RustClosureCaptureFact["receivers"], creation: RustPlanContext,
  invocation: RustPlanContext, options: { readonly staticStorage: boolean; readonly sharedStateName?: string; readonly offset: number },
): { readonly bindings: readonly { readonly name: string; readonly value: RustExpr }[];
  readonly context: RustPlanContext } | undefined {
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
    const ownership = creation.input.program.records.captureOwnership.get(node)?.find(
      selected => selected.declaration === capture.owner && selected.reference === capture.reference);
    if (ownership === undefined) {
      failRustPlannerInvariant("An admitted lexical receiver capture requires its sealed native ownership operation.", capture.reference);
    }
    const source = planExpression(capture.reference, creation, "value", "shared-place");
    if (source === undefined) {
      failRustPlannerInvariant("An admitted lexical receiver capture requires its exact native ownership handle.", capture.reference);
    }
    const name = allocateRustSyntheticName(creation.syntheticNames, "captured_receiver");
    bindings.push({ name, value: ownership.read.kind === "clone" ? cloneRustExpression(source) : source });
    const retainedOwner: RustExpr = { kind: "path", path: name };
    if (creation.projectDispatchRoot === undefined || creation.expressionOverrides?.has(capture.reference) === true) {
      retained.push(retainedOwner);
      continue;
    }
    const alias = planRustReceiverAlias(retainedOwner, capture.carrier, capture.carrier, creation, true);
    if (alias === undefined) {
      failRustPlannerInvariant("An admitted lexical receiver capture requires its exact native receiver alias.", capture.reference);
    }
    const aliasName = allocateRustSyntheticName(creation.syntheticNames, "captured_receiver_alias");
    bindings.push({ name: aliasName, value: alias });
    retained.push({ kind: "path", path: aliasName });
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
      expression: ownerFor(index), carrier, valueForm: "storage", storageForm: "plain",
    });
  }
  return { ...context, expressionOverrides: overrides, projectDispatchRoot: undefined };
}

export function rustCapturedReceiverFieldType(
  capture: RustClosureCaptureFact["receiverFields"][number], type: RustType, context: RustPlanContext,
): RustType {
  const owner = rustCapturedFieldType(capture.storage, type);
  return capturedFieldIdentity(capture.declaration, capture.reference, context)
    ? { kind: "tuple", elements: [{ kind: "named", path: "rt::ObjectIdentity" }, owner] } : owner;
}

export function planRustCapturedReceiverFields(
  node: Node, fields: RustClosureCaptureFact["receiverFields"], creation: RustPlanContext,
  invocation: RustPlanContext, options: { readonly staticStorage: boolean; readonly sharedStateName?: string; readonly offset: number },
): { readonly bindings: readonly { readonly name: string; readonly value: RustExpr }[];
  readonly context: RustPlanContext } | undefined {
  return planRustReceiverFieldOwners(fields, creation, invocation, options, node);
}

export function planRustReceiverFieldOwners(
  fields: RustClosureCaptureFact["receiverFields"], creation: RustPlanContext,
  invocation: RustPlanContext, options: { readonly staticStorage: boolean; readonly sharedStateName?: string; readonly offset: number },
  closure?: Node,
): { readonly bindings: readonly { readonly name: string; readonly value: RustExpr }[];
  readonly context: RustPlanContext } | undefined {
  const bindings: { readonly name: string; readonly value: RustExpr }[] = [];
  const retained: RustExpr[] = [];
  // A closure's capture requirements are sealed with the closure's own contract, as for its receiver captures.
  const requirementContext = closure === undefined ? creation : { ...creation, callableDeclaration: closure };
  for (const [index, capture] of fields.entries()) {
    if (!requireRustCarrierRequirements(capture.carrier, options.staticStorage ? ["static"] : [], capture.reference, requirementContext)) return undefined;
    if (options.sharedStateName !== undefined) {
      retained.push({ kind: "field", receiver: { kind: "field", receiver: { kind: "path", path: options.sharedStateName }, name: "state" },
        name: String(options.offset + index) });
      continue;
    }
    if (creation.syntheticNames === undefined) return undefined;
    const owner = planRustCapturedFieldOwner(capture.reference, creation);
    if (owner === undefined) {
      failRustPlannerInvariant("An admitted live receiver field requires its exact initialized native owner.", capture.reference);
    }
    const name = allocateRustSyntheticName(creation.syntheticNames, "captured_field");
    const guarded = capturedFieldIdentity(capture.declaration, capture.reference, creation);
    const receiver = guarded && creation.capturedFieldIdentities?.get(capture.reference) === undefined
      ? planExpression(capture.receiver, creation) : undefined;
    const identity = creation.capturedFieldIdentities?.get(capture.reference) ?? (receiver === undefined ? undefined
      : { kind: "call" as const, path: "rt::ObjectIdentityCarrier::object_identity",
        args: [{ kind: "reference" as const, expr: receiver }] });
    if (guarded && identity === undefined) {
      failRustPlannerInvariant("An admitted frozen retained field requires its exact live object identity owner.", capture.reference);
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
    const guarded = capturedFieldIdentity(capture.declaration, capture.reference, context);
    const identity: RustExpr = { kind: "field", receiver: retained, name: "0" };
    const owner: RustExpr = guarded ? { kind: "field", receiver: retained, name: "1" } : retained;
    const carrier = substituteRustTargetGenerics(capture.carrier, context.typeParameterSubstitutions ?? new Map(),
      context.lifetimeSubstitutions ?? new Map());
    for (const reference of capture.references) {
      owners.set(reference, owner);
      const location = rustCapturedFieldLocation(capture.storage, owner, carrier, context);
      if (guarded) identities.set(reference, identity);
      locations.set(reference, !guarded ? location : { ...location, write: (value, writeContext) => {
        const region = writeContext.fallibleBoundary;
        if (region === undefined || writeContext.syntheticNames === undefined) return undefined;
        const name = allocateRustSyntheticName(writeContext.syntheticNames, "field_value");
        const effect = location.write({ kind: "path", path: name }, writeContext);
        const checked = effect === undefined ? undefined : checkRustDataWrite("receiver", identity, effect, region);
        return checked === undefined ? undefined : rustValueBlock([{ name, value }], checked);
      } });
    }
  }
  return { ...context, valueFieldLocations: locations, capturedFieldOwners: owners, capturedFieldIdentities: identities };
}

function capturedFieldIdentity(declaration: Node, reference: Node, context: RustPlanContext): boolean {
  return context.input.program.records.capturedFieldIdentity.get(declaration, reference)
    ?? failRustPlannerInvariant("An admitted retained field requires its selected native identity capture.", reference);
}
