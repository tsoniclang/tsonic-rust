import type { AstReader, Node } from "@tsonic/tsts";
import type { RustSafetyApplicationFactIndex } from "./application-index.js";

export function rustSourceHasExplicitUnsafeContext(
  ast: AstReader, subject: Node, applications: RustSafetyApplicationFactIndex,
): boolean {
  let child = subject;
  for (let parent = ast.parent(child); parent !== undefined; child = parent, parent = ast.parent(parent)) {
    const selected = applications.operationForSubject(parent);
    if (selected?.kind === "unsafe-context" && selected.fact.kind === "expression" &&
      selected.fact.expression === child) return true;
    if (ast.is.IsBlock(parent) || ast.is.IsSourceFile(parent)) {
      const statements = ast.statements(parent);
      const first = statements[0];
      const expression = first === undefined ? undefined : ast.as.AsExpressionStatement(first)?.Expression;
      const marker = expression === undefined ? undefined : applications.operationForExpression(expression);
      if (statements.indexOf(child) > 0 && marker?.kind === "unsafe-context" && marker.fact.kind === "remaining-block") return true;
    }
    if (independentSafetyBoundaries.has(ast.kindName(parent))) return false;
  }
  return false;
}

const independentSafetyBoundaries: ReadonlySet<string> = new Set([
  "KindFunctionDeclaration", "KindMethodDeclaration", "KindMethodSignature", "KindConstructor",
  "KindConstructorDeclaration", "KindGetAccessor", "KindSetAccessor",
]);
