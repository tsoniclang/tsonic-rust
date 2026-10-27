import type { RustFrameCallableDefinition } from "../../../target-model/records/callables/frame-callables.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustStructField, RustVisibility } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustLiveFrameOwner } from "../program/frame-owners.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustProjectObjectStateField } from "./project-objects.js";
import { rustFrameCallableTypes } from "../types/frame-callables.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustValueFieldLocation } from "./value-fields.js";
import { rustFrameBindingLocation } from "../bindings/frame-storage.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function rustClassFrameFieldLocation(
  declaration: Node, receiverCarrier: TargetTypeRef, receiver: RustExpr, context: RustPlanContext, sourceReceiver?: Node,
): RustValueFieldLocation | undefined {
  const selected = context.input.program.records.classFrameField.get(declaration, receiverCarrier);
  if (selected === undefined) return undefined;
  const owner = rustClassFrameOwner(selected.frame, receiver, context, sourceReceiver);
  if (owner === undefined) failRustPlannerInvariant("An admitted native frame field requires its exact live owner.", sourceReceiver ?? declaration);
  return rustFrameBindingLocation(selected.binding, owner, context);
}

export interface RustClassFrameLayout {
  readonly fields: readonly RustStructField[];
  ownsField(declaration: Node): boolean;
  materialize(values: ReadonlyMap<Node, RustExpr>, counter: RustExpr, retained?: RustExpr): readonly { readonly name: string; readonly value: RustExpr }[];
}

export function createRustClassFrameValue(
  definition: RustFrameCallableDefinition, values: ReadonlyMap<Node, RustExpr>, counter: RustExpr, context: RustPlanContext,
): RustExpr | undefined {
  const carrier = definition.entries[0]?.implementations[0]?.carrier;
  const types = carrier === undefined ? undefined : rustFrameCallableTypes(carrier, context);
  if (definition.storage.kind !== "standalone" || types?.frameType.kind !== "named" ||
    definition.bindings.some(binding => !values.has(binding.declaration))) failRustPlannerInvariant("An admitted standalone frame requires its complete native field initialization.", definition.activation.kind === "class" ? definition.activation.ownerDeclaration : definition.activation.activationScope);
  const selected = context.input.program.records.frameDeclaration.get(definition);
  if (selected === undefined) failRustPlannerInvariant("An admitted frame requires its sealed native counter layout.", definition.activation.kind === "class" ? definition.activation.ownerDeclaration : definition.activation.activationScope);
  const counterName = selected.counterName;
  return { kind: "call", path: "alloc::rc::Rc::new", args: [{
    kind: "struct-literal", path: types.frameType.path, fields: [
      ...(counterName === undefined ? [] : [{ name: counterName, value: counter }]),
      ...definition.bindings.map(binding => ({ name: binding.fieldName, value: values.get(binding.declaration)! })),
      ...(definition.environmentParameters.length === 0 ? [] : [{ name: "marker", value: { kind: "path" as const, path: "core::marker::PhantomData" } }]),
    ],
  }] };
}

export function rustClassFrameLayout(
  definition: RustFrameCallableDefinition, context: RustPlanContext, visibility: RustVisibility,
): RustClassFrameLayout | undefined {
  const carrier = definition.entries[0]?.implementations[0]?.carrier;
  const types = carrier === undefined ? undefined : rustFrameCallableTypes(carrier, context);
  if (definition.activation.kind !== "class" || types === undefined) failRustPlannerInvariant("An admitted class frame requires its exact native activation layout.", definition.activation.kind === "class" ? definition.activation.ownerDeclaration : definition.activation.activationScope);
  const selected = context.input.program.records.frameDeclaration.get(definition);
  if (selected === undefined) failRustPlannerInvariant("An admitted class frame requires its sealed native counter layout.", definition.activation.ownerDeclaration);
  const counterName = selected.counterName;
  if (definition.storage.kind === "object") return {
    fields: counterName === undefined ? [] : [{ name: counterName, type: { kind: "named", path: "rt::FrameEntryCounter" }, visibility }],
    ownsField: () => false,
    materialize: (_values, counter) => counterName === undefined ? [] : [{ name: counterName, value: counter }],
  };
  const instanceFieldName = definition.storage.instanceFieldName;
  if (instanceFieldName === undefined || types.frameType.kind !== "named") failRustPlannerInvariant("An admitted class frame requires its native instance-field identity and type.", definition.activation.ownerDeclaration);
  return {
    fields: [{ name: instanceFieldName, type: { kind: "named", path: "alloc::rc::Rc",
      genericArguments: [{ kind: "type", type: types.frameType }] }, visibility }],
    ownsField: declaration => definition.bindings.some(binding => binding.declaration === declaration),
    materialize: (values, counter, retained) => [{ name: instanceFieldName,
      value: retained ?? createRustClassFrameValue(definition, values, counter, context)! }],
  };
}

export function rustClassFrameOwner(
  definition: RustFrameCallableDefinition, receiver: RustExpr, context: RustPlanContext, sourceReceiver?: Node,
): RustLiveFrameOwner | undefined {
  if (definition.activation.kind !== "class") failRustPlannerInvariant("An admitted class frame owner requires its exact native activation.", sourceReceiver);
  if (definition.storage.kind === "standalone") {
    if (definition.storage.instanceFieldName === undefined) failRustPlannerInvariant("An admitted standalone class frame requires its native field identity.", sourceReceiver ?? definition.activation.ownerDeclaration);
    return { kind: "live", expression: { kind: "field", receiver, name: definition.storage.instanceFieldName },
      borrowed: false, data: { kind: "direct" }, ...(sourceReceiver === undefined ? {} : { receiver: sourceReceiver }) };
  }
  if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted class frame owner requires its hygienic native emission scope.", sourceReceiver ?? definition.activation.ownerDeclaration);
  return { kind: "live", expression: { kind: "method-call", receiver: { kind: "field", receiver, name: rustProjectObjectStateField },
    method: "shared", args: [] }, borrowed: true, data: { kind: "object", mutable: definition.storage.mutable,
      name: allocateRustSyntheticName(context.syntheticNames, "frame_data") },
    ...(sourceReceiver === undefined ? {} : { receiver: sourceReceiver }) };
}
