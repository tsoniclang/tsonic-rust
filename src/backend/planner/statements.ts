import type { Node } from "@tsonic/tsts";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import type { TargetTypeRef } from "../../policy/types.js";
import { isRustAssignmentOperator } from "../../common/rust-syntax.js";
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
  Node_Operand,
} from "../../common/source-ast.js";
import { rustMutatedBindingFactKey, rustMutatedReferentFactKey, rustTargetOperationFactKey } from "../../source/rust-facts/keys.js";
import { rustTypeFromCarrierInContext as renderRustTypeInContext } from "./render-types.js";
import {
  isRustBoolCarrier,
  isRustUnitCarrier,
  rustLocationTargetType,
} from "../../source/rust-target-types.js";
import { validateRustFinalizedOperationAbi } from "../../source/rust-facts/finalized-operation-abi.js";
import { rustTargetOperationIsDirectLocation } from "../../source/rust-facts/target-operation.js";
import type { RustBlock, RustExpr, RustStmt } from "../rust-ast/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "./diagnostics.js";
import {
  expressionCarrier,
  planExpression,
  planFinalizedSourceInput,
  planFinalizedTargetInput,
  providerSelectedCallMatches,
  requireProviderArgumentPassingFacts,
} from "./expressions.js";
import { diagnosticInput, isValidRustIdentifier, rustSourceName } from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import { rustTypeFromCarrierInContext } from "./render-types.js";
import {
  planRustPromotedStorageWrite,
  rustLocationStorageForDeclaration,
} from "./typed-locations.js";
import { requireRustLocationValueCarrier } from "./generic-requirements.js";

export function planStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const diagnosticCount = context.diagnostics.length;
  const planned = planStatementInner(node, context);
  if (planned === undefined && context.diagnostics.length === diagnosticCount) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.statement-finalization",
      "Statement planning returned no Rust AST and no specific diagnostic.",
    ));
  }
  return planned;
}

