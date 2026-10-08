import type { Node, Type } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustFactWalk } from "../program/walk.js";
import type { RustProjectFieldSelection } from "../operations/provider/project-fields.js";
import type { RustClassValueCallable } from "./class-value-callables.js";
import type { RustProjectAccessorSelection } from "../operations/provider/project-accessors.js";
import type { RustCallableValueAdapter } from "../facts/callable-adapters.js";
import { generalizeRustProjectStructuralView } from "./project-structural-views-generics.js";
import { selectRustProjectStructuralViewFields, selectRustProjectStructuralViewSources } from "./project-structural-views-members.js";
import { rustFrameCallableValue } from "../../target-model/types/carriers/frame-callables.js";

export interface RustProjectStructuralView {
  readonly declaration: Node;
  readonly sourceCarrier: TargetTypeRef;
  readonly targetCarrier: TargetTypeRef;
  readonly fields: readonly {
    readonly declaration: Node;
    readonly storageIndex: number;
    readonly field?: RustProjectFieldSelection;
    readonly accessor?: RustProjectAccessorSelection;
    readonly readAdapter?: RustCallableValueAdapter;
    readonly callable?: RustClassValueCallable;
  }[];
}

export function selectRustProjectStructuralView(
  walk: RustFactWalk, declaration: Node, sourceCarrier: TargetTypeRef,
  targetCarrier: TargetTypeRef, semantics: SourceFileSemantics, sourceType: Type,
): boolean {
  const target = walk.sourceTypes.structuralObjectForCarrier(targetCarrier);
  const definition = walk.context.projectTypes.definitionForDeclaration(declaration);
  if (target === undefined || target.construction !== undefined || definition?.kind !== "class" ||
    walk.context.objectRepresentations.representationFor(definition)?.kind === "value") return false;
  const sources = selectRustProjectStructuralViewSources(walk, sourceCarrier, target, semantics, sourceType);
  if (sources === undefined) return false;
  const fields = selectRustProjectStructuralViewFields(sources, target, walk);
  if (fields === undefined) return false;
  const view = generalizeRustProjectStructuralView({ declaration, sourceCarrier, targetCarrier, fields }, target, walk, sources);
  if (view === undefined || !walk.context.classValues.recordInstanceView(view)) return false;
  return fields.every(field => walk.sourceTypes.registerStructuralFieldImplementation({
    carrier: targetCarrier, storageIndex: field.storageIndex, kind: "dispatch",
  }) && (field.accessor === undefined && rustFrameCallableValue(field.field?.resultCarrier) === undefined ||
    walk.sourceTypes.registerStructuralFieldImplementation({
    carrier: targetCarrier, storageIndex: field.storageIndex, kind: "accessor",
  })));
}

export interface RustProjectStructuralViewImplementation extends RustProjectStructuralView {
  readonly ownerFileName: string;
}
