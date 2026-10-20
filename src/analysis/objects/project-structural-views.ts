import type { Node, Type } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustFactWalk } from "../program/walk.js";

import { generalizeRustProjectStructuralView } from "./project-structural-views-generics.js";
import { selectRustProjectStructuralViewFields, selectRustProjectStructuralViewSources } from "./project-structural-views-members.js";
import { rustFrameCallableValue } from "../../target-model/types/carriers/frame-callables.js";

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