function planStatementInner(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const { ast } = context.input;
  const kind = ast.kindName(node);
  switch (kind) {
    case KindVariableStatement: {
      return planVariableStatement(node, context);
    }
    case KindReturnStatement: {
      const expression = Node_Expression(context.input.ast, node);
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
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.block-statement",
        "Source block contains an undefined statement slot.",
      ));
      failed = true;
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
  const nameNode = Node_Name(context.input.ast, declaration);
  const sourceName = nameNode === undefined ? "" : ast.kindName(nameNode) === KindIdentifier ? ast.text(nameNode) : "";
  const name = rustSourceName(context, sourceName);
  if (!isValidRustIdentifier(name)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.variable",
      "Variable declarations require a plain identifier that is valid in Rust.",
    ));
    return undefined;
  }
  const initializer = Node_Initializer(context.input.ast, declaration);
  if (initializer === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.variable",
      "Variable declarations require an initializer.",
    ));
    return undefined;
  }
  const initializerFact = context.input.facts.getFact(initializer, rustTargetOperationFactKey);
  const locationStorage = rustLocationStorageForDeclaration(declaration, context);
  if (initializerFact !== undefined && initializerFact.kind === "array-literal" && initializerFact.lane === "sparse") {
    if (locationStorage !== undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, declaration),
        "rust.backend.typed-location-storage",
        "Sparse JavaScript array storage cannot be promoted to a Rust typed location.",
      ));
      return undefined;
    }
    return planSparseArrayLet(node, declaration, name, initializer, initializerFact, context);
  }
  const planned = planExpression(initializer, context);
  if (planned === undefined) {
    return undefined;
  }
  const typeNode = Node_Type(context.input.ast, declaration);
  const annotatedCarrier = typeNode === undefined
    ? undefined
    : context.input.facts.getRuntimeCarrierFact(typeNode)?.carrier;
  let rustType;
  if (typeNode !== undefined) {
    const renderedCarrier = locationStorage === undefined
      ? annotatedCarrier
      : rustLocationTargetType(locationStorage.valueCarrier);
    rustType = rustTypeFromCarrierInContext(renderedCarrier, context);
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
        `Binding '${sourceName}' collides with another binding in the same scope.`,
      ));
      return undefined;
    }
    context.emittedLocalNames.add(name);
  }
  const declarationCarrier = context.input.facts.getRuntimeCarrierFact(declaration)?.carrier;
  if (declarationCarrier === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.variable-carrier",
      "Variable declaration has no finalized Rust carrier fact.",
    ));
    return undefined;
  }
  if (locationStorage !== undefined &&
    (!rustTargetTypeRefEquals(declarationCarrier, locationStorage.valueCarrier) ||
      (annotatedCarrier !== undefined &&
        !rustTargetTypeRefEquals(annotatedCarrier, locationStorage.valueCarrier)))) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, declaration),
      "rust.backend.typed-location-storage-carrier",
      "Promoted Rust storage conflicts with its finalized declaration carrier.",
    ));
    return undefined;
  }
  const ownedBinding = declarationCarrier.kind !== "pointer";
  const mutable = locationStorage === undefined &&
    (context.input.facts.getFact(declaration, rustMutatedBindingFactKey) !== undefined ||
      (ownedBinding && context.input.facts.getFact(declaration, rustMutatedReferentFactKey) !== undefined));
  const init = locationStorage === undefined
    ? planned
    : (() => {
        if (!requireRustLocationValueCarrier(
          locationStorage.valueCarrier,
          declaration,
          context,
        )) {
          return undefined;
        }
        context.usedAliases?.add("rt");
        return { kind: "call", path: "rt::Location::allocate", args: [planned] } as const;
      })();
  if (init === undefined) {
    return undefined;
  }
  return [{
    kind: "let",
    name,
    mutable,
    ...(rustType === undefined ? {} : { type: rustType }),
    init,
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
  if (!selectedOperatorMatches(expression, fact, context)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, expression),
      "rust.backend.operator-selected-evidence",
      "Update operation fact conflicts with the TSTS-selected operator fact.",
    ));
    return undefined;
  }
  const operand = Node_Operand(context.input.ast, expression);
  if (operand === undefined || ast.kindName(operand) !== KindIdentifier) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, expression),
      "rust.backend.operator",
      "Increment/decrement targets must be identifiers.",
    ));
    return undefined;
  }
  const target = rustSourceName(context, ast.text(operand));
  if (!isValidRustIdentifier(target)) {
    return undefined;
  }
  const promoted = planRustPromotedStorageWrite(
    operand,
    fact.operator,
    { kind: "int-literal", text: "1" },
    context,
    planExpression,
  );
  if (promoted.handled) {
    return promoted.statement === undefined ? undefined : [promoted.statement];
  }
  return [{ kind: "assign", target: { kind: "path", path: target }, operator: fact.operator, value: { kind: "int-literal", text: "1" } }];
}

function planExpressionStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const { ast } = context.input;
  const expression = Node_Expression(context.input.ast, node);
  if (expression === undefined) {
    return undefined;
  }
  const expressionKind = ast.kindName(expression);
  if (expressionKind === KindBinaryExpression) {
    const operatorToken = BinaryExpression_OperatorToken(context.input.ast, expression);
    const operatorKind = operatorToken === undefined ? "" : ast.kindName(operatorToken);
    const compoundTokens = [
      KindPlusEqualsToken,
      KindMinusEqualsToken,
      KindAsteriskEqualsToken,
      KindSlashEqualsToken,
      KindPercentEqualsToken,
    ];
    let selectedAssignmentFact: Extract<
      import("../../source/rust-facts/keys.js").RustTargetOperationFact,
      { kind: "operator-token" }
    > | undefined;
    if (operatorKind === KindEqualsToken) {
      const assignment = context.input.facts.getFact(expression, rustTargetOperationFactKey);
      if (assignment !== undefined && assignment.kind === "runtime-set") {
        return planRuntimeSetStatement(expression, assignment, context);
      }
      if (assignment === undefined || assignment.kind !== "operator-token" ||
        !["=", "+=", "-=", "*=", "/=", "%="].includes(assignment.operator)) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, expression),
          "rust.backend.assignment",
          "Assignment requires a finalized Rust assignment fact.",
        ));
        return undefined;
      }
      if (!selectedOperatorMatches(expression, assignment, context)) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, expression),
          "rust.backend.assignment-selected-evidence",
          "Assignment operation fact conflicts with the TSTS-selected operator fact.",
        ));
        return undefined;
      }
      selectedAssignmentFact = assignment;
    }
    if (operatorKind === KindEqualsToken || compoundTokens.includes(operatorKind)) {
      const left = BinaryExpression_Left(context.input.ast, expression);
      const right = BinaryExpression_Right(context.input.ast, expression);
      if (left === undefined || right === undefined) {
        return undefined;
      }
      const target = ast.kindName(left) === KindIdentifier
        ? (() => {
            const path = rustSourceName(context, ast.text(left));
            return isValidRustIdentifier(path) ? { kind: "path" as const, path } : undefined;
          })()
        : rustTargetOperationIsDirectLocation(
            context.input.facts.getFact(left, rustTargetOperationFactKey),
          )
          ? planExpression(left, context)
          : undefined;
      if (target === undefined) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, expression),
          "rust.backend.assignment",
          "Assignments require a plain binding or a finalized direct Rust location.",
        ));
        return undefined;
      }
      const fact = selectedAssignmentFact ??
        context.input.facts.getFact(expression, rustTargetOperationFactKey);
      if (fact === undefined || fact.kind !== "operator-token") {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, expression),
          "rust.backend.operator",
          "Compound assignment requires a finalized Rust operator fact.",
        ));
        return undefined;
      }
      if (!selectedOperatorMatches(expression, fact, context)) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, expression),
          "rust.backend.operator-selected-evidence",
          "Compound assignment fact conflicts with the TSTS-selected operator fact.",
        ));
        return undefined;
      }
      const operator = fact.operator;
      if (!isRustAssignmentOperator(operator)) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, expression),
          "rust.backend.assignment-operator",
          "Finalized assignment fact does not contain a Rust assignment operator.",
        ));
        return undefined;
      }
      const valueNode = operatorKind === KindEqualsToken && operator !== "="
        ? BinaryExpression_Right(context.input.ast, right)
        : right;
      if (valueNode === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, expression),
          "rust.backend.assignment-shape",
          "Finalized equivalent assignment requires the proven binary value operand.",
        ));
        return undefined;
      }
      const value = planExpression(valueNode, context);
      if (value === undefined) {
        return undefined;
      }
      const promoted = planRustPromotedStorageWrite(
        left,
        operator,
        value,
        context,
        planExpression,
      );
      if (promoted.handled) {
        return promoted.statement === undefined ? undefined : [promoted.statement];
      }
      return operator === "+=" || operator === "-=" || operator === "*=" || operator === "/=" || operator === "%="
        ? [{ kind: "assign", target, operator, value }]
        : operator === "="
          ? [{ kind: "assign", target, operator, value }]
          : undefined;
    }
  }
  if (expressionKind === KindPostfixUnaryExpression || expressionKind === KindPrefixUnaryExpression) {
    return planUpdateStatement(expression, context);
  }
  if (expressionKind === KindCallExpression || expressionKind === "KindAwaitExpression" ||
    expressionKind === "KindYieldExpression") {
    const planned = planExpression(expression, context);
    return planned === undefined ? undefined : [{ kind: "expr", expr: planned }];
  }
  context.diagnostics.push(unsupportedConstructDiagnostic(
    diagnosticInput(context, node),
    "rust.backend.statement",
    "Expression statements support only calls, assignments, increments, awaits, and checked generator yields.",
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
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, context.sourceFile),
      "rust.backend.embedded-statement",
      "Control-flow construct has no source body statement.",
    ));
    return undefined;
  }
  return planBlockLike(node, context);
}

function planIfStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const condition = Node_Expression(context.input.ast, node);
  if (condition === undefined) {
    return undefined;
  }
  const planned = planCondition(condition, context, "if");
  if (planned === undefined) {
    return undefined;
  }
  const thenBlock = planEmbeddedBlock(IfStatement_ThenStatement(context.input.ast, node), context);
  const elseStatement = IfStatement_ElseStatement(context.input.ast, node);
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
  const condition = Node_Expression(context.input.ast, node);
  if (condition === undefined) {
    return undefined;
  }
  const planned = planCondition(condition, context, "while");
  if (planned === undefined) {
    return undefined;
  }
  const body = planEmbeddedBlock(IterationStatement_Statement(context.input.ast, node), context);
  return body === undefined ? undefined : [{ kind: "while", condition: planned, body }];
}

function planForStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const initializer = ForStatement_Initializer(context.input.ast, node);
  const condition = ForStatement_Condition(context.input.ast, node);
  const incrementor = ForStatement_Incrementor(context.input.ast, node);
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
  const body = planEmbeddedBlock(IterationStatement_Statement(context.input.ast, node), context);
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
  const left = BinaryExpression_Left(context.input.ast, expression);
  const right = BinaryExpression_Right(context.input.ast, expression);
  if (left === undefined || right === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, expression),
      "rust.backend.runtime-set-shape",
      "Runtime setter fact requires concrete assignment target and value nodes.",
    ));
    return undefined;
  }
  const leftKind = ast.kindName(left);
  const expectedOperationKind = leftKind === "KindPropertyAccessExpression"
    ? "property-set"
    : leftKind === "KindElementAccessExpression"
      ? "index-set"
      : undefined;
  const indexNode = leftKind === "KindElementAccessExpression"
    ? ElementAccessExpression_ArgumentExpression(context.input.ast, left)
    : undefined;
  const sourceArgumentNodes = indexNode === undefined ? [right] : [indexNode, right];
  if (!validateRustFinalizedOperationAbi(fact.abi) ||
    expectedOperationKind === undefined || fact.abi.operationKind !== expectedOperationKind ||
    (expectedOperationKind === "index-set" && indexNode === undefined) ||
    sourceArgumentNodes.length !== fact.abi.sourceArguments.length ||
    fact.abi.sourceArguments.some((argument) => argument.disposition !== "runtime") ||
    fact.abi.effects.invocation !== "infallible" || fact.abi.effects.awaiting !== "not-applicable" ||
    fact.abi.result.kind !== "sync" || !isRustUnitCarrier(fact.abi.result.carrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, expression),
      "rust.backend.runtime-set-abi",
      "Runtime setter source shape, effects, and arguments do not match one valid total Rust setter ABI.",
    ));
    return undefined;
  }
  const selectedResult = context.input.facts.getRuntimeCarrierFact(right)?.carrier;
  if (selectedResult === undefined || !selectedOperatorIdentityMatches(
    expression,
    fact.operationId,
    fact.operationId,
    selectedResult,
    context,
  )) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, expression),
      "rust.backend.runtime-set-selected-evidence",
      "Runtime setter fact conflicts with the TSTS-selected assignment operation.",
    ));
    return undefined;
  }
  const receiverNode = Node_Expression(context.input.ast, left);
  if (receiverNode === undefined || fact.abi.targetReceiver.kind !== "input" ||
    fact.abi.targetReceiver.input.mode !== "mut-ref") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, expression),
      "rust.backend.runtime-set-receiver",
      "Runtime setter ABI has no finalized target receiver input.",
    ));
    return undefined;
  }
  const receiver = planFinalizedSourceInput(
    context,
    fact.abi.targetReceiver.input,
    receiverNode,
    sourceArgumentNodes,
    expression,
    "target-receiver",
  );
  if (receiver === undefined) {
    return undefined;
  }
  const targetArguments: RustExpr[] = [];
  for (const input of fact.abi.targetArguments) {
    const planned = planFinalizedTargetInput(context, input, receiverNode, sourceArgumentNodes, expression);
    if (planned === undefined) {
      return undefined;
    }
    targetArguments.push(planned);
  }
  if (fact.abi.target.form === "index") {
    const [index, value] = targetArguments;
    if (index === undefined || value === undefined || targetArguments.length !== 2) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, expression),
        "rust.backend.runtime-index-set-abi",
        "Runtime index setter ABI must finalize exactly index and value target inputs.",
      ));
      return undefined;
    }
    return [{
      kind: "index-assign",
      receiver,
      index,
      value,
    }];
  }
  if (fact.abi.target.form === "receiver-method") {
    return [{
      kind: "expr",
      expr: { kind: "method-call", receiver, method: fact.abi.target.name, args: targetArguments },
    }];
  }
  context.diagnostics.push(unsupportedConstructDiagnostic(
    diagnosticInput(context, expression),
    "rust.js.assignment",
    "Runtime set operation form is not supported.",
  ));
  return undefined;
}

function selectedOperatorMatches(
  expression: Node,
  fact: Extract<import("../../source/rust-facts/keys.js").RustTargetOperationFact, { kind: "operator-token" }>,
  context: RustPlanContext,
): boolean {
  return selectedOperatorIdentityMatches(expression, fact.operationId, fact.operator, fact.resultCarrier, context);
}

