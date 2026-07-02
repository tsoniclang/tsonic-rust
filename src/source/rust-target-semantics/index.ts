import {
  ExtensionLifecycleEvent,
  providerVirtualDeclarationFactKey,
  runtimeCarrierFactKey,
  selectedTargetSignatureFactKey,
  sourcePrimitiveFactKey,
  targetOperationFactKey,
} from "@tsonic/tsts";
import type {
  CompilerExtension,
  ExtensionLifecycleContext,
  Node,
  ProviderDeclarationIdentity,
  SourceFile,
  TargetMember,
  TargetTypeRef,
} from "@tsonic/tsts";
import { tsonicCoreSourceExtensionId } from "@tsonic/source-core";
import type { TargetProviderContext } from "@tsonic/target-api";
import {
  BinaryExpression_Left,
  BinaryExpression_OperatorToken,
  BinaryExpression_Right,
  ForStatement_Condition,
  ForStatement_Incrementor,
  ForStatement_Initializer,
  IfStatement_ElseStatement,
  IfStatement_ThenStatement,
  KindBinaryExpression,
  KindBlock,
  KindBooleanKeyword,
  KindCallExpression,
  KindElementAccessExpression,
  KindEqualsToken,
  KindExpressionStatement,
  KindFalseKeyword,
  KindForStatement,
  KindFunctionDeclaration,
  KindIdentifier,
  KindIfStatement,
  KindNewExpression,
  KindNumericLiteral,
  KindParameter,
  KindParenthesizedExpression,
  KindPostfixUnaryExpression,
  KindPrefixUnaryExpression,
  KindPropertyAccessExpression,
  KindReturnStatement,
  KindStringKeyword,
  KindStringLiteral,
  KindTrueKeyword,
  KindVariableDeclaration,
  KindVariableStatement,
  KindVoidKeyword,
  KindWhileStatement,
  Node_Expression,
  Node_Initializer,
  Node_Type,
  getPostfixUnaryOperatorText,
  getPrefixUnaryOperatorText,
} from "../../common/source-ast.js";
import {
  isRustBoolCarrier,
  isRustIntegerCarrier,
  isRustNumericCarrier,
  isRustSignedNumericCarrier,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
  rustUnitTargetType,
} from "../rust-target-types.js";
import { rustExtensionId, rustTargetOperationFactKey } from "../rust-facts/keys.js";
import type { RustTargetOperationFact } from "../rust-facts/keys.js";
import { collectRustProviderOperationRows } from "../provider-packages/index.js";
import type { RustProviderOperationRow } from "../provider-packages/index.js";
import { rustOperatorCarrierKey, selectRustBinaryOperator } from "./operator-rules.js";

export const rustTargetSemanticsExtensionId = "tsonic.rust.target-semantics";

export function createRustTargetSemanticsExtension(context: TargetProviderContext): CompilerExtension {
  const providerRows = collectRustProviderOperationRows(context.selectedPackages);
  return {
    identity: {
      id: rustTargetSemanticsExtensionId,
      version: "0.0.1",
      capabilityNamespace: rustExtensionId,
    },
    dependencies: {
      dependsOn: [tsonicCoreSourceExtensionId],
      runsAfter: [tsonicCoreSourceExtensionId],
    },
    composition: { kind: "target", target: "rust" },
    initialize(extensionContext): void {
      extensionContext.registerLifecycleHook(
        ExtensionLifecycleEvent.beforeSemanticsFinalized,
        (_request, lifecycleContext) => {
          recordRustFactsBeforeFinalization(lifecycleContext, providerRows);
        },
      );
    },
  };
}

interface RustFactWalk {
  readonly lifecycle: ExtensionLifecycleContext;
  readonly providerRows: readonly RustProviderOperationRow[];
  readonly resolving: Set<object>;
}

const boolCarrier = rustSourcePrimitiveTargetType("bool");

