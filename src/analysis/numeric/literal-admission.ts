import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import {
  BindingElement_PropertyName,
  KindNumericLiteral,
  parseFiniteNumberLiteral,
} from "@tsonic/target-api/source";

export function rustNumericLiteralIsFinite(ast: AstReader, literal: Node): boolean {
  return parseFiniteNumberLiteral(ast.text(literal)) !== undefined;
}

export function analyzeRustNumericLiteralAdmission(
  ast: AstReader,
  sourceFiles: readonly SourceFile[],
): readonly TargetDiagnostic[] {
  const diagnostics: TargetDiagnostic[] = [];
  for (const sourceFile of sourceFiles) {
    const pending: Node[] = [sourceFile];
    while (pending.length > 0) {
      const node = pending.pop()!;
      if (ast.kindName(node) === KindNumericLiteral && isRustValueNumericLiteral(ast, node) &&
        !rustNumericLiteralIsFinite(ast, node)) {
        diagnostics.push({
          code: "RUST_NUMERIC_LITERAL_NOT_FINITE",
          category: "error",
          source: "tsonic-rust",
          message: "Numeric literal is not a finite double-precision value.",
          sourceNode: node,
          evidence: ["target.capability=rust.syntax.numeric-literal"],
        });
      }
      const children: Node[] = [];
      ast.forEachChild(node, (child) => {
        if (child !== undefined) children.push(child);
      });
      for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]!);
    }
  }
  return Object.freeze(diagnostics);
}

function isRustValueNumericLiteral(ast: AstReader, literal: Node): boolean {
  const parent = ast.parent(literal);
  return parent === undefined || ast.kindName(parent) !== "KindLiteralType" &&
    ast.name(parent) !== literal && BindingElement_PropertyName(ast, parent) !== literal;
}
