import type { SourceFile } from "@tsonic/tsts";
import type { SourceProgramNavigation } from "@tsonic/target-api/source";

type SourceModuleGraph = Pick<SourceProgramNavigation, "moduleDependencies">;

export function stronglyConnectedSourceFiles(
  navigation: SourceModuleGraph,
  sourceFiles: ReadonlySet<SourceFile>,
): readonly (readonly SourceFile[])[] {
  let nextIndex = 0;
  const indexBySourceFile = new Map<SourceFile, number>();
  const lowLinkBySourceFile = new Map<SourceFile, number>();
  const stack: SourceFile[] = [];
  const onStack = new Set<SourceFile>();
  const components: SourceFile[][] = [];
  const visit = (sourceFile: SourceFile): void => {
    const index = nextIndex;
    nextIndex += 1;
    indexBySourceFile.set(sourceFile, index);
    lowLinkBySourceFile.set(sourceFile, index);
    stack.push(sourceFile);
    onStack.add(sourceFile);
    for (const dependency of navigation.moduleDependencies(sourceFile)) {
      const target = dependency.sourceFile;
      if (!sourceFiles.has(target)) {
        continue;
      }
      const targetIndex = indexBySourceFile.get(target);
      if (targetIndex === undefined) {
        visit(target);
        lowLinkBySourceFile.set(
          sourceFile,
          Math.min(lowLinkBySourceFile.get(sourceFile)!, lowLinkBySourceFile.get(target)!),
        );
      } else if (onStack.has(target)) {
        lowLinkBySourceFile.set(
          sourceFile,
          Math.min(lowLinkBySourceFile.get(sourceFile)!, targetIndex),
        );
      }
    }
    if (lowLinkBySourceFile.get(sourceFile) !== index) {
      return;
    }
    const component: SourceFile[] = [];
    while (stack.length > 0) {
      const member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
      if (member === sourceFile) {
        break;
      }
    }
    components.push(component);
  };
  for (const sourceFile of sourceFiles) {
    if (!indexBySourceFile.has(sourceFile)) {
      visit(sourceFile);
    }
  }
  return Object.freeze(components.map((component) => Object.freeze(component)));
}

export function cyclicSourceFiles(
  navigation: SourceModuleGraph,
  sourceFiles: readonly SourceFile[],
): ReadonlySet<SourceFile> {
  const sourceFileSet = new Set(sourceFiles);
  const cyclic = new Set<SourceFile>();
  for (const component of stronglyConnectedSourceFiles(navigation, sourceFileSet)) {
    const first = component[0];
    const componentIsCyclic = component.length > 1 || first !== undefined &&
      navigation.moduleDependencies(first).some((dependency) => dependency.sourceFile === first);
    if (componentIsCyclic) {
      for (const sourceFile of component) {
        cyclic.add(sourceFile);
      }
    }
  }
  return cyclic;
}
