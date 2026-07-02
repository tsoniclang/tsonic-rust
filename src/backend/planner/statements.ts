import type { Node, TargetTypeRef } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  BinaryExpression_OperatorToken,
  BinaryExpression_Right,
  CatchClause_Block,
  CatchClause_VariableDeclaration,
  ElementAccessExpression_ArgumentExpression,
  TryStatement_CatchClause,
  TryStatement_FinallyBlock,
  TryStatement_TryBlock,
  ForInOrOfStatement_Initializer,
  ForInOrOfStatement_Statement,
  IterationStatement_Statement,
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
import { rustMutatedBindingFactKey, rustMutatedReferentFactKey, rustTargetOperationFactKey } from "../../source/rust-facts/keys.js";
import { rustTypeFromCarrierInContext as renderRustTypeInContext } from "./render-types.js";
import { isRustBoolCarrier } from "../../source/rust-target-types.js";
import type { RustBlock, RustExpr, RustStmt } from "../rust-ast/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "./diagnostics.js";
import { expressionCarrier, planExpression } from "./expressions.js";
import { diagnosticInput, isValidRustIdentifier, rustValueName } from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import { rustTypeFromCarrierInContext } from "./render-types.js";

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
    case "KindForOfStatement": {
      return planForOfStatement(node, context);
    }
    case "KindThrowStatement": {
      return planThrowStatement(node, context);
    }
    case "KindTryStatement": {
      return planTryStatement(node, context);
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
  const sourceName = nameNode === undefined ? "" : ast.kindName(nameNode) === KindIdentifier ? ast.text(nameNode) : "";
  const name = rustValueName(sourceName);
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
  const initializerFact = context.input.facts.getFact(initializer, rustTargetOperationFactKey);
  if (initializerFact !== undefined && initializerFact.kind === "array-literal" && initializerFact.lane === "sparse") {
    return planSparseArrayLet(node, declaration, name, initializer, initializerFact, context);
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
    rustType = rustTypeFromCarrierInContext(annotatedCarrier, context);
    if (rustType === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, typeNode),
        "rust.backend.variable",
        "Variable type annotation has no supported Rust carrier fact.",
      ));
      return undefined;
    }
  }
  if (context.emittedLocalNames !== undefined) {
    if (context.emittedLocalNames.has(name)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, declaration),
        "rust.backend.naming",
        `Binding '${sourceName}' collides with another binding after deterministic snake_case renaming.`,
      ));
      return undefined;
    }
    context.emittedLocalNames.add(name);
  }
  const declarationCarrier = context.input.facts.getRuntimeCarrierFact(declaration)?.carrier;
  const ownedBinding = declarationCarrier === undefined || declarationCarrier.kind !== "pointer";
  const mutable = context.input.facts.getFact(declaration, rustMutatedBindingFactKey) !== undefined ||
    (ownedBinding && context.input.facts.getFact(declaration, rustMutatedReferentFactKey) !== undefined);
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
  const target = rustValueName(ast.text(operand));
  if (!isValidRustIdentifier(target)) {
    return undefined;
  }
  return [{ kind: "assign", target: { kind: "path", path: target }, operator: fact.operator, value: { kind: "int-literal", text: "1" } }];
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
    if (operatorKind === KindEqualsToken) {
      const runtimeSet = context.input.facts.getFact(expression, rustTargetOperationFactKey);
      if (runtimeSet !== undefined && runtimeSet.kind === "runtime-set") {
        return planRuntimeSetStatement(expression, runtimeSet, context);
      }
    }
    if (operatorKind === KindEqualsToken || compoundTokens.includes(operatorKind)) {
      const left = BinaryExpression_Left(expression);
      const right = BinaryExpression_Right(expression);
      if (left !== undefined && right !== undefined && ast.kindName(left) === "KindPropertyAccessExpression") {
        const leftFact = context.input.facts.getFact(left, rustTargetOperationFactKey);
        if (leftFact !== undefined && leftFact.kind === "source-field") {
          const target = planExpression(left, context);
          const value = planExpression(right, context);
          if (target === undefined || value === undefined) {
            return undefined;
          }
          if (operatorKind === KindEqualsToken) {
            return [{ kind: "assign", target, operator: "=", value }];
          }
          const compoundFact = context.input.facts.getFact(expression, rustTargetOperationFactKey);
          if (compoundFact === undefined || compoundFact.kind !== "operator-token") {
            context.diagnostics.push(missingFactDiagnostic(
              diagnosticInput(context, expression),
              "rust.backend.operator",
              "Compound field assignment requires a finalized Rust operator fact.",
            ));
            return undefined;
          }
          return [{ kind: "assign", target, operator: compoundFact.operator, value }];
        }
      }
      if (left === undefined || right === undefined || ast.kindName(left) !== KindIdentifier) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, expression),
          "rust.backend.assignment",
          "Assignments must target a plain identifier.",
        ));
        return undefined;
      }
      const target = rustValueName(ast.text(left));
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
        return value === undefined ? undefined : [{ kind: "assign", target: { kind: "path", path: target }, operator: fact.operator, value }];
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
        return [{ kind: "assign", target: { kind: "path", path: target }, operator: `${value.operator}=`, value: value.right }];
      }
      return [{ kind: "assign", target: { kind: "path", path: target }, operator: "=", value }];
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
  const body = planEmbeddedBlock(IterationStatement_Statement(node), context);
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
  const body = planEmbeddedBlock(IterationStatement_Statement(node), context);
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



