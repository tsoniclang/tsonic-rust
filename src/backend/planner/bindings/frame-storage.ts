import type { Node } from "@tsonic/tsts";
import type { RustFrameCallableBinding, RustFrameCallableDefinition } from "../../../analysis/callables/frame-values.js";
import type { RustExpr, RustStmt, RustType } from "../../target-ast/nodes.js";
import { rustValueBlock } from "../../target-ast/value-block.js";
import type { RustValueFieldLocation } from "../objects/value-fields.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput, rustActiveErrorType } from "../program/plan-context.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustFrameCallableTypes } from "../types/frame-callables.js";
import { rustCarrierHasCopyContract } from "../types/generic-requirements.js";
import { planRustFrameCallableEntry } from "../expressions/frame-callables.js";
import { planRustNonConsumingValue } from "../expressions/typed-locations.js";
import { rustSourceBindingFactKey } from "../../../analysis/facts/keys.js";
import { rustBindingStorageOperations, rustInlineBindingStoragePath, rustInlineBindingStorageType } from "../expressions/binding-storage.js";
import { projectRustFrameOwnerData, rustFrameOwnerReference, type RustLiveFrameOwner } from "../program/frame-owners.js";
import { checkRustDataWrite } from "../objects/data-writes.js";
import { initializeOrWriteRustDeferredStorage, initializeRustDeferredStorage } from "./deferred-storage.js";

export function rustFrameBindingType(binding: RustFrameCallableBinding, context: RustPlanContext): RustType | undefined {
  const type = binding.entry === undefined ? rustTypeFromCarrierInContext(binding.carrier, context)
    : rustFrameCallableTypes(binding.carrier, context)?.entryType;
  if (type === undefined) return undefined;
  const payload = binding.storage === "value" ? type : rustInlineBindingStorageType(binding.storage, type);
  return binding.initialization === "ready" ? payload
    : { kind: "named", path: "core::cell::OnceCell", genericArguments: [{ kind: "type", type: payload }] };
}

function frameBindingPayload(binding: RustFrameCallableBinding,
  field: RustExpr, context: RustPlanContext, mutable = false,
) {
  const cell: RustExpr = binding.initialization === "ready" ? field : { kind: "method-call", receiver: { kind: "method-call", receiver: field,
    method: mutable ? "get_mut" : "get", args: [] },
    method: "expect", args: [{ kind: "str-literal", value: "callable activation binding read before initialization" }] };
  const copy = binding.entry?.copy === true || binding.entry === undefined && rustCarrierHasCopyContract(binding.carrier, context);
  const operations = binding.storage === "value" ? undefined : rustBindingStorageOperations(binding.storage);
  const read: RustExpr = operations?.read(cell) ?? (copy ? binding.initialization === "ready" ? cell
    : { kind: "dereference", pointer: cell }
    : { kind: "method-call", receiver: cell, method: "clone", args: [] });
  return { field, cell, read, operations };
}

function writeRustFrameBindingPayload(binding: RustFrameCallableBinding, field: RustExpr, value: RustExpr,
  context: RustPlanContext, mutable: boolean,
): RustExpr | undefined {
  const { cell, operations } = frameBindingPayload(binding, field, context, mutable);
  return operations?.write(cell, value) ?? (mutable ? { kind: "assignment", operator: "=",
    target: binding.initialization === "ready" ? cell : { kind: "dereference", pointer: cell }, value } : undefined);
}

export function createRustFrameBindingValue(binding: RustFrameCallableBinding, value: RustExpr): RustExpr {
  const payload = binding.storage === "value" ? value
    : { kind: "call" as const, path: `${rustInlineBindingStoragePath(binding.storage)}::new`, args: [value] };
  return binding.initialization === "ready" ? payload
    : { kind: "call", path: "core::cell::OnceCell::from", args: [payload] };
}

