import type { RustFrameCallableDefinition } from "../../../analysis/callables/frame-values.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustStructField, RustVisibility } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustLiveFrameOwner } from "../program/frame-owners.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustProjectObjectStateField } from "./project-objects.js";
import { rustFrameCallableTypes } from "../types/frame-callables.js";

export interface RustClassFrameLayout {
  readonly fields: readonly RustStructField[];
  ownsField(declaration: Node): boolean;
  materialize(values: ReadonlyMap<Node, RustExpr>, counter: RustExpr): readonly { readonly name: string; readonly value: RustExpr }[];
}

export function rustClassFrameLayout(
  definition: RustFrameCallableDefinition, context: RustPlanContext, visibility: RustVisibility,
): RustClassFrameLayout | undefined {
  const carrier = definition.entries[0]?.implementations[0]?.carrier;
  const types = carrier === undefined ? undefined : rustFrameCallableTypes(carrier, context);
  if (definition.activation.kind !== "class" || types === undefined) return undefined;
  if (definition.storage.kind === "object") return {
    fields: [{ name: definition.counterName, type: { kind: "named", path: "rt::FrameEntryCounter" }, visibility }],
    ownsField: () => false,
    materialize: (_values, counter) => [{ name: definition.counterName, value: counter }],
  };
  const instanceFieldName = definition.storage.instanceFieldName;
  if (instanceFieldName === undefined || types.frameType.kind !== "named") return undefined;
  const framePath = types.frameType.path;
  return {
    fields: [{ name: instanceFieldName, type: { kind: "named", path: "alloc::rc::Rc",
      genericArguments: [{ kind: "type", type: types.frameType }] }, visibility }],
    ownsField: declaration => definition.bindings.some(binding => binding.declaration === declaration),
    materialize: (values, counter) => [{ name: instanceFieldName, value: { kind: "call", path: "alloc::rc::Rc::new", args: [{
      kind: "struct-literal", path: framePath, fields: [
        { name: definition.counterName, value: counter },
        ...definition.bindings.map(binding => ({ name: binding.fieldName, value: values.get(binding.declaration)! })),
        ...(definition.environmentParameters.length === 0 ? [] : [{ name: "marker", value: { kind: "path" as const, path: "core::marker::PhantomData" } }]),
      ],
    }] } }],
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
    method: "shared", args: [] }, borrowed: true, data: { kind: "object", name: allocateRustSyntheticName(context.syntheticNames, "frame_data") },
    ...(sourceReceiver === undefined ? {} : { receiver: sourceReceiver }) };
}