export function isConstLiteralInitializer(node: Node, context: RustPlanContext): boolean {
  const kind = context.input.ast.kindName(node);
  return kind === KindNumericLiteral || kind === KindStringLiteral || kind === "KindTrueKeyword" || kind === "KindFalseKeyword";
}

function planRuntimeSetStatement(
  expression: Node,
  fact: Extract<import("../../source/rust-facts/keys.js").RustTargetOperationFact, { kind: "runtime-set" }>,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const { ast } = context.input;
  const left = BinaryExpression_Left(expression);
  const right = BinaryExpression_Right(expression);
  if (left === undefined || right === undefined) {
    return undefined;
  }
  const receiverNode = Node_Expression(left);
  const receiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
  const value = planExpression(right, context);
  if (receiver === undefined || value === undefined) {
    return undefined;
  }
  const leftKind = ast.kindName(left);
  if (fact.target.form === "index") {
    const indexNode = ElementAccessExpression_ArgumentExpression(left);
    const index = indexNode === undefined ? undefined : planExpression(indexNode, context);
    if (index === undefined) {
      return undefined;
    }
    return [{
      kind: "index-assign",
      receiver,
      index: { kind: "cast", expr: index, to: "usize" },
      value,
    }];
  }
  if (fact.target.form === "receiver-method") {
    const args: RustExpr[] = [];
    if (leftKind === "KindElementAccessExpression") {
      const indexNode = ElementAccessExpression_ArgumentExpression(left);
      const index = indexNode === undefined ? undefined : planExpression(indexNode, context);
      if (index === undefined) {
        return undefined;
      }
      args.push(index);
    }
    args.push(value);
    const casts = fact.target.argCasts ?? [];
    const shaped = args.map((argument, index): RustExpr => {
      const cast = casts[index];
      return cast === undefined ? argument : { kind: "cast", expr: argument, to: cast };
    });
    return [{
      kind: "expr",
      expr: { kind: "method-call", receiver, method: fact.target.name, args: shaped },
    }];
  }
  context.diagnostics.push(unsupportedConstructDiagnostic(
    diagnosticInput(context, expression),
    "rust.js.assignment",
    "Runtime set operation form is not supported.",
  ));
  return undefined;
}

function planForOfStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const { ast } = context.input;
  const fact = context.input.facts.getFact(node, rustTargetOperationFactKey);
  if (fact === undefined || fact.kind !== "for-of") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.loop",
      "for-of statements require a finalized iteration fact.",
    ));
    return undefined;
  }
  const initializer = ForInOrOfStatement_Initializer(node);
  let binding = "";
  if (initializer !== undefined) {
    const declarations = collectVariableDeclarations(initializer, context);
    const nameNode = declarations.length === 1 ? Node_Name(declarations[0]) : undefined;
    binding = nameNode !== undefined && ast.kindName(nameNode) === KindIdentifier ? rustValueName(ast.text(nameNode)) : "";
  }
  if (!isValidRustIdentifier(binding)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.loop",
      "for-of bindings require a plain identifier.",
    ));
    return undefined;
  }
  const iterableNode = Node_Expression(node);
  const iterable = iterableNode === undefined ? undefined : planExpression(iterableNode, context);
  if (iterable === undefined) {
    return undefined;
  }
  const bodyNode = ForInOrOfStatement_Statement(node);
  const body = bodyNode === undefined ? { statements: [] } : planBlockLike(bodyNode, context);
  if (body === undefined) {
    return undefined;
  }
  const iterChain: RustExpr = {
    kind: "method-call",
    receiver: { kind: "method-call", receiver: iterable, method: "iter", args: [] },
    method: fact.style,
    args: [],
  };
  return [{ kind: "for", binding, iterable: iterChain, body }];
}

