import type { AstReader, Node } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  BinaryExpression_OperatorToken,
  KindAsteriskEqualsToken,
  KindBinaryExpression,
  KindEqualsToken,
  KindMinusEqualsToken,
  KindPercentEqualsToken,
  KindPlusEqualsToken,
  KindSlashEqualsToken,
  KindIdentifier,
  KindPostfixUnaryExpression,
  KindPrefixUnaryExpression,
  Node_Name,
  Node_Type,
  PrefixUnaryExpression_Operand,
  getPostfixUnaryOperatorText,
  getPrefixUnaryOperatorText,
} from "../../common/source-ast.js";
import { isRustUnitCarrier } from "../../source/rust-target-types.js";
import type { RustBlock, RustFunctionParam, RustItem, RustStmt } from "../rust-ast/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "./diagnostics.js";
import { planBlockLike } from "./statements.js";
import { diagnosticInput, isValidRustIdentifier } from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import { rustTypeFromCarrier } from "./render-types.js";

export function planFunctionDeclaration(node: Node, context: RustPlanContext): RustItem | undefined {
  const { ast } = context.input;
  if (ast.hasModifierKind(node, "async")) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.function",
      "Async functions are not supported by the Rust target.",
    ));
    return undefined;
  }
  const nameNode = Node_Name(node);
  const name = nameNode !== undefined && ast.kindName(nameNode) === KindIdentifier ? ast.text(nameNode) : "";
  if (!isValidRustIdentifier(name)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.function",
      `Function name '${name}' is not a valid Rust identifier.`,
    ));
    return undefined;
  }
  const params: RustFunctionParam[] = [];
  let paramsFailed = false;
  for (const parameter of ast.parameters(node)) {
    if (parameter === undefined) {
      continue;
    }
    const parameterName = ast.text(ast.name(parameter) ?? parameter);
    const parameterCarrier = context.input.facts.getRuntimeCarrierFact(parameter)?.carrier;
    const parameterType = rustTypeFromCarrier(parameterCarrier);
    if (!isValidRustIdentifier(parameterName) || parameterType === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, parameter),
        "rust.backend.parameter",
        `Parameter '${parameterName}' has no supported Rust carrier fact.`,
      ));
      paramsFailed = true;
      continue;
    }
    params.push({ name: parameterName, type: parameterType });
  }
  const returnTypeNode = Node_Type(node);
  if (returnTypeNode === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.function",
      "Functions require an explicit return type annotation.",
    ));
    return undefined;
  }
  const returnCarrier = context.input.facts.getRuntimeCarrierFact(returnTypeNode)?.carrier;
  const isUnit = isRustUnitCarrier(returnCarrier);
  const returnType = isUnit ? undefined : rustTypeFromCarrier(returnCarrier);
  if (!isUnit && returnType === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, returnTypeNode),
      "rust.backend.function",
      "Function return type has no supported Rust carrier fact.",
    ));
    return undefined;
  }
  const bodyNode = ast.body(node);
  if (bodyNode === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.function",
      "Functions require a body.",
    ));
    return undefined;
  }
  const bodyContext: RustPlanContext = { ...context, mutatedNames: collectMutatedNames(ast, bodyNode) };
  const body = planBlockLike(bodyNode, bodyContext);
  if (paramsFailed || body === undefined) {
    return undefined;
  }
  return {
    kind: "function",
    name,
    pub: ast.hasModifierKind(node, "export"),
    params,
    ...(returnType === undefined ? {} : { returnType }),
    body: applyTailReturn(body, returnType !== undefined),
  };
}

// Name-level write analysis over a function body: a binding becomes `let mut`
// only when an assignment or increment/decrement to that name is proven.
export function collectMutatedNames(ast: AstReader, body: Node): ReadonlySet<string> {
  const mutated = new Set<string>();
  const visit = (node: Node): void => {
    const kind = ast.kindName(node);
    if (kind === KindBinaryExpression) {
      const operatorToken = BinaryExpression_OperatorToken(node);
      const writeTokens = [
        KindEqualsToken,
        KindPlusEqualsToken,
        KindMinusEqualsToken,
        KindAsteriskEqualsToken,
        KindSlashEqualsToken,
        KindPercentEqualsToken,
      ];
      if (operatorToken !== undefined && writeTokens.includes(ast.kindName(operatorToken))) {
        const left = BinaryExpression_Left(node);
        if (left !== undefined && ast.kindName(left) === KindIdentifier) {
          mutated.add(ast.text(left));
        }
      }
    } else if (kind === KindPrefixUnaryExpression || kind === KindPostfixUnaryExpression) {
      const operatorText = kind === KindPrefixUnaryExpression
        ? getPrefixUnaryOperatorText(ast, node)
        : getPostfixUnaryOperatorText(ast, node);
      if (operatorText === "++" || operatorText === "--") {
        const operand = PrefixUnaryExpression_Operand(node);
        if (operand !== undefined && ast.kindName(operand) === KindIdentifier) {
          mutated.add(ast.text(operand));
        }
      }
    }
    ast.forEachChild(node, (child) => {
      if (child !== undefined) {
        visit(child);
      }
    });
  };
  visit(body);
  return mutated;
}

function applyTailReturn(body: RustBlock, hasReturnValue: boolean): RustBlock {
  if (!hasReturnValue || body.statements.length === 0) {
    return body;
  }
  const last = body.statements[body.statements.length - 1];
  if (last === undefined || last.kind !== "return" || last.expr === undefined) {
    return body;
  }
  const tail: RustStmt = { kind: "tail", expr: last.expr };
  return { statements: [...body.statements.slice(0, -1), tail] };
}
