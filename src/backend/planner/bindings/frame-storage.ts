import type { Node } from "@tsonic/tsts";
import type { RustFrameCallableBinding, RustFrameCallableDefinition } from "../../../analysis/callables/frame-values.js";
import type { RustExpr, RustStmt, RustType } from "../../target-ast/nodes.js";
import { rustValueBlock } from "../../target-ast/value-block.js";
import type { RustValueFieldLocation } from "../objects/value-fields.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput } from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustFrameCallableTypes } from "../types/frame-callables.js";
import { rustCarrierHasCopyContract } from "../types/generic-requirements.js";
import { planRustFrameCallableEntry } from "../expressions/frame-callables.js";
import { planRustNonConsumingValue } from "../expressions/typed-locations.js";
import { rustSourceBindingFactKey } from "../../../analysis/facts/keys.js";
import { rustBindingStorageOperations, rustInlineBindingStoragePath, rustInlineBindingStorageType } from "../expressions/binding-storage.js";
import { rustFrameOwnerReference, type RustFrameOwner } from "../program/frame-owners.js";

export function rustFrameBindingType(binding: RustFrameCallableBinding, context: RustPlanContext): RustType | undefined {
  const type = binding.entry === undefined ? rustTypeFromCarrierInContext(binding.carrier, context)
    : rustFrameCallableTypes(binding.carrier, context)?.entryType;
  if (type === undefined) return undefined;
  const payload = binding.storage === "value" ? type : rustInlineBindingStorageType(binding.storage, type);
  return binding.initialization === "ready" ? payload
    : { kind: "named", path: "core::cell::OnceCell", genericArguments: [{ kind: "type", type: payload }] };
}

function frameBindingPayload(binding: RustFrameCallableBinding,
  owner: RustFrameOwner, context: RustPlanContext,
) {
  const field: RustExpr = { kind: "field", receiver: owner.expression, name: binding.fieldName };
  const cell: RustExpr = binding.initialization === "ready" ? field : { kind: "method-call", receiver: { kind: "method-call", receiver: field, method: "get", args: [] },
    method: "expect", args: [{ kind: "str-literal", value: "callable activation binding read before initialization" }] };
  const copy = binding.entry?.copy === true || binding.entry === undefined && rustCarrierHasCopyContract(binding.carrier, context);
  const operations = binding.storage === "value" ? undefined : rustBindingStorageOperations(binding.storage);
  const read: RustExpr = operations?.read(cell) ?? (copy ? cell
    : { kind: "method-call", receiver: cell, method: "clone", args: [] });
  return { field, cell, read, operations };
}

export function rustFrameBindingLocation(
  binding: RustFrameCallableBinding, owner: RustFrameOwner, context: RustPlanContext,
): RustValueFieldLocation {
  const { field, cell, read, operations } = frameBindingPayload(binding, owner, context);
  const types = binding.entry === undefined ? undefined : rustFrameCallableTypes(binding.carrier, context);
  return {
    bindings: [],
    read: binding.entry === undefined ? read : { kind: "call", path: "rt::FrameCallable::from_frame", args: [
      { kind: "call", path: "alloc::rc::Rc::clone", args: [rustFrameOwnerReference(owner)] }, read,
    ] },
    ...(binding.entry === undefined ? { withRead: (project: (value: RustExpr) => RustExpr | undefined) =>
      project(operations?.borrowedRead(cell) ?? cell) } : {}),
    write: value => operations?.write(cell, value),
    initialize: value => ({ kind: "macro-invocation", path: "assert", delimiter: "parentheses", args: [{
      kind: "method-call", receiver: { kind: "method-call", receiver: field, method: "set", args: [
        binding.storage === "value" ? value : { kind: "call", path: `${rustInlineBindingStoragePath(binding.storage)}::new`, args: [value] },
      ] }, method: "is_ok", args: [],
    }, { kind: "str-literal", value: "callable activation binding initialized twice" }] }),
    ...(types === undefined ? {} : { writeInput: (node: Node, value: RustExpr, inputContext: RustPlanContext): RustExpr | undefined => {
      const implementation = inputContext.input.program.callableValues.frames.implementationFor(node);
      if (!inputContext.input.program.callableValues.frames.isSameActivationInput(node, types.definition)) {
        inputContext.diagnostics.push(missingFactDiagnostic(diagnosticInput(inputContext, node),
          "rust.backend.frame-entry-input", "An internal frame slot requires exact same-activation input ownership."));
        return undefined;
      }
      if (implementation !== undefined) return planRustFrameCallableEntry(node, binding.carrier, inputContext);
      const declaration = inputContext.input.program.facts.getFact(node, rustSourceBindingFactKey)?.sourceDeclaration;
      const sourceBinding = declaration === undefined ? undefined : types.definition.bindings.find(selected =>
        selected.declaration === declaration && selected.entry === types.entry);
      if (sourceBinding !== undefined) return frameBindingPayload(sourceBinding, owner, inputContext).read;
      const borrowed: RustExpr = { kind: "method-call", receiver: planRustNonConsumingValue(node, value, inputContext), method: "entry", args: [] };
      return binding.entry?.copy === true ? { kind: "dereference", pointer: borrowed }
        : { kind: "method-call", receiver: borrowed, method: "clone", args: [] };
    }, invoke: (arguments_: readonly RustExpr[], invocationContext: RustPlanContext): RustExpr | undefined => {
      if (invocationContext.syntheticNames === undefined) return undefined;
      const entryName = allocateRustSyntheticName(invocationContext.syntheticNames, "frame_entry");
      return rustValueBlock([{ name: entryName, value: read }], { kind: "call", path: "rt::FrameCallableEntry::invoke", args: [
        { kind: "reference", expr: { kind: "path", path: entryName } }, rustFrameOwnerReference(owner),
        { kind: "tuple-literal", elements: arguments_ },
      ] });
    } }),
  };
}