function selectedOperatorIdentityMatches(
  expression: Node,
  operationId: string,
  targetOperation: string,
  resultCarrier: TargetTypeRef,
  context: RustPlanContext,
): boolean {
  const selected = context.input.facts.getSelectedTargetOperator(expression);
  return selected !== undefined && selected.operationKind === "operator" &&
    selected.operationId === operationId && selected.targetOperation === targetOperation &&
    selected.resultType !== undefined && rustTargetTypeRefEquals(selected.resultType, resultCarrier);
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
  const selectedIteration = context.input.facts.getSelectedTargetIteration(node);
  if (selectedIteration === undefined || selectedIteration.operationKind !== "iteration" ||
    selectedIteration.operationId !== fact.operationId || selectedIteration.resultType === undefined ||
    !rustTargetTypeRefEquals(selectedIteration.resultType, fact.elementCarrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.iteration-selected-element",
      "Finalized Rust iteration fact conflicts with the TSTS-selected iteration element carrier.",
    ));
    return undefined;
  }
  const initializer = ForInOrOfStatement_Initializer(context.input.ast, node);
  let binding = "";
  if (initializer !== undefined) {
    const declarations = collectVariableDeclarations(initializer, context);
    const nameNode = declarations.length === 1 ? Node_Name(context.input.ast, declarations[0]) : undefined;
    binding = nameNode !== undefined && ast.kindName(nameNode) === KindIdentifier ? rustSourceName(context, ast.text(nameNode)) : "";
  }
  if (!isValidRustIdentifier(binding)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.loop",
      "for-of bindings require a plain identifier.",
    ));
    return undefined;
  }
  const iterableNode = Node_Expression(context.input.ast, node);
  const iterable = iterableNode === undefined ? undefined : planExpression(iterableNode, context);
  if (iterable === undefined) {
    return undefined;
  }
  const bodyNode = ForInOrOfStatement_Statement(context.input.ast, node);
  if (bodyNode === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.iteration-body",
      "for-of statements require a concrete source body.",
    ));
    return undefined;
  }
  const body = planBlockLike(bodyNode, context);
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
  context.usedAliases?.add("js_abi");
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
  const newExpression = Node_Expression(context.input.ast, node);
  const arguments_ = newExpression === undefined ? [] : ast.arguments(newExpression);
  const [messageNode] = arguments_;
  if (newExpression === undefined || ast.kindName(newExpression) !== "KindNewExpression" ||
    messageNode === undefined || arguments_.length !== 1) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.throw-shape",
      "Finalized throw fact must correspond to exactly `throw new Error(message)`.",
    ));
    return undefined;
  }
  const constructor = context.input.facts.getFact(newExpression, rustTargetOperationFactKey);
  if (constructor === undefined || constructor.kind !== "provider-operation" ||
    constructor.operationId !== fact.constructorOperationId || constructor.abi.operationKind !== "constructor" ||
    !providerSelectedCallMatches(newExpression, constructor, context)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, newExpression),
      "rust.backend.throw-constructor",
      "Finalized throw fact conflicts with the selected provider Error constructor ABI.",
    ));
    return undefined;
  }
  if (!requireProviderArgumentPassingFacts(context, constructor, arguments_)) {
    return undefined;
  }
  const message = planExpression(messageNode, context);
  if (message !== undefined) {
    context.usedAliases?.add("rt");
  }
  return message === undefined ? undefined : [{ kind: "throw", message }];
}

function planTryStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const { ast } = context.input;
  const tryBlock = TryStatement_TryBlock(context.input.ast, node);
  const catchClause = TryStatement_CatchClause(context.input.ast, node);
  const catchBlock = CatchClause_Block(context.input.ast, catchClause);
  const finallyBlock = TryStatement_FinallyBlock(context.input.ast, node);
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
  const bindingNode = Node_Name(
    context.input.ast,
    CatchClause_VariableDeclaration(context.input.ast, catchClause),
  );
  const bindingSource = bindingNode === undefined ? "" : ast.text(bindingNode);
  let binding = bindingSource.length === 0 ? "_" : rustSourceName(context, bindingSource);
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
  context.usedAliases?.add("rt");
  return [{ kind: "try-catch", body, catchBinding: binding, catchBody }];
}
