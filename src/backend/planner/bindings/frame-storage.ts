import type { Node } from "@tsonic/tsts";
import { rustPackageFallibleBoundary } from "../program/fallible-boundaries.js";
import type { RustFrameCallableBinding, RustFrameCallableDefinition } from "../../../target-model/records/callables/frame-callables.js";
import type { RustExpr, RustStmt, RustType } from "../../target-ast/syntax/nodes.js";
import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import type { RustValueFieldLocation } from "../objects/value-fields.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustCurrentErrorBoundary } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustFrameCallableTypes } from "../types/frame-callables.js";
import { requireRustLocationValueCarrier } from "../types/generic-requirements.js";
import { rustCallableCaptureStorageType } from "../types/capture-storage.js";
import { planRustFrameCallableEntry, publishRustFrameCallable } from "../expressions/frame-callables.js";

import { rustBindingStorageOperations, rustInlineBindingStoragePath, rustInlineBindingStorageType } from "../expressions/binding-storage.js";
import { projectRustFrameOwnerData, rustFrameOwnerReference, type RustLiveFrameOwner } from "../program/frame-owners.js";
import { checkRustDataWrite } from "../objects/data-writes.js";
import { initializeOrWriteRustDeferredStorage, initializeRustDeferredStorage } from "./deferred-storage.js";
import { planRustProjectedObjectLocation } from "../expressions/object-field-locations.js";

export function rustFrameBindingType(binding: RustFrameCallableBinding, context: RustPlanContext): RustType | undefined {
  if (binding.storage === "location" && !requireRustLocationValueCarrier(binding.carrier, binding.declaration, context)) failRustPlannerInvariant("An admitted frame binding requires its native location carrier.", binding.declaration);
  const type = binding.entry === undefined ? rustTypeFromCarrierInContext(binding.carrier, context)
    : rustFrameCallableTypes(binding.carrier, context)?.entryType;
  if (type === undefined) failRustPlannerInvariant("An admitted frame binding requires its native value carrier.", binding.declaration);
  const payload = binding.storage === "location" ? rustCallableCaptureStorageType(binding, binding.carrier, context)
    : binding.storage === "value" ? type : rustInlineBindingStorageType(binding.storage, type);
  if (payload === undefined) failRustPlannerInvariant("An admitted frame binding requires its native payload storage.", binding.declaration);
  return binding.initialization === "ready" ? payload
    : { kind: "named", path: "core::cell::OnceCell", genericArguments: [{ kind: "type", type: payload }] };
}

