import type { SourceFile } from "@tsonic/tsts";
import type { SourceProgramNavigation } from "@tsonic/target-api/source";
import { targetStronglyConnectedComponents, type TargetGraphComponentsSelection } from "@tsonic/target-api/analysis";

type SourceModuleGraph = Pick<SourceProgramNavigation, "moduleDependencies">;

export function stronglyConnectedSourceFiles(
  navigation: SourceModuleGraph,
  sourceFiles: ReadonlySet<SourceFile>,
  maximumSteps?: number,
): TargetGraphComponentsSelection<SourceFile> {
  return targetStronglyConnectedComponents(sourceFiles, sourceFile =>
    navigation.moduleDependencies(sourceFile).map(dependency => dependency.sourceFile), maximumSteps);
}

export function cyclicSourceFiles(
  navigation: SourceModuleGraph,
  sourceFiles: readonly SourceFile[],
  maximumSteps?: number,
): { readonly kind: "resolved"; readonly sourceFiles: ReadonlySet<SourceFile> } |
  Extract<TargetGraphComponentsSelection<SourceFile>, { readonly kind: "unresolved" }> {
  const selection = stronglyConnectedSourceFiles(navigation, new Set(sourceFiles), maximumSteps);
  if (selection.kind === "unresolved") return selection;
  const cyclic = new Set<SourceFile>();
  for (const component of selection.components) {
    const first = component[0];
    const componentIsCyclic = component.length > 1 || first !== undefined &&
      navigation.moduleDependencies(first).some((dependency) => dependency.sourceFile === first);
    if (componentIsCyclic) {
      for (const sourceFile of component) {
        cyclic.add(sourceFile);
      }
    }
  }
  return Object.freeze({ kind: "resolved", sourceFiles: cyclic });
}
