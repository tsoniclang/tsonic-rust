import type { RustFrameCallableDefinition } from "../../../analysis/callables/frame-values.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustStructField, RustVisibility } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustLiveFrameOwner } from "../program/frame-owners.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustProjectObjectStateField } from "../../../target-model/types/field-storage.js";
import { requireRustNativeFrameStorage } from "../expressions/binding-storage.js";
import { rustTypeFromSelectedNativeCarrierInContext } from "../types/render.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustValueFieldLocation } from "./value-fields.js";
import { rustFrameBindingLocation } from "../bindings/frame-storage.js";

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
  const nativeFrame = requireRustNativeFrameStorage(definition, context.emissionContext);
  const frameType = rustTypeFromSelectedNativeCarrierInContext(nativeFrame.carrier, context);
  const selected = context.input.program.nativeDeclarations.get(definition.activation.ownerDeclaration);
  if (definition.storage.kind !== "standalone" || frameType.kind !== "named" || nativeFrame.constructor === null ||
    selected?.kind !== "class" || definition.bindings.some(binding => !values.has(binding.declaration))) return undefined;
  const counterName = selected.frameCounterName;
  return { kind: "call", path: nativeFrame.constructor, args: [{
    kind: "struct-literal", path: frameType.path, fields: [
      ...(counterName === undefined ? [] : [{ name: counterName, value: counter }]),
      ...definition.bindings.map(binding => ({ name: binding.fieldName, value: values.get(binding.declaration)! })),
      ...(definition.environmentParameters.length === 0 ? [] : [{ name: "marker", value: { kind: "path" as const, path: "core::marker::PhantomData" } }]),
    ],
  }] };
}

export function rustClassFrameLayout(
  definition: RustFrameCallableDefinition, context: RustPlanContext, visibility: RustVisibility,
): RustClassFrameLayout | undefined {
  const selected = context.input.program.nativeDeclarations.get(definition.activation.ownerDeclaration);
  if (definition.activation.kind !== "class" || selected?.kind !== "class") return undefined;
  const counter = selected.physical.storageFields.find(field => field.kind === "frame-counter");
  if (definition.storage.kind === "object") return {
    fields: counter === undefined ? [] : [{ name: counter.name, type: { kind: "named", path: "rt::FrameEntryCounter" }, visibility }],
    ownsField: () => false,
    materialize: (_values, value) => counter === undefined ? [] : [{ name: counter.name, value }],
  };
  const retained = selected.physical.storageFields.find(field => field.kind === "frame");
  if (retained === undefined) return undefined;
  const nativeFrame = requireRustNativeFrameStorage(definition,
    context.input.program.physicalEmissionContexts.contextForOwner(definition, "frame"));
  return {
    fields: [{ name: retained.name, type: rustTypeFromSelectedNativeCarrierInContext(nativeFrame.holderCarrier, context), visibility }],
    ownsField: declaration => definition.bindings.some(binding => binding.declaration === declaration),
    materialize: (values, counter, value) => [{ name: retained.name,
      value: value ?? createRustClassFrameValue(definition, values, counter, context)! }],
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
