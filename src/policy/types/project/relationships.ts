import type { RustProjectTypeDefinition } from "../../../target-model/types/project-types.js";

export function heritageKindIssue(
  source: RustProjectTypeDefinition,
  relation: "extends" | "implements",
  target: RustProjectTypeDefinition,
): string | undefined {
  if (source.kind === "interface") {
    return relation !== "extends"
      ? `Project interface '${source.sourceName}' requires an exact extends instance contract.`
      : undefined;
  }
  return relation === "extends"
    ? target.kind === "class"
      ? undefined
      : `Project class '${source.sourceName}' can extend only another project class.`
    : undefined;
}
