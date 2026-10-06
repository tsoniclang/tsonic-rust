import type { RustFrameCallableDefinition, RustFrameCallableEntryDefinition } from "../../../analysis/callables/frame-values.js";
import { rustFrameCallableValue } from "../../../target-model/types/carriers/frame-callables.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustType } from "../../target-ast/nodes.js";
import type { RustTypeRenderingContext } from "./render.js";
import { rustTypeFromCarrierInContext } from "./render.js";
import { rustProjectStateType } from "../objects/polymorphism/names.js";
import { rustProjectObjectSharedStateType } from "../objects/project-objects.js";
import { rustClassEnvironmentHandleType } from "../objects/class-environment-types.js";

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
  const value = rustFrameCallableValue(carrier);
  const definition = context.input.program.callableValues.frames.definitionFor(carrier);
  const entry = context.input.program.callableValues.frames.entryFor(carrier);
  if (value === undefined || definition === undefined || entry === undefined) return undefined;
  const module = context.moduleNameByFileName.get(definition.ownerFileName);
  if (module === undefined) return undefined;
  const external = context.externalCrateNameByFileName.get(definition.ownerFileName);
  const types: (RustType | undefined)[] = Array.from({ length: definition.environmentParameters.length }, () => undefined);
  if (value.environment.length !== entry.environmentIndexes.length) return undefined;
  value.environment.forEach((parameter, index) => {
    const target = entry.environmentIndexes[index]!;
    if (target >= 0 && target < types.length) {
      types[target] = rustTypeFromCarrierInContext(parameter, context);
    }
  });
  if (types.some(type => type === undefined)) return undefined;
  const prefix = `${external !== undefined && external !== context.crateName ? external : "crate"}::${module}`;
  const genericArguments = (types as RustType[]).map(type => ({ kind: "type" as const, type }));
  let frameType: RustType | undefined;
  if (definition.storage.kind === "standalone") frameType = { kind: "named", path: `${prefix}::${definition.targetName}`, genericArguments };
  else {
    if (value.owner.kind !== "class") return undefined;
    const selected = value.owner.instance;
    const owner = context.input.program.projectTypes.definitionForCarrier(selected);
    const representation = context.input.program.objectRepresentations.representationFor(owner);
    if (owner?.kind !== "class" || owner.declaration !== definition.activation.ownerDeclaration || representation === undefined) return undefined;
    const state = rustProjectStateType(selected, context);
    const environment = context.input.program.classValues.forDeclaration(owner.declaration)?.environment;
    const environmentType = environment?.instancesUseEnvironment !== true ? undefined : rustClassEnvironmentHandleType(selected, context);
    if (state === undefined || environment?.instancesUseEnvironment === true && environmentType === undefined) return undefined;
    frameType = rustProjectObjectSharedStateType(state, representation, environmentType);
  }
  if (frameType === undefined) return undefined;
  const entryType: RustType = { kind: "named", path: `${prefix}::${entry.targetName}`, genericArguments };
  return { definition, entry, frameType, entryType, rootType: { kind: "named", path: "rt::FrameCallable",
    genericArguments: [{ kind: "type", type: frameType }, { kind: "type", type: entryType }] } };
}