export function rustFrameBindingContext(
  definition: RustFrameCallableDefinition, owner: RustFrameOwner,
  context: RustPlanContext,
): RustPlanContext {
  const frameOwners = new Map(context.frameOwners);
  frameOwners.set(definition, owner);
  const bindingLocations = new Map(context.bindingLocations);
  for (const binding of definition.bindings)
    bindingLocations.set(binding.declaration, rustFrameBindingLocation(binding, owner, context));
  return { ...context, frameOwners, bindingLocations };
}

export function prepareRustFrameScope(
  scope: Node, context: RustPlanContext,
): { readonly context: RustPlanContext; readonly statements: readonly RustStmt[] } | undefined {
  const definitions = context.input.program.callableValues.frames.definitions
    .filter(definition => definition.activation.kind === "lexical" && definition.activation.activationScope === scope &&
      !context.frameOwners?.has(definition));
  if (definitions.length === 0) return { context, statements: [] };
  if (definitions.length !== 1 || context.syntheticNames === undefined) return undefined;
  const definition = definitions[0]!;
  const carrier = definition.entries[0]?.implementations[0]?.carrier;
  const types = carrier === undefined ? undefined : rustFrameCallableTypes(carrier, context);
  if (types === undefined || types.frameType.kind !== "named") {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, scope), "rust.backend.frame-scope",
      "A callable activation requires its exact sealed native frame layout and hygienic scope."));
    return undefined;
  }
  const name = allocateRustSyntheticName(context.syntheticNames, "callable_frame");
  const owner = { expression: { kind: "path" as const, path: name }, borrowed: false };
  const selected = rustFrameBindingContext(definition, owner, context);
  const fields = definition.bindings.map(binding => {
    const parameter = binding.initialization === "ready" ? context.input.program.names.nameForDeclaration(binding.declaration) : undefined;
    const value: RustExpr | undefined = binding.initialization === "deferred"
      ? { kind: "call", path: "core::cell::OnceCell::new", args: [] }
      : parameter === undefined ? undefined : binding.storage === "value" ? { kind: "path", path: parameter }
        : { kind: "call", path: `${rustInlineBindingStoragePath(binding.storage)}::new`, args: [{ kind: "path", path: parameter }] };
    return value === undefined ? undefined : { name: binding.fieldName, value };
  });
  if (fields.some(field => field === undefined)) return undefined;
  const statements: RustStmt[] = [{ kind: "let", name, mutable: false, init: { kind: "call", path: "alloc::rc::Rc::new", args: [{
    kind: "struct-literal", path: types.frameType.path, fields: [
      { name: "counter", value: { kind: "call", path: "rt::FrameEntryCounter::new", args: [] } },
      ...fields as { readonly name: string; readonly value: RustExpr }[],
      ...(definition.environmentParameters.length === 0 ? [] : [{ name: "marker", value: { kind: "path" as const, path: "core::marker::PhantomData" } }]),
    ],
  }] } }];
  context.usedAliases?.add("rt");
  return { context: selected, statements };
}