export function recordRustFactsBeforeFinalization(
  lifecycle: ExtensionLifecycleContext,
  providerRows: readonly RustProviderOperationRow[],
): void {
  const walk: RustFactWalk = { lifecycle, providerRows, resolving: new Set() };
  const { ast } = lifecycle.compiler;
  for (const sourceFile of lifecycle.compiler.getSourceFiles()) {
    if (sourceFile === undefined) {
      continue;
    }
    const fileName = ast.getFileName(sourceFile);
    if (fileName.endsWith(".d.ts")) {
      continue;
    }
    for (const statement of ast.statements(sourceFile)) {
      if (statement === undefined) {
        continue;
      }
      const kind = ast.kindName(statement);
      if (kind === KindFunctionDeclaration) {
        recordFunctionFacts(walk, statement, sourceFile);
      } else if (kind === KindVariableStatement) {
        recordVariableStatementFacts(walk, statement, sourceFile);
      }
    }
  }
}

function recordFunctionFacts(walk: RustFactWalk, declaration: Node, sourceFile: SourceFile): void {
  const { ast } = walk.lifecycle.compiler;
  const returnCarrier = resolveTypeNodeCarrier(walk, Node_Type(declaration));
  for (const parameter of ast.parameters(declaration)) {
    if (parameter === undefined) {
      continue;
    }
    const parameterCarrier = resolveTypeNodeCarrier(walk, Node_Type(parameter));
    if (parameterCarrier !== undefined) {
      setCarrierFact(walk, parameter, parameterCarrier);
    }
  }
  const body = ast.body(declaration);
  if (body !== undefined) {
    for (const statement of ast.statements(body)) {
      if (statement !== undefined) {
        recordStatementFacts(walk, statement, sourceFile, returnCarrier);
      }
    }
  }
}

function recordVariableStatementFacts(walk: RustFactWalk, statement: Node, sourceFile: SourceFile): void {
  for (const declaration of collectDescendantsOfKind(walk, statement, KindVariableDeclaration)) {
    const annotated = resolveTypeNodeCarrier(walk, Node_Type(declaration));
    const initializer = Node_Initializer(declaration);
    const initializerCarrier = initializer === undefined
      ? undefined
      : resolveExpressionCarrier(walk, initializer, sourceFile, annotated);
    const effective = annotated ?? initializerCarrier;
    if (effective !== undefined) {
      setCarrierFact(walk, declaration, effective);
    }
  }
}

function recordStatementFacts(
  walk: RustFactWalk,
  statement: Node,
  sourceFile: SourceFile,
  returnCarrier: TargetTypeRef | undefined,
): void {
  const { ast } = walk.lifecycle.compiler;
  const kind = ast.kindName(statement);
  if (kind === KindBlock) {
    for (const child of ast.statements(statement)) {
      if (child !== undefined) {
        recordStatementFacts(walk, child, sourceFile, returnCarrier);
      }
    }
    return;
  }
  if (kind === KindVariableStatement) {
    recordVariableStatementFacts(walk, statement, sourceFile);
    return;
  }
  if (kind === KindReturnStatement) {
    const expression = Node_Expression(statement);
    if (expression !== undefined) {
      resolveExpressionCarrier(walk, expression, sourceFile, returnCarrier);
    }
    return;
  }
  if (kind === KindExpressionStatement) {
    const expression = Node_Expression(statement);
    if (expression === undefined) {
      return;
    }
    if (ast.kindName(expression) === KindBinaryExpression) {
      const operatorToken = BinaryExpression_OperatorToken(expression);
      if (operatorToken !== undefined && ast.kindName(operatorToken) === KindEqualsToken) {
        const left = BinaryExpression_Left(expression);
        const right = BinaryExpression_Right(expression);
        const leftCarrier = left === undefined
          ? undefined
          : resolveExpressionCarrier(walk, left, sourceFile, undefined);
        if (right !== undefined) {
          resolveExpressionCarrier(walk, right, sourceFile, leftCarrier);
        }
        return;
      }
    }
    resolveExpressionCarrier(walk, expression, sourceFile, undefined);
    return;
  }
  if (kind === KindIfStatement) {
    const condition = Node_Expression(statement);
    if (condition !== undefined) {
      resolveExpressionCarrier(walk, condition, sourceFile, boolCarrier);
    }
    const thenStatement = IfStatement_ThenStatement(statement);
    if (thenStatement !== undefined) {
      recordStatementFacts(walk, thenStatement, sourceFile, returnCarrier);
    }
    const elseStatement = IfStatement_ElseStatement(statement);
    if (elseStatement !== undefined) {
      recordStatementFacts(walk, elseStatement, sourceFile, returnCarrier);
    }
    return;
  }
  if (kind === KindWhileStatement) {
    const condition = Node_Expression(statement);
    if (condition !== undefined) {
      resolveExpressionCarrier(walk, condition, sourceFile, boolCarrier);
    }
    const body = statementBody(statement);
    if (body !== undefined) {
      recordStatementFacts(walk, body, sourceFile, returnCarrier);
    }
    return;
  }
  if (kind === KindForStatement) {
    const initializer = ForStatement_Initializer(statement);
    if (initializer !== undefined) {
      for (const declaration of collectDescendantsOfKind(walk, initializer, KindVariableDeclaration)) {
        const annotated = resolveTypeNodeCarrier(walk, Node_Type(declaration));
        const declarationInitializer = Node_Initializer(declaration);
        const initializerCarrier = declarationInitializer === undefined
          ? undefined
          : resolveExpressionCarrier(walk, declarationInitializer, sourceFile, annotated);
        const effective = annotated ?? initializerCarrier;
        if (effective !== undefined) {
          setCarrierFact(walk, declaration, effective);
        }
      }
    }
    const condition = ForStatement_Condition(statement);
    if (condition !== undefined) {
      resolveExpressionCarrier(walk, condition, sourceFile, boolCarrier);
    }
    const incrementor = ForStatement_Incrementor(statement);
    if (incrementor !== undefined) {
      resolveExpressionCarrier(walk, incrementor, sourceFile, undefined);
    }
    const body = statementBody(statement);
    if (body !== undefined) {
      recordStatementFacts(walk, body, sourceFile, returnCarrier);
    }
    return;
  }
}

