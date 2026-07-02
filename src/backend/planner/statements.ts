import type { Node, TargetTypeRef } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  BinaryExpression_OperatorToken,
  BinaryExpression_Right,
  KindAsteriskEqualsToken,
  KindMinusEqualsToken,
  KindPercentEqualsToken,
  KindPlusEqualsToken,
  KindSlashEqualsToken,
  ForStatement_Condition,
  ForStatement_Incrementor,
  ForStatement_Initializer,
  IfStatement_ElseStatement,
  IfStatement_ThenStatement,
  KindBinaryExpression,
  KindBlock,
  KindCallExpression,
  KindEqualsToken,
  KindExpressionStatement,
  KindForStatement,
  KindIdentifier,
  KindIfStatement,
  KindNumericLiteral,
  KindPostfixUnaryExpression,
  KindPrefixUnaryExpression,
  KindReturnStatement,
  KindStringLiteral,
  KindVariableDeclaration,
  KindVariableStatement,
  KindWhileStatement,
  Node_Expression,
  Node_Initializer,
  Node_Name,
  Node_Type,
  PrefixUnaryExpression_Operand,
} from "../../common/source-ast.js";
import { rustTargetOperationFactKey } from "../../source/rust-facts/keys.js";
import { isRustBoolCarrier } from "../../source/rust-target-types.js";
import type { RustBlock, RustStmt } from "../rust-ast/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "./diagnostics.js";
import { expressionCarrier, planExpression } from "./expressions.js";
import { diagnosticInput, isValidRustIdentifier } from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import { rustTypeFromCarrier } from "./render-types.js";

const nodeFlagsConst = 1 << 1;

export function planStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const { ast } = context.input;
  const kind = ast.kindName(node);
  switch (kind) {
    case KindVariableStatement: {
      return planVariableStatement(node, context);
    }
    case KindReturnStatement: {
      const expression = Node_Expression(node);
      if (expression === undefined) {
        return [{ kind: "return" }];
      }
      const planned = planExpression(expression, context);
      return planned === undefined ? undefined : [{ kind: "return", expr: planned }];
    }
    case KindExpressionStatement: {
      return planExpressionStatement(node, context);
    }
    case KindIfStatement: {
      return planIfStatement(node, context);
    }
    case KindWhileStatement: {
      return planWhileStatement(node, context);
    }
    case KindForStatement: {
      return planForStatement(node, context);
    }
    case KindBlock: {
      const body = planBlockLike(node, context);
      return body === undefined ? undefined : [{ kind: "scope", body }];
    }
    default: {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.statement",
        "The Rust target does not support this statement.",
      ));
      return undefined;
    }
  }
}

export function planBlockLike(node: Node, context: RustPlanContext): RustBlock | undefined {
  const { ast } = context.input;
  const statements: RustStmt[] = [];
  const children = ast.kindName(node) === KindBlock ? ast.statements(node) : [node];
  let failed = false;
  for (const child of children) {
    if (child === undefined) {
      continue;
    }
    const planned = planStatement(child, context);
    if (planned === undefined) {
      failed = true;
      continue;
    }
    statements.push(...planned);
  }
  return failed ? undefined : { statements };
}

function collectVariableDeclarations(node: Node, context: RustPlanContext): readonly Node[] {
  const { ast } = context.input;
  const declarations: Node[] = [];
  const visit = (candidate: Node): void => {
    if (ast.kindName(candidate) === KindVariableDeclaration) {
      declarations.push(candidate);
      return;
    }
    ast.forEachChild(candidate, (child) => {
      if (child !== undefined) {
        visit(child);
      }
    });
  };
  visit(node);
  return declarations;
}

function isConstDeclarationList(node: Node | undefined): boolean {
  if (node === undefined) {
    return false;
  }
  const flags = (node as unknown as { readonly Flags?: unknown }).Flags;
  return typeof flags === "number" && (flags & nodeFlagsConst) !== 0;
}

function declarationListOf(statement: Node): Node | undefined {
  const value = (statement as unknown as Record<string, unknown>)["DeclarationList"];
  return typeof value === "object" && value !== null ? (value as Node) : undefined;
}