export function initializeRustFrameBindingValue(binding: RustFrameCallableBinding, field: RustExpr, value: RustExpr): RustExpr {
  if (binding.initialization === "ready") return { kind: "assignment", operator: "=", target: field,
    value: createRustFrameBindingValue(binding, value) };
  const payload = binding.storage === "value" ? value
    : { kind: "call" as const, path: `${rustInlineBindingStoragePath(binding.storage)}::new`, args: [value] };
  return initializeRustDeferredStorage(field, payload, "callable activation binding initialized twice");
}

export function initializeOrWriteRustFrameBindingValue(
  binding: RustFrameCallableBinding, field: RustExpr, value: RustExpr, context: RustPlanContext,
): RustExpr | undefined {
  if (binding.initialization !== "deferred") return undefined;
  const storage = binding.storage;
  const operations = storage === "value" ? undefined : rustBindingStorageOperations(storage);
  return initializeOrWriteRustDeferredStorage(field, value, context,
    selected => storage === "value" ? selected
      : { kind: "call", path: `${rustInlineBindingStoragePath(storage)}::new`, args: [selected] },
    (owner, selected) => operations?.write(owner, selected) ?? { kind: "assignment", operator: "=",
      target: { kind: "dereference", pointer: owner }, value: selected },
    "callable activation binding initialized twice", storage === "value");
}

export function rustFrameBindingLocalLocation(
  binding: RustFrameCallableBinding, field: RustExpr, context: RustPlanContext,
): RustValueFieldLocation {
  const { cell, read, operations } = frameBindingPayload(binding, field, context);
  return { bindings: [], read, write: value => writeRustFrameBindingPayload(binding, field, value, context,
    binding.storage === "value"),
    withRead: project => project(operations?.borrowedRead(cell) ?? cell),
    ...(binding.initialization !== "deferred" ? {} : { initialize: (value: RustExpr) => initializeRustFrameBindingValue(binding, field, value) }),
    ...(binding.entry === undefined ? {} : { planInput: (node: Node, inputContext: RustPlanContext, planValue: () => RustExpr | undefined) =>
      planRustFrameBindingInput(binding, node, inputContext, planValue) }),
  };
}

export function planRustFrameBindingInput(
  binding: RustFrameCallableBinding, node: Node, context: RustPlanContext,
  planValue: () => RustExpr | undefined,
): RustExpr | undefined {
  const types = rustFrameCallableTypes(binding.carrier, context);
  const selectedOwner = types === undefined ? undefined : context.frameOwners?.get(types.definition);
  if (types === undefined || types.entry !== binding.entry ||
    !context.input.program.callableValues.frames.isSameActivationInput(node, types.definition,
      selectedOwner?.kind === "live" ? selectedOwner.receiver : undefined)) {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
      "rust.backend.frame-entry-input", "An internal frame slot requires exact same-activation input ownership."));
    return undefined;
  }
  if (context.input.program.callableValues.frames.implementationFor(node) !== undefined)
    return planRustFrameCallableEntry(node, binding.carrier, context);
  const declaration = context.input.program.facts.getFact(node, rustSourceBindingFactKey)?.sourceDeclaration;
  const sourceBinding = declaration === undefined ? undefined : types.definition.bindings.find(selected =>
    selected.declaration === declaration && selected.entry === types.entry);
  const owner = context.frameOwners?.get(types.definition);
  if (sourceBinding !== undefined && owner?.kind === "live") return projectRustFrameOwnerData(owner,
    data => frameBindingPayload(sourceBinding, { kind: "field", receiver: data, name: sourceBinding.fieldName }, context).read);
  const value = planValue();
  if (value === undefined) return undefined;
  const borrowed: RustExpr = { kind: "method-call", receiver: planRustNonConsumingValue(node, value, context), method: "entry", args: [] };
  return binding.entry?.copy === true ? { kind: "dereference", pointer: borrowed }
    : { kind: "method-call", receiver: borrowed, method: "clone", args: [] };
}

