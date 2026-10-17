import type { RustFrameCallableDefinition, RustFrameCallableEntryDefinition } from "../../../analysis/callables/frame-values.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustType } from "../../target-ast/syntax/nodes.js";
import type { RustTypeRenderingContext } from "./render.js";
import { rustNativeTypeInputContextForRendering, rustTypeFromCarrierInContext } from "./render.js";
import { rustNativeFrameCallableCarriers } from "../../../policy/types/model/native-type-selection.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export interface RustFrameCallableTypes {
  readonly definition: RustFrameCallableDefinition;
  readonly entry: RustFrameCallableEntryDefinition;
  readonly frameType: RustType;
  readonly entryType: RustType;
  readonly rootType: RustType;
}

export function rustFrameCallableTypes(
  carrier: TargetTypeRef, context: RustTypeRenderingContext,
): RustFrameCallableTypes | undefined {
  const definition = context.input.program.callableValues.frames.definitionFor(carrier);
  const entry = context.input.program.callableValues.frames.entryFor(carrier);
  if (definition === undefined || entry === undefined) return undefined;
  const selected = rustNativeFrameCallableCarriers(carrier, rustNativeTypeInputContextForRendering(context));
  const rootType = selected === undefined ? undefined : rustTypeFromCarrierInContext(selected.root, context);
  if (rootType === undefined) return undefined;
  const frame = rootType.kind === "named" ? rootType.genericArguments?.[0] : undefined;
  const implementation = rootType.kind === "named" ? rootType.genericArguments?.[1] : undefined;
  if (frame?.kind !== "type" || implementation?.kind !== "type") return failRustPlannerInvariant(
    "A selected native frame callable lost its exact frame and entry syntax.");
  return { definition, entry, frameType: frame.type, entryType: implementation.type, rootType };
}