export function planVariableStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const { ast } = context.input;
  const declarations = collectVariableDeclarations(node, context);
  if (declarations.length !== 1) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.variable",
      "Variable statements must declare exactly one binding.",
    ));
    return undefined;
  }
  const declaration = declarations[0];
  if (declaration === undefined) {
    return undefined;
  }
  const nameNode = Node_Name(declaration);
  const name = nameNode === undefined ? "" : ast.kindName(nameNode) === KindIdentifier ? ast.text(nameNode) : "";
  if (!isValidRustIdentifier(name)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.variable",
      "Variable declarations require a plain identifier that is valid in Rust.",
    ));
    return undefined;
  }
  const initializer = Node_Initializer(declaration);
  if (initializer === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.variable",
      "Variable declarations require an initializer.",
    ));
    return undefined;
  }
  const planned = planExpression(initializer, context);
  if (planned === undefined) {
    return undefined;
  }
  const typeNode = Node_Type(declaration);
  const annotatedCarrier = typeNode === undefined
    ? undefined
    : context.input.facts.getRuntimeCarrierFact(typeNode)?.carrier;
  let rustType;
  if (typeNode !== undefined) {
    rustType = rustTypeFromCarrier(annotatedCarrier);
    if (rustType === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, typeNode),
        "rust.backend.variable",
        "Variable type annotation has no supported Rust carrier fact.",
      ));
      return undefined;
    }
  }
  const isConst = isConstDeclarationList(declarationListOf(node) ?? node);
  const mutable = !isConst && (context.mutatedNames?.has(name) ?? false);
  return [{
    kind: "let",
    name,
    mutable,
    ...(rustType === undefined ? {} : { type: rustType }),
    init: planned,
  }];
}

function planUpdateStatement(expression: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const { ast } = context.input;
  const fact = context.input.facts.getFact(expression, rustTargetOperationFactKey);
  if (fact === undefined || fact.kind !== "operator-token" || (fact.operator !== "+=" && fact.operator !== "-=")) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, expression),
      "rust.backend.operator",
      "Increment/decrement requires a finalized Rust update-operator fact.",
    ));
    return undefined;
  }
  const operand = PrefixUnaryExpression_Operand(expression);
  if (operand === undefined || ast.kindName(operand) !== KindIdentifier) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, expression),
      "rust.backend.operator",
      "Increment/decrement targets must be identifiers.",
    ));
    return undefined;
  }
  const target = ast.text(operand);
  if (!isValidRustIdentifier(target)) {
    return undefined;
  }
  return [{ kind: "assign", target, operator: fact.operator, value: { kind: "int-literal", text: "1" } }];
}

function planExpressionStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const { ast } = context.input;
  const expression = Node_Expression(node);
  if (expression === undefined) {
    return undefined;
  }
  const expressionKind = ast.kindName(expression);
  if (expressionKind === KindBinaryExpression) {
    const operatorToken = BinaryExpression_OperatorToken(expression);
    const operatorKind = operatorToken === undefined ? "" : ast.kindName(operatorToken);
    const compoundTokens = [
      KindPlusEqualsToken,
      KindMinusEqualsToken,
      KindAsteriskEqualsToken,
      KindSlashEqualsToken,
      KindPercentEqualsToken,
    ];
    if (operatorKind === KindEqualsToken || compoundTokens.includes(operatorKind)) {
      const left = BinaryExpression_Left(expression);
      const right = BinaryExpression_Right(expression);
      if (left === undefined || right === undefined || ast.kindName(left) !== KindIdentifier) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, expression),
          "rust.backend.assignment",
          "Assignments must target a plain identifier.",
        ));
        return undefined;
      }
      const target = ast.text(left);
      if (!isValidRustIdentifier(target)) {
        return undefined;
      }
      if (operatorKind !== KindEqualsToken) {
        const fact = context.input.facts.getFact(expression, rustTargetOperationFactKey);
        if (fact === undefined || fact.kind !== "operator-token") {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, expression),
            "rust.backend.operator",
            "Compound assignment requires a finalized Rust operator fact.",
          ));
          return undefined;
        }
        const value = planExpression(right, context);
        return value === undefined ? undefined : [{ kind: "assign", target, operator: fact.operator, value }];
      }
      const value = planExpression(right, context);
      if (value === undefined) {
        return undefined;
      }
      // Clippy assign_op_pattern: `x = x <op> rhs` lowers to `x <op>= rhs`.
      if (
        value.kind === "binary" &&
        value.left.kind === "path" &&
        value.left.path === target &&
        ["+", "-", "*", "/", "%"].includes(value.operator)
      ) {
        return [{ kind: "assign", target, operator: `${value.operator}=`, value: value.right }];
      }
      return [{ kind: "assign", target, operator: "=", value }];
    }
  }
  if (expressionKind === KindPostfixUnaryExpression || expressionKind === KindPrefixUnaryExpression) {
    return planUpdateStatement(expression, context);
  }
  if (expressionKind === KindCallExpression) {
    const planned = planExpression(expression, context);
    return planned === undefined ? undefined : [{ kind: "expr", expr: planned }];
  }
  context.diagnostics.push(unsupportedConstructDiagnostic(
    diagnosticInput(context, node),
    "rust.backend.statement",
    "Expression statements support only calls, assignments, and increments.",
  ));
  return undefined;
}

