import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import {
  KindNumericLiteral,
  type SourceLiteralIndex,
  type SourceLiteralValue,
} from "@tsonic/target-api/source";

const rustTypeSyntaxRootKinds: ReadonlySet<string> = new Set([
  "KindInterfaceDeclaration",
  "KindTypeAliasDeclaration",
  "KindTypeQuery",
  "KindTypeReference",
  "KindUnionType",
  "KindIntersectionType",
  "KindConditionalType",
  "KindInferType",
  "KindArrayType",
  "KindIndexedAccessType",
  "KindLiteralType",
  "KindThisType",
  "KindMappedType",
  "KindTupleType",
  "KindOptionalType",
  "KindRestType",
  "KindParenthesizedType",
  "KindFunctionType",
  "KindConstructorType",
  "KindTemplateLiteralType",
  "KindImportType",
  "KindTypeLiteral",
  "KindTypeOperator",
  "KindTypePredicate",
]);

export function rustNumericLiteralIsFinite(literal: SourceLiteralValue | undefined): boolean {
  return literal?.form === "numeric" && literal.number !== undefined;
}

export function analyzeRustNumericLiteralAdmission(
  ast: AstReader,
  sourceFiles: readonly SourceFile[],
  literalValues: SourceLiteralIndex,
  isNativeNode: (node: Node) => boolean,
): readonly TargetDiagnostic[] {
  const diagnostics: TargetDiagnostic[] = [];
  const pending: Node[] = [];
  const enqueue = (child: Node | undefined): void => {
    if (child !== undefined) pending.push(child);
  };
  for (const sourceFile of sourceFiles) {
    pending.push(sourceFile);
    while (pending.length > 0) {
      const node = pending.pop()!;
      if (!isNativeNode(node)) continue;
      const kind = ast.kindName(node);
      if (kind === KindNumericLiteral) {
        if (!rustNumericLiteralIsFinite(literalValues.literalValue.get(node))) {
          diagnostics.push({
            code: "RUST_NUMERIC_LITERAL_NOT_FINITE",
            category: "error",
            source: "tsonic-rust",
            message: "Numeric literal is not a finite double-precision value.",
            sourceNode: node,
            evidence: ["target.capability=rust.syntax.numeric-literal"],
          });
        }
        continue;
      }
      if (rustTypeSyntaxRootKinds.has(kind)) continue;
      const first = pending.length;
      ast.forEachChild(node, enqueue);
      for (let left = first, right = pending.length - 1; left < right; left += 1, right -= 1) {
        const swap = pending[left]!;
        pending[left] = pending[right]!;
        pending[right] = swap;
      }
    }
  }
  return Object.freeze(diagnostics);
}