function statementBody(statement: Node): Node | undefined {
  const value = (statement as unknown as Record<string, unknown>)["Statement"];
  return typeof value === "object" && value !== null ? (value as Node) : undefined;
}

function resolveTypeNodeCarrier(walk: RustFactWalk, typeNode: Node | undefined): TargetTypeRef | undefined {
  if (typeNode === undefined) {
    return undefined;
  }
  const facts = walk.lifecycle.host.facts;
  const existing = facts.get(typeNode, runtimeCarrierFactKey);
  if (existing !== undefined) {
    return existing.carrier;
  }
  const primitive = facts.get(typeNode, sourcePrimitiveFactKey);
  if (primitive !== undefined) {
    return setCarrierFact(walk, typeNode, rustSourcePrimitiveTargetType(primitive.kind));
  }
  const kind = walk.lifecycle.compiler.ast.kindName(typeNode);
  if (kind === KindStringKeyword) {
    return setCarrierFact(walk, typeNode, rustStringTargetType());
  }
  if (kind === KindBooleanKeyword) {
    return setCarrierFact(walk, typeNode, boolCarrier);
  }
  if (kind === KindVoidKeyword) {
    return setCarrierFact(walk, typeNode, rustUnitTargetType());
  }
  return undefined;
}

function resolveExpressionCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const facts = walk.lifecycle.host.facts;
  const existing = facts.get(expression, runtimeCarrierFactKey);
  if (existing !== undefined) {
    return existing.carrier;
  }
  if (walk.resolving.has(expression)) {
    return undefined;
  }
  walk.resolving.add(expression);
  try {
    return resolveExpressionCarrierUncached(walk, expression, sourceFile, expected);
  } finally {
    walk.resolving.delete(expression);
  }
}

