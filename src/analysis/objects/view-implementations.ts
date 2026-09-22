import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { inferRustTargetGenericBindings, rustStructuralObjectCarrierValue, rustTargetGenericReferences,
  substituteRustTargetGenerics } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustAnalysisContext } from "../program/context.js";

interface RustProjectView {
  readonly declaration: Node;
  readonly sourceCarrier: TargetTypeRef;
  readonly targetCarrier: TargetTypeRef;
  readonly fields: readonly { readonly declaration: Node; readonly storageIndex: number }[];
}

export function selectRustProjectViewImplementations<View extends RustProjectView>(
  views: readonly View[], context: RustAnalysisContext,
): readonly (View & { readonly ownerFileName: string })[] {
  const candidates = views.map(view => ({ view, parameters: rustTargetGenericReferences(view.sourceCarrier) }));
  const parameterCount = (candidate: typeof candidates[number]): number => candidate.parameters.typeNames.length +
    candidate.parameters.lifetimeIdentities.length + candidate.parameters.constIdentities.length;
  candidates.sort((left, right) => parameterCount(right) - parameterCount(left));
  const selected: typeof candidates = [];
  for (const candidate of candidates) {
    const view = candidate.view;
    const covered = selected.some(({ view: pattern, parameters }) => {
      if (pattern.declaration !== view.declaration || pattern.fields.length !== view.fields.length ||
        pattern.fields.some((field, index) => field.declaration !== view.fields[index]?.declaration ||
          field.storageIndex !== view.fields[index]?.storageIndex)) return false;
      const bindings = inferRustTargetGenericBindings(pattern.sourceCarrier, view.sourceCarrier, {
        typeNames: new Set(parameters.typeNames), lifetimeIdentities: new Set(parameters.lifetimeIdentities),
        constIdentities: new Set(parameters.constIdentities),
      });
      if (bindings === undefined || bindings.types.size !== parameters.typeNames.length ||
        bindings.lifetimes.size !== parameters.lifetimeIdentities.length || bindings.consts.size !== parameters.constIdentities.length) return false;
      return rustTargetTypeRefEquals(substituteRustTargetGenerics(pattern.sourceCarrier, bindings.types, bindings.lifetimes, bindings.consts), view.sourceCarrier) &&
        rustTargetTypeRefEquals(substituteRustTargetGenerics(pattern.targetCarrier, bindings.types, bindings.lifetimes, bindings.consts), view.targetCarrier);
    });
    if (!covered) selected.push(candidate);
  }
  const components = new Map(context.sourcePackages.packages.flatMap(entry => entry.sourceFiles.map(file => [file, entry.componentId] as const)));
  return Object.freeze(selected.map(({ view }) => {
    const sourceFile = context.ast.getFileName(context.ast.getSourceFile(view.declaration));
    const targetFile = rustStructuralObjectCarrierValue(view.targetCarrier)?.ownerFileName;
    if (targetFile === undefined || !components.has(sourceFile) || !components.has(targetFile)) {
      throw new Error("A native project view implementation requires exact source and destination package owners.");
    }
    return Object.freeze({ ...view, ownerFileName: components.get(sourceFile) === components.get(targetFile) ? sourceFile : targetFile });
  }));
}
