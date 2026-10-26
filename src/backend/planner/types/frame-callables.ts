import type { RustFrameCallableDefinition, RustFrameCallableEntryDefinition } from "../../../target-model/records/frame-callables.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustType } from "../../target-ast/syntax/nodes.js";
import type { RustTypeRenderingContext } from "./render.js";
import { rustTypeFromCarrierInContext } from "./render.js";
import { rustProjectStateType } from "../objects/polymorphism/names.js";
import { rustProjectObjectSharedStateType } from "../objects/project-objects.js";
import { rustClassEnvironmentHandleType } from "../objects/class-environment-types.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import type { RustFrameNativeType } from "../../../target-model/records/frame-emission.js";

export interface RustFrameCallableTypes {
  readonly definition: RustFrameCallableDefinition;
  readonly entry: RustFrameCallableEntryDefinition;
  readonly frameType: RustType;
  readonly entryType: RustType;
  readonly rootType: RustType;
}

export function rustFrameCallableTypes(
  carrier: TargetTypeRef, context: RustTypeRenderingContext,
  position: "general" | "parameter" | "return" = "general",
): RustFrameCallableTypes {
  const selected = context.input.program.records.frameType.get(carrier);
  if (selected === undefined) failRustPlannerInvariant("An admitted native frame requires its sealed physical type and environment.");
  return renderRustFrameNativeType(selected, context, position);
}

export function renderRustFrameNativeType(
  selected: RustFrameNativeType, context: RustTypeRenderingContext,
  position: "general" | "parameter" | "return" = "general",
): RustFrameCallableTypes {
  const { definition, entry } = selected;
  const module = context.moduleNameByFileName.get(definition.ownerFileName);
  if (module === undefined) failRustPlannerInvariant("An admitted native frame requires its emitted source module.");
  const external = context.externalCrateNameByFileName.get(definition.ownerFileName);
  const parameters = selected.environment.map(carrier => {
    const type = rustTypeFromCarrierInContext(carrier, context, position);
    if (type === undefined) failRustPlannerInvariant("An admitted native frame requires its exact environment type syntax.");
    return { kind: "type" as const, type };
  });
  const prefix = `${external !== undefined && external !== context.crateName ? external : "crate"}::${module}`;
  let frameType: RustType;
  if (selected.owner === undefined) frameType = { kind: "named", path: `${prefix}::${definition.targetName}`, genericArguments: parameters };
  else {
    const state = rustProjectStateType(selected.owner.instance, context);
    const environmentType = selected.owner.environment ? rustClassEnvironmentHandleType(selected.owner.instance, context) : undefined;
    if (state === undefined || selected.owner.environment && environmentType === undefined)
      failRustPlannerInvariant("An admitted native object frame requires its exact state and environment handle syntax.");
    frameType = rustProjectObjectSharedStateType(state, selected.owner.representation, environmentType)
      ?? failRustPlannerInvariant("An admitted object frame requires its native shared-state handle.");
  }
  const entryType: RustType = { kind: "named", path: `${prefix}::${entry.targetName}`, genericArguments: parameters };
  return { definition, entry, frameType, entryType, rootType: { kind: "named", path: entry.hasIndependent ? "rt::FrameCallableFamily" : "rt::FrameCallable",
    genericArguments: [{ kind: "type", type: frameType }, { kind: "type", type: entryType }] } };
}
