import type { AstReader, Node } from "@tsonic/tsts";
import type { SourceProgramNavigation } from "@tsonic/target-api/source";
import { sourceMayReadBeforeInitialization } from "@tsonic/target-api/source";
import type { RustSafetyApplicationFactIndex } from "../safety/application-index.js";
import type { RustAttributeApplicationFactIndex } from "../attributes/application-index.js";

export interface RustRuntimeValueUsePlan {
  hasFirstClassUse(declaration: Node): boolean;
  hasSameFileRuntimeUseBeforeDeclaration(declaration: Node): boolean;
}

export function createRustRuntimeValueUsePlan(input: {
  readonly ast: AstReader;
  readonly navigation: SourceProgramNavigation;
  readonly safetyApplications: RustSafetyApplicationFactIndex;
  readonly attributeApplications: RustAttributeApplicationFactIndex;
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
          !input.attributeApplications.isCompileTimeReference(use.reference) &&
          !input.safetyApplications.isCompileTimeApplicationReference(
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
      const observed = sourceMayReadBeforeInitialization(declaration, input.ast, input.navigation);
      earlyRuntimeUseByDeclaration.set(declaration, observed);
      return observed;
    },
  });
}