function planSparseArrayLet(
  statement: Node,
  declaration: Node,
  name: string,
  initializer: Node,
  fact: Extract<import("../../source/rust-facts/keys.js").RustTargetOperationFact, { kind: "array-literal" }>,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const { ast } = context.input;
  const elementType = renderRustTypeInContext(fact.elementCarrier, context);
  const arrayType = renderRustTypeInContext(fact.resultCarrier, context);
  if (elementType === undefined || arrayType === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.js.sparse-array",
      "Sparse array lane carrier cannot be rendered.",
    ));
    return undefined;
  }
  const statements: RustStmt[] = [{
    kind: "let",
    name,
    mutable: true,
    type: arrayType,
    init: {
      kind: "call",
      path: "js_abi::JsArray::with_length",
      args: [{ kind: "int-literal", text: String(fact.length) }],
    },
  }];
  const elements = ast.elements(initializer);
  for (const [index, element] of elements.entries()) {
    if (element === undefined || ast.kindName(element) === "KindOmittedExpression") {
      continue;
    }
    const planned = planExpression(element, context);
    if (planned === undefined) {
      return undefined;
    }
    statements.push({
      kind: "expr",
      expr: {
        kind: "method-call",
        receiver: { kind: "path", path: name },
        method: "set",
        args: [{ kind: "int-literal", text: String(index) }, planned],
      },
    });
  }
  void statement;
  return statements;
}

function planThrowStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const fact = context.input.facts.getFact(node, rustTargetOperationFactKey);
  if (fact === undefined || fact.kind !== "throw-op") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.error.throw",
      "throw supports only `throw new Error(message)` with a finalized throw fact.",
    ));
    return undefined;
  }
  if (context.fallibleContext !== true) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.error.throw",
      "throw requires a fallible lowering context.",
    ));
    return undefined;
  }
  const { ast } = context.input;
  const newExpression = Node_Expression(node);
  const [messageNode] = newExpression === undefined ? [] : ast.arguments(newExpression);
  const message = messageNode === undefined
    ? { kind: "string-literal" as const, value: "" }
    : planExpression(messageNode, context);
  return message === undefined ? undefined : [{ kind: "throw", message }];
}

function planTryStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const { ast } = context.input;
  const tryBlock = TryStatement_TryBlock(node);
  const catchClause = TryStatement_CatchClause(node);
  const catchBlock = CatchClause_Block(catchClause);
  const finallyBlock = TryStatement_FinallyBlock(node);
  if (tryBlock === undefined || catchBlock === undefined || finallyBlock !== undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.error.try",
      "try statements require a catch clause and no finally block.",
    ));
    return undefined;
  }
  // The try body lowers into a Result-returning closure; control flow that
  // escapes the closure is unrepresentable.
  let escapes = false;
  const scan = (candidate: Node): void => {
    if (escapes) {
      return;
    }
    const kind = ast.kindName(candidate);
    // Nested functions are their own control-flow boundary.
    if (kind === "KindArrowFunction" || kind === "KindFunctionExpression" || kind === "KindFunctionDeclaration") {
      return;
    }
    if (kind === KindReturnStatement || kind === "KindBreakStatement" || kind === "KindContinueStatement") {
      escapes = true;
      return;
    }
    ast.forEachChild(candidate, (child) => {
      if (child !== undefined) {
        scan(child);
      }
    });
  };
  scan(tryBlock);
  if (escapes) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.error.try",
      "try blocks must not contain return, break, or continue.",
    ));
    return undefined;
  }
  const tryContext: RustPlanContext = { ...context, fallibleContext: true };
  const body = planBlockLike(tryBlock, tryContext);
  const catchBody = planBlockLike(catchBlock, context);
  if (body === undefined || catchBody === undefined) {
    return undefined;
  }
  const bindingNode = Node_Name(CatchClause_VariableDeclaration(catchClause));
  const bindingSource = bindingNode === undefined ? "" : ast.text(bindingNode);
  let binding = bindingSource.length === 0 ? "_" : rustValueName(bindingSource);
  if (binding !== "_") {
    let used = false;
    const findUse = (candidate: Node): void => {
      if (used) {
        return;
      }
      if (ast.kindName(candidate) === KindIdentifier && ast.text(candidate) === bindingSource) {
        used = true;
        return;
      }
      ast.forEachChild(candidate, (child) => {
        if (child !== undefined) {
          findUse(child);
        }
      });
    };
    findUse(catchBlock);
    if (!used) {
      binding = `_${binding}`;
    }
  }
  return [{ kind: "try-catch", body, catchBinding: binding, catchBody }];
}
