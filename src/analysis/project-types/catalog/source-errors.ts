import type { SourceDeclaredHeritageResult } from "@tsonic/target-api/source";
import type { Node } from "@tsonic/tsts";
import type { RustExternalProjectBase } from "../../../target-model/types/external-project-types.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustProjectTypeDefinition } from "../../../target-model/types/project-types.js";
import { rustJsErrorTargetType } from "../../../target-model/types/carriers/js.js";
import { rustSourceErrorTargetType } from "../../../target-model/types/carriers/source-error.js";
import { compareProjectDefinitions } from "./helpers.js";

export function selectRustProjectSourceErrors(
  definitions: readonly RustProjectTypeDefinition[],
  byDeclaration: ReadonlyMap<Node, RustProjectTypeDefinition>,
  declaredHeritage: Pick<WeakMap<Node, SourceDeclaredHeritageResult>, "get">,
  externalBaseByDeclaration: Pick<WeakMap<Node, RustExternalProjectBase>, "get">,
): Readonly<{
  definitions: readonly RustProjectTypeDefinition[];
  carrier: TargetTypeRef;
}> {
  const sourceErrorDeclarations = new Set<Node>();
  const visitedErrorAncestors = new Set<Node>();
  const visitingErrorAncestors = new Set<Node>();
  const admitsSourceError = (definition: RustProjectTypeDefinition): boolean => {
    if (visitedErrorAncestors.has(definition.declaration)) return sourceErrorDeclarations.has(definition.declaration);
    if (visitingErrorAncestors.has(definition.declaration) || definition.kind !== "class") return false;
    visitingErrorAncestors.add(definition.declaration);
    const selected = declaredHeritage.get(definition.declaration);
    const admitted = externalBaseByDeclaration.get(definition.declaration)?.programError === true ||
      selected?.kind === "resolved" && selected.edges.some(edge => {
        const target = byDeclaration.get(edge.target.declaration);
        return edge.kind === "extends" && target !== undefined && admitsSourceError(target);
      });
    visitingErrorAncestors.delete(definition.declaration);
    visitedErrorAncestors.add(definition.declaration);
    if (admitted) sourceErrorDeclarations.add(definition.declaration);
    return admitted;
  };
  const sourceErrorDefinitions = Object.freeze(definitions.filter(definition =>
    admitsSourceError(definition) && definition.genericParameters.length === 0).sort(compareProjectDefinitions));
  const sourceErrorCarrier = sourceErrorDefinitions.length === 0 ? rustJsErrorTargetType() : rustSourceErrorTargetType();
  return Object.freeze({ definitions: sourceErrorDefinitions, carrier: sourceErrorCarrier });
}