function resolveExpressionCarrierUncached(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const kind = walk.lifecycle.compiler.ast.kindName(expression);
  switch (kind) {
    case KindNumericLiteral: {
      if (expected !== undefined && isRustNumericCarrier(expected)) {
        return setCarrierFact(walk, expression, expected);
      }
      return undefined;
    }
    case KindStringLiteral: {
      return setCarrierFact(walk, expression, rustStringTargetType());
    }
    case KindTrueKeyword:
    case KindFalseKeyword: {
      return setCarrierFact(walk, expression, boolCarrier);
    }
    case KindIdentifier: {
      return resolveIdentifierCarrier(walk, expression, sourceFile);
    }
    case KindParenthesizedExpression: {
      const inner = Node_Expression(expression);
      const carrier = inner === undefined
        ? undefined
        : resolveExpressionCarrier(walk, inner, sourceFile, expected);
      return carrier === undefined ? undefined : setCarrierFact(walk, expression, carrier);
    }
    case KindPrefixUnaryExpression:
    case KindPostfixUnaryExpression: {
      return resolveUnaryCarrier(walk, expression, sourceFile, expected, kind);
    }
    case KindBinaryExpression: {
      return resolveBinaryCarrier(walk, expression, sourceFile, expected);
    }
    case KindCallExpression:
    case KindNewExpression: {
      return resolveCallLikeCarrier(walk, expression, sourceFile, kind);
    }
    case KindPropertyAccessExpression: {
      return resolveProviderMemberCarrier(walk, expression, sourceFile, "property");
    }
    case KindElementAccessExpression: {
      return resolveProviderIndexerCarrier(walk, expression, sourceFile);
    }
    default: {
      return undefined;
    }
  }
}

function resolveIdentifierCarrier(walk: RustFactWalk, identifier: Node, sourceFile: SourceFile): TargetTypeRef | undefined {
  const { checker } = walk.lifecycle.compiler;
  const symbol = checker.getResolvedSymbolOrNil(identifier) ?? checker.getSymbolAtLocation(identifier);
  if (symbol === undefined) {
    return undefined;
  }
  const declaration = checker.getSymbolValueDeclaration(symbol) ?? checker.getPrimarySymbolDeclaration(symbol);
  if (declaration === undefined) {
    return undefined;
  }
  const declarationKind = walk.lifecycle.compiler.ast.kindName(declaration);
  if (declarationKind !== KindParameter && declarationKind !== KindVariableDeclaration) {
    return undefined;
  }
  const facts = walk.lifecycle.host.facts;
  const declarationFact = facts.get(declaration, runtimeCarrierFactKey);
  if (declarationFact !== undefined) {
    return setCarrierFact(walk, identifier, declarationFact.carrier);
  }
  const annotated = resolveTypeNodeCarrier(walk, Node_Type(declaration));
  if (annotated !== undefined) {
    setCarrierFact(walk, declaration, annotated);
    return setCarrierFact(walk, identifier, annotated);
  }
  const initializer = Node_Initializer(declaration);
  if (initializer !== undefined) {
    const initializerCarrier = resolveExpressionCarrier(walk, initializer, sourceFile, undefined);
    if (initializerCarrier !== undefined) {
      setCarrierFact(walk, declaration, initializerCarrier);
      return setCarrierFact(walk, identifier, initializerCarrier);
    }
  }
  return undefined;
}

function resolveUnaryCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
  expressionKind: string,
): TargetTypeRef | undefined {
  const operand = (expression as { readonly Operand?: Node }).Operand;
  if (operand === undefined) {
    return undefined;
  }
  const ast = walk.lifecycle.compiler.ast;
  const operatorText = expressionKind === KindPrefixUnaryExpression
    ? getPrefixUnaryOperatorText(ast, expression)
    : getPostfixUnaryOperatorText(ast, expression);
  if (operatorText === "!" && expressionKind === KindPrefixUnaryExpression) {
    const operandCarrier = resolveExpressionCarrier(walk, operand, sourceFile, boolCarrier);
    if (operandCarrier !== undefined && isRustBoolCarrier(operandCarrier)) {
      recordOperatorFacts(walk, expression, "!", boolCarrier, rustOperatorCarrierKey(boolCarrier));
      return setCarrierFact(walk, expression, boolCarrier);
    }
    return undefined;
  }
  if (operatorText === "-" && expressionKind === KindPrefixUnaryExpression) {
    const operandCarrier = resolveExpressionCarrier(walk, operand, sourceFile, expected);
    if (operandCarrier !== undefined && isRustSignedNumericCarrier(operandCarrier)) {
      recordOperatorFacts(walk, expression, "-", operandCarrier, rustOperatorCarrierKey(operandCarrier));
      return setCarrierFact(walk, expression, operandCarrier);
    }
    return undefined;
  }
  if (operatorText === "++" || operatorText === "--") {
    const operandCarrier = resolveExpressionCarrier(walk, operand, sourceFile, undefined);
    if (operandCarrier !== undefined && isRustIntegerCarrier(operandCarrier)) {
      const operator = operatorText === "++" ? "+=" : "-=";
      recordOperatorFacts(walk, expression, operator, operandCarrier, rustOperatorCarrierKey(operandCarrier));
      return setCarrierFact(walk, expression, operandCarrier);
    }
    return undefined;
  }
  return undefined;
}

function resolveBinaryCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const left = BinaryExpression_Left(expression);
  const right = BinaryExpression_Right(expression);
  const ast = walk.lifecycle.compiler.ast;
  const operatorToken = BinaryExpression_OperatorToken(expression);
  if (left === undefined || right === undefined || operatorToken === undefined) {
    return undefined;
  }
  const operatorKind = ast.kindName(operatorToken);
  if (operatorKind === KindEqualsToken) {
    return undefined;
  }
  let leftCarrier = resolveExpressionCarrier(walk, left, sourceFile, undefined);
  let rightCarrier = resolveExpressionCarrier(walk, right, sourceFile, undefined);
  if (leftCarrier === undefined && rightCarrier !== undefined && ast.kindName(left) === KindNumericLiteral && isRustNumericCarrier(rightCarrier)) {
    leftCarrier = resolveExpressionCarrier(walk, left, sourceFile, rightCarrier);
  }
  if (rightCarrier === undefined && leftCarrier !== undefined && ast.kindName(right) === KindNumericLiteral && isRustNumericCarrier(leftCarrier)) {
    rightCarrier = resolveExpressionCarrier(walk, right, sourceFile, leftCarrier);
  }
  if (leftCarrier === undefined && rightCarrier === undefined && expected !== undefined && isRustNumericCarrier(expected)) {
    leftCarrier = resolveExpressionCarrier(walk, left, sourceFile, expected);
    rightCarrier = resolveExpressionCarrier(walk, right, sourceFile, expected);
  }
  const selection = selectRustBinaryOperator(operatorKind, leftCarrier, rightCarrier);
  if (selection === undefined || leftCarrier === undefined) {
    return undefined;
  }
  if (selection.kind === "string-concat") {
    const operationId = "tsonic.rust.operator.concat.string";
    recordTargetOperation(walk, expression, operationId, "operator", "concat");
    setRustOperationFact(walk, expression, {
      kind: "string-concat",
      operationId,
      resultCarrier: selection.resultCarrier,
    });
  } else {
    recordOperatorFacts(walk, expression, selection.rustOperator, selection.resultCarrier, rustOperatorCarrierKey(leftCarrier));
  }
  return setCarrierFact(walk, expression, selection.resultCarrier);
}

function resolveCallLikeCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expressionKind: string,
): TargetTypeRef | undefined {
  const { ast, checker } = walk.lifecycle.compiler;
  const callee = Node_Expression(expression);
  if (callee === undefined) {
    return undefined;
  }
  const providerIdentity = providerDeclarationIdentityFor(walk, callee);
  const callArguments = ast.arguments(expression);
  if (providerIdentity !== undefined) {
    const operationKind = expressionKind === KindNewExpression ? "constructor" : "method";
    const row = matchProviderRow(walk.providerRows, providerIdentity, operationKind);
    if (row === undefined) {
      appendProviderOperationDiagnostic(walk, providerIdentity, operationKind);
      return undefined;
    }
    for (const [index, argument] of callArguments.entries()) {
      if (argument !== undefined) {
        resolveExpressionCarrier(walk, argument, sourceFile, row.parameterCarriers?.[index]);
      }
    }
    recordProviderOperationFacts(walk, expression, row, providerIdentity);
    return setCarrierFact(walk, expression, row.resultCarrier);
  }
  if (expressionKind === KindNewExpression) {
    return undefined;
  }
  const symbol = checker.getResolvedSymbolOrNil(callee) ?? checker.getSymbolAtLocation(callee);
  if (symbol === undefined) {
    return undefined;
  }
  const aliased = safeAliasedSymbol(checker, symbol) ?? symbol;
  const declaration = checker.getSymbolValueDeclaration(aliased) ?? checker.getSymbolValueDeclaration(symbol);
  if (declaration === undefined || ast.kindName(declaration) !== KindFunctionDeclaration) {
    return undefined;
  }
  const declarationFile = ast.getFileName(ast.getSourceFile(declaration));
  if (declarationFile.endsWith(".d.ts")) {
    return undefined;
  }
  const parameters = ast.parameters(declaration);
  for (const [index, argument] of callArguments.entries()) {
    if (argument === undefined) {
      continue;
    }
    const parameter = parameters[index];
    const parameterCarrier = parameter === undefined
      ? undefined
      : resolveTypeNodeCarrier(walk, Node_Type(parameter));
    resolveExpressionCarrier(walk, argument, sourceFile, parameterCarrier);
  }
  const returnCarrier = resolveTypeNodeCarrier(walk, Node_Type(declaration));
  return returnCarrier === undefined ? undefined : setCarrierFact(walk, expression, returnCarrier);
}

function resolveProviderMemberCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  operationKind: "property",
): TargetTypeRef | undefined {
  const receiver = Node_Expression(expression);
  if (receiver !== undefined) {
    resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
  }
  const providerIdentity = providerDeclarationIdentityFor(walk, expression);
  if (providerIdentity === undefined) {
    return undefined;
  }
  const row = matchProviderRow(walk.providerRows, providerIdentity, operationKind);
  if (row === undefined) {
    appendProviderOperationDiagnostic(walk, providerIdentity, operationKind);
    return undefined;
  }
  recordProviderOperationFacts(walk, expression, row, providerIdentity);
  return setCarrierFact(walk, expression, row.resultCarrier);
}

function resolveProviderIndexerCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
): TargetTypeRef | undefined {
  const { ast } = walk.lifecycle.compiler;
  const receiver = Node_Expression(expression);
  if (receiver === undefined) {
    return undefined;
  }
  const receiverCarrier = resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
  if (receiverCarrier?.kind !== "target-named") {
    return undefined;
  }
  const row = walk.providerRows.find((candidate) =>
    candidate.operationKind === "indexer" &&
    candidate.receiverTypeId === receiverCarrier.id);
  if (row === undefined) {
    return undefined;
  }
  const argument = (expression as { readonly ArgumentExpression?: Node }).ArgumentExpression;
  if (argument !== undefined) {
    resolveExpressionCarrier(walk, argument, sourceFile, row.parameterCarriers?.[0]);
  }
  void ast;
  recordProviderOperationFacts(walk, expression, row, undefined);
  return setCarrierFact(walk, expression, row.resultCarrier);
}

function safeAliasedSymbol(
  checker: RustFactWalk["lifecycle"]["compiler"]["checker"],
  symbol: NonNullable<ReturnType<RustFactWalk["lifecycle"]["compiler"]["checker"]["getSymbolAtLocation"]>>,
) {
  try {
    return checker.getAliasedSymbol(symbol);
  } catch {
    return undefined;
  }
}

function providerDeclarationIdentityFor(walk: RustFactWalk, reference: Node): ProviderDeclarationIdentity | undefined {
  const { checker } = walk.lifecycle.compiler;
  const facts = walk.lifecycle.host.facts;
  const symbol = checker.getResolvedSymbolOrNil(reference) ?? checker.getSymbolAtLocation(reference);
  if (symbol === undefined) {
    return undefined;
  }
  for (const candidate of [symbol, safeAliasedSymbol(checker, symbol)]) {
    if (candidate === undefined) {
      continue;
    }
    for (const declaration of checker.getSymbolDeclarations(candidate)) {
      if (declaration === undefined) {
        continue;
      }
      const fact = facts.get(declaration, providerVirtualDeclarationFactKey);
      if (fact !== undefined) {
        return fact as ProviderDeclarationIdentity;
      }
    }
  }
  return undefined;
}

function matchProviderRow(
  rows: readonly RustProviderOperationRow[],
  identity: ProviderDeclarationIdentity,
  operationKind: RustProviderOperationRow["operationKind"],
): RustProviderOperationRow | undefined {
  return rows.find((row) => {
    if (row.operationKind !== operationKind) {
      return false;
    }
    if (row.memberId !== undefined) {
      return row.memberId === identity.memberId;
    }
    if (row.exportId !== identity.exportId) {
      return false;
    }
    return row.signatureId === undefined || row.signatureId === identity.signatureId;
  });
}