export function rustFrameBindingLocation(
  binding: RustFrameCallableBinding, owner: RustLiveFrameOwner, context: RustPlanContext,
): RustValueFieldLocation {
  const select = (data: RustExpr) => frameBindingPayload(binding, { kind: "field", receiver: data, name: binding.fieldName }, context);
  const read = projectRustFrameOwnerData(owner, data => select(data).read);
  const types = binding.entry === undefined ? undefined : rustFrameCallableTypes(binding.carrier, context);
  return {
    bindings: [],
    read: binding.entry === undefined ? read : { kind: "call", path: "rt::FrameCallable::from_frame", args: [
      { kind: "call", path: "alloc::rc::Rc::clone", args: [rustFrameOwnerReference(owner)] }, read,
    ] },
    ...(binding.entry === undefined ? { withRead: (project: (value: RustExpr) => RustExpr | undefined) =>
      projectRustFrameOwnerData(owner, data => {
        const { cell, operations } = select(data);
        return project(operations?.borrowedRead(cell) ?? cell);
      }) } : {}),
    write: (value, writeContext) => {
      const mutable = binding.storage === "value" && owner.data.kind === "object" && owner.data.mutable;
      const effect = projectRustFrameOwnerData(owner, data => writeRustFrameBindingPayload(binding,
        { kind: "field", receiver: data, name: binding.fieldName }, value, context, mutable), mutable);
      const checked = owner.data.kind === "object" &&
        writeContext.input.program.frozenDataWrites.receiverForDeclaration(binding.declaration) !== undefined;
      const errorType = checked ? rustActiveErrorType(writeContext) : undefined;
      return effect === undefined || checked && errorType === undefined ? undefined
        : errorType === undefined ? effect : checkRustDataWrite("receiver", owner.expression, effect, errorType);
    },
    ...(binding.initialization !== "deferred" ? {} : { initialize: (value: RustExpr) => projectRustFrameOwnerData(owner,
      data => initializeRustFrameBindingValue(binding, select(data).field, value)) }),
    ...(types === undefined ? {} : { planInput: (node: Node, inputContext: RustPlanContext, planValue: () => RustExpr | undefined): RustExpr | undefined => {
      const frameOwners = new Map(inputContext.frameOwners);
      frameOwners.set(types.definition, owner);
      return planRustFrameBindingInput(binding, node, { ...inputContext, frameOwners }, planValue);
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
  definition: RustFrameCallableDefinition, owner: RustLiveFrameOwner,
  context: RustPlanContext,
): RustPlanContext {
  const frameOwners = new Map(context.frameOwners);
  frameOwners.set(definition, owner);
  const bindingLocations = new Map(context.bindingLocations);
  const valueFieldLocations = new Map(context.valueFieldLocations);
  if (definition.activation.kind === "lexical") {
    for (const binding of definition.bindings)
      bindingLocations.set(binding.declaration, rustFrameBindingLocation(binding, owner, context));
  } else for (const component of definition.activation.components) for (const relation of component.receiverRelations) {
    const binding = definition.bindings.find(binding => binding.declaration === relation.storageDeclaration);
    if (binding !== undefined) valueFieldLocations.set(relation.access, rustFrameBindingLocation(binding, owner, context));
  }
  return { ...context, frameOwners, bindingLocations, valueFieldLocations };
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
  const owner: RustLiveFrameOwner = { kind: "live", expression: { kind: "path", path: name },
    borrowed: false, data: { kind: "direct" } };
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
      { name: definition.counterName, value: { kind: "call", path: "rt::FrameEntryCounter::new", args: [] } },
      ...fields as { readonly name: string; readonly value: RustExpr }[],
      ...(definition.environmentParameters.length === 0 ? [] : [{ name: "marker", value: { kind: "path" as const, path: "core::marker::PhantomData" } }]),
    ],
  }] } }];
  context.usedAliases?.add("rt");
  return { context: selected, statements };
}
