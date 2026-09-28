import type { AstReader, Node, ReadonlySourceFactResolver, SourceFile } from "@tsonic/tsts";
import { createTsonicAttributeApplicationFactIndex } from "@tsonic/source-core/facts";
import type { TsonicAttributeApplicationFact } from "@tsonic/source-core/facts";
import { isAstNode } from "@tsonic/target-api/source";
import type { SourceReferenceNavigation } from "@tsonic/target-api/source";

export interface RustAttributeApplicationFactIndex {
  forDeclaration(declaration: Node): readonly TsonicAttributeApplicationFact[];
}

export function createRustAttributeApplicationFactIndex(
  source: {
    readonly ast: AstReader;
    readonly sourceFiles: readonly SourceFile[];
    readonly sourceFacts: Pick<ReadonlySourceFactResolver, "getFact">;
    readonly navigation: Pick<SourceReferenceNavigation, "sourceReferenceFor" | "declarationFor">;
  },
): RustAttributeApplicationFactIndex {
  const byDeclaration = new Map<Node, TsonicAttributeApplicationFact[]>();
  const ast = source.ast;
  const applications = createTsonicAttributeApplicationFactIndex({
    ast,
    sourceFiles: source.sourceFiles.filter(file => !ast.isDeclarationFile(file)),
    sourceFacts: source.sourceFacts,
  });
  for (const sourceFile of source.sourceFiles) {
    for (const fact of applications.forSourceFile(sourceFile)) {
      const target = selectedTarget(fact, sourceFile);
      if (target !== undefined) {
        const entries = byDeclaration.get(target) ?? [];
        entries.push(fact);
        byDeclaration.set(target, entries);
      }
    }
  }
  const frozenByDeclaration = new Map([...byDeclaration].map(([node, applications]) => [node, Object.freeze(applications)]));
  return Object.freeze({
    forDeclaration: (node: Node) => frozenByDeclaration.get(node) ?? emptyApplications,
  });

  function selectedTarget(fact: TsonicAttributeApplicationFact, file: SourceFile): Node | undefined {
    if (fact.applicationPlacement === "module") return fact.applicationTarget === file ? file : undefined;
    if (!isAstNode(ast, fact.applicationTarget)) return undefined;
    const query = ast.as.AsTypeQueryNode(fact.applicationTarget);
    const subject = query?.ExprName ?? fact.applicationTarget;
    return source.navigation.sourceReferenceFor(subject)?.declaration ?? source.navigation.declarationFor(subject);
  }
}

const emptyApplications: readonly TsonicAttributeApplicationFact[] = Object.freeze([]);
