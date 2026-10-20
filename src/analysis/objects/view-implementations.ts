import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustStructuralObjectCarrierValue, rustTargetGenericReferences } from "../../target-model/types/index.js";

import type { RustAnalysisContext } from "../program/context.js";

interface RustProjectView {
  readonly declaration: Node;
  readonly sourceCarrier: TargetTypeRef;
  readonly targetCarrier: TargetTypeRef;
  readonly fields: readonly { readonly declaration: Node; readonly storageIndex: number }[];
}

import { rustProjectViewMatches } from "../../policy/types/objects/project-view-bindings.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
export function selectRustProjectViewImplementations<View extends RustProjectView>(
  views: readonly View[], context: RustAnalysisContext,
): readonly (View & { readonly ownerFileName: string })[] {
  const candidates = views.map(view => ({ view, parameters: rustTargetGenericReferences(view.sourceCarrier) }));
  const parameterCount = (candidate: typeof candidates[number]): number => candidate.parameters.typeIdentities.length +
    candidate.parameters.lifetimeIdentities.length + candidate.parameters.constIdentities.length;
  candidates.sort((left, right) => parameterCount(right) - parameterCount(left));
  const selected: typeof candidates = [];
  for (const candidate of candidates) {
    const view = candidate.view;
    const covered = selected.some(({ view: pattern }) => {
      if (pattern.declaration !== view.declaration || pattern.fields.length !== view.fields.length ||
        pattern.fields.some((field, index) => field.declaration !== view.fields[index]?.declaration ||
          field.storageIndex !== view.fields[index]?.storageIndex)) return false;
      return rustProjectViewMatches(pattern, view.sourceCarrier, view.targetCarrier);
    });
    if (!covered) selected.push(candidate);
  }
  const components = new Map(context.sourcePackages.packages.flatMap(entry => entry.sourceFiles.map(file => [file, entry.componentId] as const)));
  return Object.freeze(selected.map(({ view }) => {
    const sourceFile = context.ast.getFileName(context.ast.getSourceFile(view.declaration));
    const targetFile = rustStructuralObjectCarrierValue(view.targetCarrier)?.ownerFileName;
    if (targetFile === undefined || !components.has(sourceFile) || !components.has(targetFile)) {
      failTargetAnalysisInvariant("tsonic-rust", "A native project view implementation requires exact source and destination package owners.", view.declaration);
    }
    return Object.freeze({ ...view, ownerFileName: components.get(sourceFile) === components.get(targetFile) ? sourceFile : targetFile });
  }));
}
