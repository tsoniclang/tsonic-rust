import { Node_Expression } from "@tsonic/target-api/source";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustAnalysisContext } from "../program/context.js";

export function collectRustThrownClassDeclarations(
  context: RustAnalysisContext,
  sourceFiles: readonly SourceFile[],
): ReadonlySet<Node> {
  const declarations = new Set<Node>();
  const visit = (node: Node): void => {
    if (context.ast.kindName(node) === "KindThrowStatement") {
      const expression = Node_Expression(context.ast, node);
      if (expression !== undefined) {
        const semantics = context.source.semantics.forNode(expression);
        const type = semantics.types.expressionType(expression);
        const symbol = type === undefined ? undefined : semantics.declarations.typeSymbol(type);
        const declaration = symbol === undefined
          ? undefined
          : semantics.declarations.primarySymbolDeclaration(symbol);
        if (declaration !== undefined && context.ast.is.IsClassDeclaration(declaration)) {
          declarations.add(declaration);
        }
      }
    }
    context.ast.forEachChild(node, (child) => {
      if (child !== undefined) visit(child);
    });
  };
  for (const sourceFile of sourceFiles) visit(sourceFile);
  return declarations;
}