function recordProviderOperationFacts(
  walk: RustFactWalk,
  expression: Node,
  row: RustProviderOperationRow,
  identity: ProviderDeclarationIdentity | undefined,
): void {
  const operationId = row.memberId ?? row.signatureId ?? row.exportId;
  const targetOperationText = row.target.form === "call" || row.target.form === "path"
    ? row.target.path
    : row.target.form === "index"
      ? "[]"
      : row.target.name;
  recordTargetOperation(walk, expression, operationId, row.operationKind, targetOperationText);
  setRustOperationFact(walk, expression, {
    kind: "provider-operation",
    operationId,
    operationKind: row.operationKind,
    target: row.target,
    resultCarrier: row.resultCarrier,
  });
  if (row.operationKind === "method" || row.operationKind === "constructor") {
    const member: TargetMember = {
      id: operationId,
      sourceName: identity?.exportName ?? identity?.memberName ?? operationId,
      targetName: targetOperationText,
      kind: row.operationKind === "constructor" ? "constructor" : "method",
      parameters: (row.parameterCarriers ?? []).map((carrier, index) => ({
        name: `arg${index}`,
        type: carrier,
        passingMode: "by-value",
      })),
      returnType: row.resultCarrier,
    };
    walk.lifecycle.host.facts.set(
      expression,
      selectedTargetSignatureFactKey,
      { member, ...(identity === undefined ? {} : { providerDeclaration: identity }) },
      [{ message: `rust provider operation ${operationId}` }],
    );
  }
}

function recordOperatorFacts(
  walk: RustFactWalk,
  expression: Node,
  rustOperator: string,
  resultCarrier: TargetTypeRef,
  carrierKey: string,
): void {
  const operationId = `tsonic.rust.operator.${rustOperator}.${carrierKey}`;
  recordTargetOperation(walk, expression, operationId, "operator", rustOperator);
  setRustOperationFact(walk, expression, {
    kind: "operator-token",
    operationId,
    operator: rustOperator,
    resultCarrier,
  });
}

function recordTargetOperation(
  walk: RustFactWalk,
  expression: Node,
  operationId: string,
  operationKind: "property" | "method" | "indexer" | "operator" | "constructor",
  targetOperation: string,
): void {
  walk.lifecycle.host.facts.set(
    expression,
    targetOperationFactKey,
    { operationId, operationKind, targetOperation },
    [{ message: `rust target operation ${operationId}` }],
  );
}

function setRustOperationFact(walk: RustFactWalk, expression: Node, fact: RustTargetOperationFact): void {
  walk.lifecycle.host.facts.set(expression, rustTargetOperationFactKey, fact, [
    { message: `rust operation ${fact.operationId}` },
  ]);
}

function setCarrierFact(walk: RustFactWalk, subject: Node, carrier: TargetTypeRef): TargetTypeRef {
  const facts = walk.lifecycle.host.facts;
  const existing = facts.get(subject, runtimeCarrierFactKey);
  if (existing === undefined) {
    facts.set(subject, runtimeCarrierFactKey, { carrier }, [{ message: "rust carrier" }]);
  }
  return carrier;
}

function appendProviderOperationDiagnostic(
  walk: RustFactWalk,
  identity: ProviderDeclarationIdentity,
  operationKind: string,
): void {
  walk.lifecycle.host.diagnostics.append({
    extensionId: rustTargetSemanticsExtensionId,
    extensionCode: "RUST_PROVIDER_OPERATION_NOT_MAPPED",
    numericCode: 0,
    category: "error",
    message: `No Rust target operation is mapped for provider declaration '${identity.memberId ?? identity.exportId ?? identity.moduleSpecifier}' (${operationKind}).`,
    evidence: [
      { message: `target.capability=rust.provider.${operationKind}` },
      { message: `provider.module=${identity.moduleSpecifier}` },
    ],
  });
}

function collectDescendantsOfKind(walk: RustFactWalk, root: Node, kindName: string): readonly Node[] {
  const { ast } = walk.lifecycle.compiler;
  const results: Node[] = [];
  const visit = (node: Node): void => {
    if (ast.kindName(node) === kindName) {
      results.push(node);
    }
    ast.forEachChild(node, (child) => {
      if (child !== undefined) {
        visit(child);
      }
    });
  };
  visit(root);
  return results;
}
