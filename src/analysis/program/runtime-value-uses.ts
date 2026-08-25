import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceProgramNavigation } from "@tsonic/target-api/source";
import type { RustSafetyApplicationFactIndex } from "../safety/application-index.js";
import type { RustDeclarationApplicationIndex } from "../declarations/declaration-applications.js";

export interface RustRuntimeValueUsePlan {
  hasFirstClassUse(declaration: Node): boolean;
  hasSameFileRuntimeUseBeforeDeclaration(declaration: Node): boolean;
}

export function createRustRuntimeValueUsePlan(input: {
  readonly ast: AstReader;
  readonly navigation: SourceProgramNavigation;
  readonly safetyApplications: RustSafetyApplicationFactIndex;
  readonly declarationApplications: RustDeclarationApplicationIndex;
}): RustRuntimeValueUsePlan {
  const firstClassUseByDeclaration = new WeakMap<Node, boolean>();
  const earlyRuntimeUseByDeclaration = new WeakMap<Node, boolean>();
  return Object.freeze({
    hasFirstClassUse(declaration: Node) {
      const existing = firstClassUseByDeclaration.get(declaration);
      if (existing !== undefined) {
        return existing;
      }
      const observed = input.navigation.declarationUses(declaration).some(
        (use) => use.kind === "first-class" &&
          !input.safetyApplications.isCompileTimeApplicationReference(
            declaration,
            use.reference,
          ) && !input.declarationApplications.isCompileTimeApplicationReference(
            declaration,
            use.reference,
          ),
      );
      firstClassUseByDeclaration.set(declaration, observed);
      return observed;
    },
    hasSameFileRuntimeUseBeforeDeclaration(declaration: Node) {
      const existing = earlyRuntimeUseByDeclaration.get(declaration);
      if (existing !== undefined) {
        return existing;
      }
      const declarationFile = input.ast.getSourceFile(declaration);
      const declarationRange = input.ast.authoredRange(declaration);
      const observed = declarationFile === undefined || declarationRange.kind !== "authored"
        ? true
        : input.navigation.declarationUses(declaration).some((use) => {
            if (use.kind === "source-linkage" || use.kind === "type-only" ||
              input.ast.getSourceFile(use.reference) !== declarationFile ||
              input.safetyApplications.isCompileTimeApplicationReference(
                declaration,
                use.reference,
              ) || input.declarationApplications.isCompileTimeApplicationReference(
                declaration,
                use.reference,
              )) {
              return false;
            }
            const range = input.ast.authoredRange(use.reference);
            return range.kind !== "authored" || range.start < declarationRange.start;
          });
      earlyRuntimeUseByDeclaration.set(declaration, observed);
      return observed;
    },
  });
}
