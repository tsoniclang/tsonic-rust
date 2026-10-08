import type { RustFrameCallableDefinition } from "../../../analysis/callables/frame-values.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustStructField, RustVisibility } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustLiveFrameOwner } from "../program/frame-owners.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustProjectObjectStateField } from "./project-objects.js";
import { rustFrameCallableTypes } from "../types/frame-callables.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustValueFieldLocation } from "./value-fields.js";
import { rustFrameBindingLocation } from "../bindings/frame-storage.js";
import { rustRetainedFrameCounterName } from "../../../analysis/callables/frame-counter-storage.js";

export function rustClassFrameFieldLocation(
  declaration: Node, receiverCarrier: TargetTypeRef, receiver: RustExpr, context: RustPlanContext, sourceReceiver?: Node,
): RustValueFieldLocation | undefined {
  const binding = context.input.program.callableValues.frames.bindingFor(declaration);
  const definition = context.input.program.projectTypes.definitionForCarrier(receiverCarrier);
  const frame = definition === undefined ? undefined : context.input.program.callableValues.frames.definitionForOwner(definition.declaration);
  if (binding === undefined || frame === undefined || !frame.bindings.includes(binding)) return undefined;
  const selectedCarrier = context.input.program.projectTypes.instantiateMemberCarrier(declaration, receiverCarrier, binding.carrier);
  if (selectedCarrier === undefined) return undefined;
  const owner = rustClassFrameOwner(frame, receiver, context, sourceReceiver);
  return owner === undefined ? undefined : rustFrameBindingLocation({ ...binding, carrier: selectedCarrier }, owner, context);
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
    definition.bindings.some(binding => !values.has(binding.declaration))) return undefined;
  const counterName = rustRetainedFrameCounterName(definition, context.input.program);
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
  if (definition.activation.kind !== "class" || types === undefined) return undefined;
  const counterName = rustRetainedFrameCounterName(definition, context.input.program);
  if (definition.storage.kind === "object") return {
    fields: counterName === undefined ? [] : [{ name: counterName, type: { kind: "named", path: "rt::FrameEntryCounter" }, visibility }],
    ownsField: () => false,
    materialize: (_values, counter) => counterName === undefined ? [] : [{ name: counterName, value: counter }],
  };
  const instanceFieldName = definition.storage.instanceFieldName;
  if (instanceFieldName === undefined || types.frameType.kind !== "named") return undefined;
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
  if (definition.activation.kind !== "class") return undefined;
  if (definition.storage.kind === "standalone") return definition.storage.instanceFieldName === undefined ? undefined
    : { kind: "live", expression: { kind: "field", receiver, name: definition.storage.instanceFieldName },
      borrowed: false, data: { kind: "direct" }, ...(sourceReceiver === undefined ? {} : { receiver: sourceReceiver }) };
  if (context.syntheticNames === undefined) return undefined;
  return { kind: "live", expression: { kind: "method-call", receiver: { kind: "field", receiver, name: rustProjectObjectStateField },
    method: "shared", args: [] }, borrowed: true, data: { kind: "object", mutable: definition.storage.mutable,
      name: allocateRustSyntheticName(context.syntheticNames, "frame_data") },
    ...(sourceReceiver === undefined ? {} : { receiver: sourceReceiver }) };
}