function planCondition(condition: Node, context: RustPlanContext, construct: string) {
  const carrier: TargetTypeRef | undefined = expressionCarrier(condition, context);
  if (!isRustBoolCarrier(carrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, condition),
      "rust.backend.condition",
      `${construct} conditions require a finalized bool carrier fact.`,
    ));
    return undefined;
  }
  return planExpression(condition, context);
}

function planEmbeddedBlock(node: Node | undefined, context: RustPlanContext): RustBlock | undefined {
  if (node === undefined) {
    return { statements: [] };
  }
  return planBlockLike(node, context);
}

function planIfStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const condition = Node_Expression(node);
  if (condition === undefined) {
    return undefined;
  }
  const planned = planCondition(condition, context, "if");
  if (planned === undefined) {
    return undefined;
  }
  const thenBlock = planEmbeddedBlock(IfStatement_ThenStatement(node), context);
  const elseStatement = IfStatement_ElseStatement(node);
  const elseBlock = elseStatement === undefined ? undefined : planEmbeddedBlock(elseStatement, context);
  if (thenBlock === undefined || (elseStatement !== undefined && elseBlock === undefined)) {
    return undefined;
  }
  return [{
    kind: "if",
    condition: planned,
    then: thenBlock,
    ...(elseBlock === undefined ? {} : { else: elseBlock }),
  }];
}

function planWhileStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const condition = Node_Expression(node);
  if (condition === undefined) {
    return undefined;
  }
  const planned = planCondition(condition, context, "while");
  if (planned === undefined) {
    return undefined;
  }
  const body = planEmbeddedBlock(statementBody(node), context);
  return body === undefined ? undefined : [{ kind: "while", condition: planned, body }];
}

function planForStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const initializer = ForStatement_Initializer(node);
  const condition = ForStatement_Condition(node);
  const incrementor = ForStatement_Incrementor(node);
  if (initializer === undefined || condition === undefined || incrementor === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.loop",
      "For statements require initializer, condition, and incrementor.",
    ));
    return undefined;
  }
  const initStatements = planVariableStatement(initializer, context);
  const conditionExpr = planCondition(condition, context, "for");
  const incrementStatements = planIncrementor(incrementor, context);
  const body = planEmbeddedBlock(statementBody(node), context);
  if (initStatements === undefined || conditionExpr === undefined || incrementStatements === undefined || body === undefined) {
    return undefined;
  }
  const loopBody: RustBlock = { statements: [...body.statements, ...incrementStatements] };
  return [{
    kind: "scope",
    body: {
      statements: [
        ...initStatements,
        { kind: "while", condition: conditionExpr, body: loopBody },
      ],
    },
  }];
}

function planIncrementor(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const { ast } = context.input;
  const kind = ast.kindName(node);
  if (kind === KindPostfixUnaryExpression || kind === KindPrefixUnaryExpression) {
    return planUpdateStatement(node, context);
  }
  context.diagnostics.push(unsupportedConstructDiagnostic(
    diagnosticInput(context, node),
    "rust.backend.loop",
    "For incrementors support only increment/decrement of an identifier.",
  ));
  return undefined;
}

function statementBody(statement: Node): Node | undefined {
  const value = (statement as unknown as Record<string, unknown>)["Statement"];
  return typeof value === "object" && value !== null ? (value as Node) : undefined;
}

export function isConstLiteralInitializer(node: Node, context: RustPlanContext): boolean {
  const kind = context.input.ast.kindName(node);
  return kind === KindNumericLiteral || kind === KindStringLiteral || kind === "KindTrueKeyword" || kind === "KindFalseKeyword";
}
