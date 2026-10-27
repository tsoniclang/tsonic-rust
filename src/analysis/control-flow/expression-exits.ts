import type { Node } from "@tsonic/tsts";
import { Node_Expression, Node_Operand, ObjectLiteralProperty_Value, SpreadAssignment_Expression,
  BinaryExpression_Left, BinaryExpression_Right, ElementAccessExpression_ArgumentExpression, ConditionalExpression_Condition } from "@tsonic/target-api/source";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustExpressionExitProducer } from "../program/records/operations/expression-exits.js";
import { isRustNeverCarrier } from "../../target-model/types/index.js";
import { rustMemberAccessReceiver } from "../../target-model/syntax/expressions.js";

export function analyzeRustExpressionExits(program: {
  readonly source: Pick<RustAnalysisProgram["source"], "ast">;
  readonly records: Pick<RustAnalysisProgram["records"], "optionalChain" | "targetOperation" | "runtimeCarrier">;
}, nodes: readonly Node[],
  producer: RustExpressionExitProducer): void {
  const { ast } = program.source;
  const exits = new Map<Node, boolean>();
  const present = (nodes: readonly (Node | undefined)[]): readonly Node[] => nodes.filter((node): node is Node => node !== undefined);
  const place = (node: Node | undefined): readonly Node[] => node === undefined ? [] : ast.is.IsPropertyAccessExpression(node) ? present([Node_Expression(ast, node)])
    : ast.is.IsElementAccessExpression(node) ? present([Node_Expression(ast, node), ElementAccessExpression_ArgumentExpression(ast, node)]) : [];
  const operands = (node: Node): readonly Node[] => {
    switch (ast.kindName(node)) {
      case "KindCallExpression":
      case "KindNewExpression": {
        if (program.records.optionalChain.get(node) !== undefined) return present([rustMemberAccessReceiver(ast, Node_Expression(ast, node))]);
        const callee = Node_Expression(ast, node);
        const operation = program.records.targetOperation.get(node);
        const receiver = operation?.kind === "source-call" && "classReceiver" in operation.target && operation.target.classReceiver !== undefined
          ? operation.target.classReceiver : rustMemberAccessReceiver(ast, callee);
        const valueCallee = operation?.kind === "source-call" && (operation.target.form === "callable" || operation.target.form === "constructor-value");
        return present([valueCallee ? callee : receiver, ...ast.arguments(node).map(argument => argument !== undefined && ast.is.IsSpreadElement(argument)
          ? Node_Expression(ast, argument) : argument)]);
      }
      case "KindPropertyAccessExpression": return present([Node_Expression(ast, node)]);
      case "KindElementAccessExpression": return program.records.optionalChain.get(node) === undefined ? place(node) : present([Node_Expression(ast, node)]);
      case "KindArrayLiteralExpression": return present(ast.elements(node).map(element => element !== undefined && ast.is.IsSpreadElement(element) ? Node_Expression(ast, element) : element));
      case "KindObjectLiteralExpression": return present(ast.properties(node).map(property => property === undefined ? undefined
        : ast.is.IsSpreadAssignment(property) ? SpreadAssignment_Expression(ast, property) : ObjectLiteralProperty_Value(ast, property)));
      case "KindBinaryExpression": {
        const left = BinaryExpression_Left(ast, node);
        const right = BinaryExpression_Right(ast, node);
        const token = ast.operatorKindName(node);
        if (token === "KindAmpersandAmpersandToken" || token === "KindBarBarToken" || token === "KindQuestionQuestionToken") return present([left]);
        return token === "KindEqualsToken" ? [...place(left), ...present([right])] : present([left, right]);
      }
      case "KindConditionalExpression": return present([ConditionalExpression_Condition(ast, node)]);
      case "KindPrefixUnaryExpression":
      case "KindPostfixUnaryExpression": return present([Node_Operand(ast, node)]);
      case "KindParenthesizedExpression":
      case "KindNonNullExpression":
      case "KindAsExpression":
      case "KindTypeAssertionExpression":
      case "KindSatisfiesExpression":
      case "KindAwaitExpression":
      case "KindYieldExpression":
      case "KindTypeOfExpression":
      case "KindVoidExpression": return present([Node_Expression(ast, node)]);
      default: return [];
    }
  };
  const visit = (node: Node): boolean => {
    const previous = exits.get(node);
    if (previous !== undefined) return previous;
    const prefix: Node[] = [];
    for (const operand of operands(node)) {
      if (visit(operand)) {
        producer.publish(node, { prefix: Object.freeze(prefix), terminal: operand });
        exits.set(node, true);
        return true;
      }
      prefix.push(operand);
    }
    const selected = isRustNeverCarrier(program.records.runtimeCarrier.get(node)?.carrier);
    exits.set(node, selected);
    return selected;
  };
  for (const node of nodes) visit(node);
}
