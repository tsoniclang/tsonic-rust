import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustAnalysisContext } from "../program/context.js";

export function collectRustSourcePackageBoundaries(
  context: RustAnalysisContext,
  sourceFiles: readonly SourceFile[],
  rootComponentId: string,
): {
  readonly externallyExtensibleDeclarations: ReadonlySet<Node>;
  readonly closedSourceFiles: ReadonlySet<SourceFile>;
  readonly publishedDeclarations: ReadonlySet<Node>;
} {
  const externallyExtensibleDeclarations = new Set<Node>();
  const closedSourceFiles = new Set<SourceFile>();
  const publishedDeclarations = new Set<Node>();
  const sourceFileByName = new Map(sourceFiles.map((sourceFile) =>
    [normalizeSourceFileName(context.ast.getFileName(sourceFile)), sourceFile] as const));
  for (const sourcePackage of context.sourcePackages.packages) {
    const publishesLibrary = sourcePackage.componentId !== rootComponentId ||
      context.rootPublishesLibrary;
    if (!context.rootPublishesLibrary) {
      for (const fileName of sourcePackage.sourceFiles) {
        const sourceFile = sourceFileByName.get(normalizeSourceFileName(fileName));
        if (sourceFile !== undefined) {
          closedSourceFiles.add(sourceFile);
        }
      }
    }
    if (!publishesLibrary) continue;
    for (const sourceExport of sourcePackage.exports) {
      const sourceFile = sourceFileByName.get(normalizeSourceFileName(sourceExport.sourceFile));
      if (sourceFile === undefined) {
        continue;
      }
      for (const exported of context.source.navigation.moduleExports(sourceFile)) {
        publishedDeclarations.add(exported.declaration);
        if (context.ast.is.IsClassDeclaration(exported.declaration)) {
          externallyExtensibleDeclarations.add(exported.declaration);
          for (const member of context.ast.members(exported.declaration)) {
            if (member !== undefined && context.ast.is.IsMethodDeclaration(member) &&
              !context.ast.hasModifierKind(member, "private")) publishedDeclarations.add(member);
          }
        }
      }
    }
  }
  return Object.freeze({ externallyExtensibleDeclarations, closedSourceFiles, publishedDeclarations });
}

function normalizeSourceFileName(value: string): string {
  return value.split("\\").join("/");
}
