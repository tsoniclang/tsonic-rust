import type { Node, SourceFile } from "@tsonic/tsts";
import { tsonicAttributeBuilderFactKey } from "@tsonic/source-core/facts";
import type { TsonicAttributeApplicationFact } from "@tsonic/source-core/facts";
import { isAstNode } from "@tsonic/target-api/source";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

export interface RustAttributeApplicationFactIndex {
  forDeclaration(declaration: Node): readonly TsonicAttributeApplicationFact[];
}

export function createRustAttributeApplicationFactIndex(
  source: TargetSourceProgram,
): RustAttributeApplicationFactIndex {
  const byDeclaration = new Map<Node, TsonicAttributeApplicationFact[]>();
  const ast = source.ast;
  const visit = (node: Node, sourceFile: SourceFile): void => {
    const fact = source.sourceFacts.getFact(node, tsonicAttributeBuilderFactKey);
    if (fact?.kind === "application") {
      const target = selectedTarget(fact, sourceFile);
      if (target !== undefined) {
        const entries = byDeclaration.get(target) ?? [];
        entries.push(fact);
        byDeclaration.set(target, entries);
      }
      return;
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child, sourceFile); });
  };
  for (const file of source.sourceFiles) if (file !== undefined && !ast.isDeclarationFile(file)) visit(file, file);
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
