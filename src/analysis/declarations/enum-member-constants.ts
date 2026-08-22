import type {
  Node,
  SourceFile,
} from "@tsonic/tsts";
import type {
  TargetSourceProgram,
} from "@tsonic/target-api/source";

export interface RustEnumMemberConstantIndex {
  forMember(node: Node): { readonly value: string | number } | undefined;
}

export function analyzeRustEnumMemberConstants(
  source: TargetSourceProgram,
  sourceFiles: readonly SourceFile[],
): RustEnumMemberConstantIndex {
  const constants = new WeakMap<Node, { readonly value: string | number }>();
  for (const sourceFile of sourceFiles) {
    visit(sourceFile);
  }
  const index: RustEnumMemberConstantIndex = {
    forMember(node: Node) {
      return constants.get(node);
    },
  };
  return Object.freeze(index);

  function visit(node: Node): void {
    if (source.ast.kindName(node) === "KindEnumMember") {
      const value = source.semantics.forNode(node).types.constantValue(node);
      if (typeof value === "number" || typeof value === "string") {
        constants.set(node, Object.freeze({ value }));
      }
    }
    source.ast.forEachChild(node, (child) => {
      if (child !== undefined) {
        visit(child);
      }
    });
  }
}