function frameBindingPayload(binding: RustFrameCallableBinding,
  field: RustExpr, context: RustPlanContext, mutable = false,
) {
  const cell: RustExpr = binding.initialization === "ready" ? field : { kind: "method-call", receiver: { kind: "method-call", receiver: field,
    method: mutable ? "get_mut" : "get", args: [] },
    method: "expect", args: [{ kind: "str-literal", value: "callable activation binding read before initialization" }] };
  const selected = context.input.program.records.frameBinding.get(binding);
  if (selected === undefined) failRustPlannerInvariant("An admitted frame binding requires its sealed native ownership decision.", binding.declaration);
  const copy = selected.copy;
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

function createRustFrameBindingPayload(binding: RustFrameCallableBinding, value: RustExpr): RustExpr {
  return binding.storage === "value" ? value : { kind: "call", args: [value],
    path: binding.storage === "location" ? "rt::Location::allocate" : `${rustInlineBindingStoragePath(binding.storage)}::new` };
}

export function createRustFrameBindingValue(binding: RustFrameCallableBinding, value: RustExpr): RustExpr {
  const payload = createRustFrameBindingPayload(binding, value);
  return binding.initialization === "ready" ? payload
    : { kind: "call", path: "core::cell::OnceCell::from", args: [payload] };
}

export function initializeRustFrameBindingValue(binding: RustFrameCallableBinding, field: RustExpr, value: RustExpr): RustExpr {
  if (binding.initialization === "ready") return { kind: "assignment", operator: "=", target: field,
    value: createRustFrameBindingValue(binding, value) };
  const payload = createRustFrameBindingPayload(binding, value);
  return initializeRustDeferredStorage(field, payload, "callable activation binding initialized twice");
}

export function initializeOrWriteRustFrameBindingValue(
  binding: RustFrameCallableBinding, field: RustExpr, value: RustExpr, context: RustPlanContext,
): RustExpr | undefined {
  if (binding.initialization !== "deferred") return undefined;
  const storage = binding.storage;
  const operations = storage === "value" ? undefined : rustBindingStorageOperations(storage);
  return initializeOrWriteRustDeferredStorage(field, value, context,
    selected => createRustFrameBindingPayload(binding, selected),
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
    ...(binding.storage !== "location" ? {} : { address: () => ({ kind: "infallible" as const,
      value: { kind: "method-call" as const, receiver: cell, method: "clone", args: [] } }) }),
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
  const receiver = selectedOwner?.kind === "live" ? selectedOwner.receiver : undefined;
  const admission = types === undefined ? undefined : context.input.program.records.frameInput.get(node)?.get(types.definition);
  if (types === undefined || types.entry !== binding.entry ||
    admission === undefined || !admission.independent && admission.receiverOwner !== undefined && receiver !== undefined &&
      context.input.program.records.frameReceiverOwner.get(receiver) !== admission.receiverOwner) {
    failRustPlannerInvariant("An internal frame slot requires exact same-activation input ownership.", node);
  }
  const implementation = context.input.program.records.frameImplementation.get(node);
  if (implementation !== undefined && !implementation.independent)
    return planRustFrameCallableEntry(node, binding.carrier, context);
  const declaration = context.input.program.records.sourceBinding.get(node)?.sourceDeclaration;
  const sourceBinding = declaration === undefined ? undefined : types.definition.bindings.find(selected =>
    selected.declaration === declaration && selected.entry === types.entry);
  const owner = context.frameOwners?.get(types.definition);
  if (sourceBinding !== undefined && owner?.kind === "live") return projectRustFrameOwnerData(owner,
    data => frameBindingPayload(sourceBinding, { kind: "field", receiver: data, name: sourceBinding.fieldName }, context).read);
  const value = planValue();
  if (value === undefined) failRustPlannerInvariant("An admitted native frame input requires its exact value renderer.", node);
  if (types.entry.hasIndependent) return { kind: "method-call",
    receiver: value, method: "into_entry", args: [] };
  const borrowed: RustExpr = { kind: "method-call", receiver: value, method: "entry", args: [] };
  return binding.entry?.copy === true ? { kind: "dereference", pointer: borrowed }
    : { kind: "method-call", receiver: borrowed, method: "clone", args: [] };
}

export function rustFrameBindingLocation(
  binding: RustFrameCallableBinding, owner: RustLiveFrameOwner, context: RustPlanContext,
  ownedPublication?: { readonly entryName: string },
): RustValueFieldLocation {
  const select = (data: RustExpr) => frameBindingPayload(binding, { kind: "field", receiver: data, name: binding.fieldName }, context);
  const read = projectRustFrameOwnerData(owner, data => select(data).read);
  const types = binding.entry === undefined ? undefined : rustFrameCallableTypes(binding.carrier, context);
  if (binding.entry !== undefined && types === undefined) failRustPlannerInvariant(
    "A native frame binding requires its exact sealed entry and owning publication carrier.", binding.declaration);
  return {
    bindings: [],
    address: (member, addressContext) => {
      if (binding.storage === "location") return { kind: "infallible", value: projectRustFrameOwnerData(owner,
        data => ({ kind: "method-call", receiver: select(data).cell, method: "clone", args: [] })) };
      if (member === undefined || owner.data.kind !== "object" || binding.entry !== undefined) {
        failRustPlannerInvariant("A frame field address requires its exact stored member identity and live native object owner.", binding.declaration);
      }
      const boundary = rustCurrentErrorBoundary(addressContext);
      if (boundary === undefined) failRustPlannerInvariant("An admitted native frame address requires its native error boundary.", binding.declaration);
      const callbackContext = { ...addressContext, fallibleBoundary: rustPackageFallibleBoundary(boundary) };
      const withOwner = (expression: RustExpr): RustLiveFrameOwner => ({ ...owner, expression, borrowed: false });
      const value = planRustProjectedObjectLocation(rustFrameOwnerReference(owner), member, callbackContext,
        reader => rustFrameBindingLocation(binding, withOwner(reader), callbackContext).read,
        (writer, selected) => rustFrameBindingLocation(binding, withOwner(writer), callbackContext).write(selected, callbackContext),
        selected => ({ kind: "method-call", receiver: { kind: "call", path: "rt::ObjectIdentityCarrier::object_identity",
          args: [{ kind: "reference", expr: { kind: "dereference", pointer: selected } }] }, method: "clone", args: [] }));
      return value === undefined ? undefined : { kind: "fallible", value };
    },
    read: types === undefined ? read : publishRustFrameCallable(types, owner, read, ownedPublication),
    ...(binding.entry === undefined ? { withRead: (project: (value: RustExpr) => RustExpr | undefined) =>
      projectRustFrameOwnerData(owner, data => {
        const { cell, operations } = select(data);
        return project(operations?.borrowedRead(cell) ?? cell);
      }) } : {}),
    write: (value, writeContext) => {
      const mutable = binding.storage === "value" && owner.data.kind === "object" && owner.data.mutable;
      const effect = projectRustFrameOwnerData(owner, data => writeRustFrameBindingPayload(binding,
        { kind: "field", receiver: data, name: binding.fieldName }, value, context, mutable), mutable);
      const selected = writeContext.input.program.records.frameBinding.get(binding);
      if (selected === undefined) failRustPlannerInvariant("An admitted frame write requires its sealed native storage decision.", binding.declaration);
      const checked = owner.data.kind === "object" && selected.checkedWrite;
      const region = checked ? writeContext.fallibleBoundary : undefined;
      return effect === undefined || checked && region === undefined ? undefined
        : region === undefined ? effect : checkRustDataWrite("receiver", owner.expression, effect, region);
    },
    ...(binding.initialization !== "deferred" ? {} : { initialize: (value: RustExpr) => projectRustFrameOwnerData(owner,
      data => initializeRustFrameBindingValue(binding, select(data).field, value)) }),
    ...(types === undefined ? {} : { planInput: (node: Node, inputContext: RustPlanContext, planValue: () => RustExpr | undefined): RustExpr | undefined => {
      const frameOwners = new Map(inputContext.frameOwners);
      frameOwners.set(types.definition, owner);
      return planRustFrameBindingInput(binding, node, { ...inputContext, frameOwners }, planValue);
    }, invoke: (arguments_: readonly RustExpr[], invocationContext: RustPlanContext): RustExpr | undefined => {
      if (invocationContext.syntheticNames === undefined) failRustPlannerInvariant("An admitted frame invocation requires its native hygienic emission scope.", binding.declaration);
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
  const definitions = (context.input.program.records.frameScopes.get(scope) ?? [])
    .filter(definition => !context.frameOwners?.has(definition));
  if (definitions.length === 0) return { context, statements: [] };
  if (definitions.length !== 1 || context.syntheticNames === undefined) failRustPlannerInvariant("An admitted callable scope requires one exact native activation layout and hygienic emission scope.", scope);
  const definition = definitions[0]!;
  const carrier = definition.entries[0]?.implementations[0]?.carrier;
  const types = carrier === undefined ? undefined : rustFrameCallableTypes(carrier, context);
  if (types === undefined || types.frameType.kind !== "named") {
    failRustPlannerInvariant("A callable activation requires its exact sealed native frame layout and hygienic scope.", scope);
  }
  const name = allocateRustSyntheticName(context.syntheticNames, "callable_frame");
  const owner: RustLiveFrameOwner = { kind: "live", expression: { kind: "path", path: name },
    borrowed: false, data: { kind: "direct" } };
  const selected = rustFrameBindingContext(definition, owner, context);
  const fields = definition.bindings.map(binding => {
    const parameter = binding.initialization === "ready" ? context.input.program.records.sourceName.get(binding.declaration) : undefined;
    const value: RustExpr | undefined = binding.initialization === "deferred"
      ? { kind: "call", path: "core::cell::OnceCell::new", args: [] }
      : parameter === undefined ? undefined : binding.storage === "value" || binding.storage === "location" ? { kind: "path", path: parameter }
        : { kind: "call", path: `${rustInlineBindingStoragePath(binding.storage)}::new`, args: [{ kind: "path", path: parameter }] };
    return value === undefined ? undefined : { name: binding.fieldName, value };
  });
  if (fields.some(field => field === undefined)) failRustPlannerInvariant("An admitted callable activation requires its complete native field initialization.", scope);
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
