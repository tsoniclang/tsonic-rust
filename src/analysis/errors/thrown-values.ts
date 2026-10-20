import type { RustFactWalk } from "../program/walk.js";
import { resolveExpressionCarrier } from "../expressions/carriers.js";
import { selectRustProgramErrorConversion } from "../../target-model/conversions/program-error.js";
import { isRustProgramErrorCarrier } from "../../target-model/types/index.js";
import { requireRustRecord } from "../program/records/required-records.js";
import { Node_Expression } from "@tsonic/target-api/source";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustAnalysisContext } from "../program/context.js";

export function collectRustThrownClassDeclarations(
  context: RustAnalysisContext,
  sourceFiles: readonly SourceFile[],
): ReadonlySet<Node> {
  const declarations = new Set<Node>();
  const visit = (node: Node): void => {
    if (!context.isNativeNode(node)) return;
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

export function recordThrowFacts(walk: RustFactWalk, statement: Node, sourceFile: SourceFile): void {
  const expression = Node_Expression(walk.context.ast, statement);
  if (expression === undefined) {
    return;
  }
  const carrier = resolveExpressionCarrier(walk, expression, sourceFile, undefined);
  const conversion = carrier === undefined ? undefined : selectRustProgramErrorConversion(carrier,
    undefined, walk.context.typeDefinitions);
  if (conversion !== undefined) {
    requireRustRecord(walk.context.requiredRecords, "targetOperation", statement, "throw-op", "analysis/errors/thrown-values.ts");
    walk.context.records.targetOperations.source(statement, Object.freeze({
      kind: "throw-op",
      operationId: "tsonic.rust.error.throw",
      error: Object.freeze({ kind: "conversion", expression, conversion }),
    }));
    return;
  }
  if (carrier !== undefined && isRustProgramErrorCarrier(carrier)) {
    requireRustRecord(walk.context.requiredRecords, "targetOperation", statement, "throw-op", "analysis/errors/thrown-values.ts");
    walk.context.records.targetOperations.source(statement, {
      kind: "throw-op",
      operationId: "tsonic.rust.error.rethrow",
      error: { kind: "program", expression, carrier },
    });
  }
}
