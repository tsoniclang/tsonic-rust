import {
  ExtensionLifecycleEvent,
  argumentPassingFactKey,
  flowStateFactKey,
  functionPointerFactKey,
  pointerFactKey,
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
  ArrayTypeNode_ElementType,
  BinaryExpression_Left,
  BinaryExpression_OperatorToken,
  BinaryExpression_Right,
  ForInOrOfStatement_Initializer,
  ForInOrOfStatement_Statement,
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
  KindForOfStatement,
  KindForStatement,
  KindFunctionDeclaration,
  KindIdentifier,
  KindIfStatement,
  KindArrayLiteralExpression,
  KindArrayType,
  KindInterfaceDeclaration,
  KindNewExpression,
  KindNumericLiteral,
  KindOmittedExpression,
  KindParameter,
  KindParenthesizedExpression,
  KindPostfixUnaryExpression,
  KindPrefixUnaryExpression,
  KindPropertyAccessExpression,
  KindReturnStatement,
  KindStringKeyword,
  KindStringLiteral,
  KindTypeReference,
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
  isRustJsArrayCarrier,
  rustSliceElementCarrier,
  rustSliceRefTargetType,
  isRustNumericCarrier,
  isRustOptionCarrier,
  isRustSignedNumericCarrier,
  isRustVecCarrier,
  rustJsArrayTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
  rustUnitTargetType,
  rustVecTargetType,
} from "../rust-target-types.js";
import { rustExtensionId, rustSourceTypeCarrier, rustTargetOperationFactKey } from "../rust-facts/keys.js";
import type { RustTargetOperationFact } from "../rust-facts/keys.js";
import { collectRustProviderOperationRows } from "../provider-packages/index.js";
import type { RustProviderOperationRow } from "../provider-packages/index.js";
import { rustOperatorCarrierKey, selectRustBinaryOperator, selectRustCompoundAssignment } from "./operator-rules.js";
import { selectJsSurfaceConstructor, selectJsSurfaceOperation } from "./js-surface-operations.js";
import type { JsOperationSelection } from "./js-surface-operations.js";
import { readRustTypescriptCompatibilityMode } from "../../options/rust-target-options.js";

export const rustTargetSemanticsExtensionId = "tsonic.rust.target-semantics";

export function createRustTargetSemanticsExtension(context: TargetProviderContext): CompilerExtension {
  const providerRows = collectRustProviderOperationRows(context.selectedPackages);
  const jsEnabled = context.selectedSurfaces.some((surface) => surface.id === "js") ||
    readRustTypescriptCompatibilityMode(context.target) === "compat";
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
          recordRustFactsBeforeFinalization(lifecycleContext, providerRows, jsEnabled);
        },
      );
    },
  };
}

interface RustFactWalk {
  readonly lifecycle: ExtensionLifecycleContext;
  readonly providerRows: readonly RustProviderOperationRow[];
  readonly resolving: Set<object>;
  readonly jsEnabled: boolean;
  currentThisCarrier?: TargetTypeRef;
}

const boolCarrier = rustSourcePrimitiveTargetType("bool");

export function recordRustFactsBeforeFinalization(
  lifecycle: ExtensionLifecycleContext,
  providerRows: readonly RustProviderOperationRow[],
  jsEnabled = false,
): void {
  const walk: RustFactWalk = { lifecycle, providerRows, resolving: new Set(), jsEnabled };
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
      } else if (kind === "KindClassDeclaration") {
        recordClassFacts(walk, statement, sourceFile);
      } else if (kind === "KindEnumDeclaration") {
        recordEnumFacts(walk, statement, sourceFile);
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
      const operatorKind = operatorToken === undefined ? "" : ast.kindName(operatorToken);
      if (operatorKind === KindEqualsToken) {
        const left = BinaryExpression_Left(expression);
        const right = BinaryExpression_Right(expression);
        if (left !== undefined && right !== undefined && recordJsAssignmentFacts(walk, expression, left, right, sourceFile)) {
          return;
        }
        const leftCarrier = left === undefined
          ? undefined
          : resolveExpressionCarrier(walk, left, sourceFile, undefined);
        if (right !== undefined) {
          resolveExpressionCarrier(walk, right, sourceFile, leftCarrier);
        }
        return;
      }
      const left = BinaryExpression_Left(expression);
      const right = BinaryExpression_Right(expression);
      if (left !== undefined && right !== undefined) {
        const leftCarrier = resolveExpressionCarrier(walk, left, sourceFile, undefined);
        const rightCarrier = resolveExpressionCarrier(walk, right, sourceFile, leftCarrier);
        const compound = selectRustCompoundAssignment(operatorKind, leftCarrier, rightCarrier);
        if (compound !== undefined && leftCarrier !== undefined) {
          recordOperatorFacts(walk, expression, compound, leftCarrier, rustOperatorCarrierKey(leftCarrier));
          return;
        }
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
  if (kind === KindForOfStatement) {
    recordForOfFacts(walk, statement, sourceFile, returnCarrier);
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
  if (facts.get(typeNode, pointerFactKey) !== undefined || facts.get(typeNode, functionPointerFactKey) !== undefined) {
    walk.lifecycle.host.diagnostics.append({
      extensionId: rustTargetSemanticsExtensionId,
      extensionCode: "RUST_SOURCE_MARKER_UNSUPPORTED",
      numericCode: 0,
      category: "error",
      message: "ptr/fnptr type markers have no Rust target lane yet; they require the unsafe boundary contract.",
      evidence: [{ message: "target.capability=rust.source.type-marker" }],
    });
    return undefined;
  }
  const primitive = facts.get(typeNode, sourcePrimitiveFactKey);
  if (primitive !== undefined) {
    return setCarrierFact(walk, typeNode, rustSourcePrimitiveTargetType(primitive.kind));
  }
  const kind = walk.lifecycle.compiler.ast.kindName(typeNode);
  if (kind === KindTypeReference) {
    const sourceType = sourceTypeCarrierForReference(walk, typeNode);
    if (sourceType !== undefined) {
      return setCarrierFact(walk, typeNode, sourceType);
    }
  }
  if (kind === KindArrayType) {
    const element = resolveTypeNodeCarrier(walk, ArrayTypeNode_ElementType(typeNode));
    return element === undefined ? undefined : setCarrierFact(walk, typeNode, rustVecTargetType(element));
  }
  if (kind === "KindTypeOperator") {
    // `readonly T[]` lowers to a borrowed slice lane.
    const inner = (typeNode as unknown as { readonly Type?: Node }).Type;
    if (inner !== undefined && walk.lifecycle.compiler.ast.kindName(inner) === KindArrayType) {
      const element = resolveTypeNodeCarrier(walk, ArrayTypeNode_ElementType(inner));
      return element === undefined ? undefined : setCarrierFact(walk, typeNode, rustSliceRefTargetType(element));
    }
    return undefined;
  }
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
    case "KindThisExpression":
    case "KindThisKeyword": {
      const thisCarrier = walk.currentThisCarrier;
      return thisCarrier === undefined ? undefined : setCarrierFact(walk, expression, thisCarrier);
    }
    case KindIdentifier: {
      return resolveIdentifierCarrier(walk, expression, sourceFile);
    }
    case KindArrayLiteralExpression: {
      return resolveArrayLiteralCarrier(walk, expression, sourceFile, expected);
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
      return resolveCallLikeCarrier(walk, expression, sourceFile, kind, expected);
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
  const equalityOperator = operatorKind === "KindEqualsEqualsEqualsToken" || operatorKind === "KindExclamationEqualsEqualsToken";
  if (equalityOperator) {
    const optionCheck = tryRecordOptionUndefinedCheck(walk, expression, left, right, sourceFile, operatorKind === "KindExclamationEqualsEqualsToken");
    if (optionCheck !== undefined) {
      return optionCheck;
    }
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
  expected?: TargetTypeRef,
): TargetTypeRef | undefined {
  const { ast, checker } = walk.lifecycle.compiler;
  const callee = Node_Expression(expression);
  if (callee === undefined) {
    return undefined;
  }
  const callArguments = ast.arguments(expression);
  const flowHandled = tryFlowMarkerCall(walk, expression, callArguments, sourceFile, expected);
  if (flowHandled !== undefined) {
    return flowHandled.carrier;
  }
  const providerIdentity = providerDeclarationIdentityFor(walk, callee);
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
        validateFlowMarkerAgainstMode(walk, argument, rowArgumentMode(row, index));
      }
    }
    recordProviderOperationFacts(walk, expression, row, providerIdentity);
    return setCarrierFact(walk, expression, row.resultCarrier);
  }
  const sourceCallLike = trySourceCallLike(walk, expression, callee, callArguments, sourceFile, expressionKind);
  if (sourceCallLike !== undefined) {
    return sourceCallLike;
  }
  if (walk.jsEnabled) {
    const jsSelection = expressionKind === KindNewExpression
      ? selectJsConstructorForNode(walk, expression, callee, callArguments, sourceFile)
      : selectJsCallForNode(walk, expression, callee, callArguments, sourceFile);
    if (jsSelection !== undefined) {
      applyJsSelection(walk, expression, jsSelection, sourceFile, callArguments);
      return jsSelection.resultCarrier;
    }
  }
  if (expressionKind === KindNewExpression) {
    return undefined;
  }
  const symbol = checker.getResolvedSymbolOrNil(callee) ?? checker.getSymbolAtLocation(callee);
  if (symbol === undefined) {
    return undefined;
  }
  const aliased = safeAliasedSymbol(checker, symbol) ?? symbol;
  const declaration = checker.getSymbolValueDeclaration(aliased) ??
    checker.getSymbolValueDeclaration(symbol) ??
    checker.getPrimarySymbolDeclaration(aliased) ??
    checker.getPrimarySymbolDeclaration(symbol) ??
    checker.getSymbolDeclarations(symbol)[0];
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
    const sourceMember = trySourceMemberAccess(walk, expression, receiver, sourceFile);
    if (sourceMember !== undefined) {
      return sourceMember;
    }
    if (walk.jsEnabled && receiver !== undefined) {
      const identity = libMemberIdentityFor(walk, expression);
      if (identity !== undefined) {
        const receiverCarrier = resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
        const selection = selectJsSurfaceOperation({
          ownerName: identity.ownerName,
          memberName: identity.memberName,
          operationKind: "property",
          ...(receiverCarrier === undefined ? {} : { receiverCarrier }),
        });
        if (selection !== undefined) {
          applyJsSelection(walk, expression, selection, sourceFile, []);
          return selection.resultCarrier;
        }
      }
    }
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
  if (receiverCarrier !== undefined && receiverCarrier.kind !== "target-named" && walk.jsEnabled) {
    const selection = selectJsSurfaceOperation({
      ownerName: "Array",
      memberName: "index",
      operationKind: "indexer",
      receiverCarrier,
    });
    if (selection !== undefined) {
      const argument = (expression as { readonly ArgumentExpression?: Node }).ArgumentExpression;
      applyJsSelection(walk, expression, selection, sourceFile, argument === undefined ? [] : [argument]);
      return selection.resultCarrier;
    }
  }
  if (receiverCarrier?.kind !== "target-named") {
    return undefined;
  }
  const row = walk.providerRows.find((candidate) =>
    candidate.operationKind === "indexer" &&
    candidate.receiverTypeId === receiverCarrier.id);
  if (row === undefined) {
    if (walk.jsEnabled) {
      const selection = selectJsSurfaceOperation({
        ownerName: "Array",
        memberName: "index",
        operationKind: "indexer",
        receiverCarrier,
      });
      if (selection !== undefined) {
        const argument = (expression as { readonly ArgumentExpression?: Node }).ArgumentExpression;
        applyJsSelection(walk, expression, selection, sourceFile, argument === undefined ? [] : [argument]);
        return selection.resultCarrier;
      }
    }
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
  const targetOperationText = row.target.form === "call" || row.target.form === "path" || row.target.form === "free-call"
    ? row.target.path
    : row.target.form === "index"
      ? "[]"
      : row.target.form === "binary-operator"
        ? row.target.operator
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

// --- JS surface lanes -------------------------------------------------------

interface RustLibMemberIdentity {
  readonly ownerName: string;
  readonly memberName: string;
}

// Identity of a selected lib declaration member: the resolved symbol's
// declaration must live in a non-provider .d.ts file; the owner is the
// enclosing interface declaration. Names are read from the declaration model,
// never from the user expression.
function libMemberIdentityFor(walk: RustFactWalk, reference: Node): RustLibMemberIdentity | undefined {
  const { ast, checker } = walk.lifecycle.compiler;
  const facts = walk.lifecycle.host.facts;
  const symbol = checker.getResolvedSymbolOrNil(reference) ?? checker.getSymbolAtLocation(reference);
  if (symbol === undefined) {
    return undefined;
  }
  for (const declaration of checker.getSymbolDeclarations(symbol)) {
    if (declaration === undefined) {
      continue;
    }
    const declarationFile = ast.getFileName(ast.getSourceFile(declaration));
    if (!declarationFile.endsWith(".d.ts") || facts.get(declaration, providerVirtualDeclarationFactKey) !== undefined) {
      continue;
    }
    let owner: Node | undefined = ast.parent(declaration);
    while (owner !== undefined && ast.kindName(owner) !== KindInterfaceDeclaration) {
      owner = ast.parent(owner);
    }
    if (owner === undefined) {
      continue;
    }
    const ownerName = ast.text(ast.name(owner) ?? owner);
    const memberName = checker.getSymbolName(symbol);
    if (ownerName.length > 0 && memberName.length > 0) {
      return { ownerName, memberName };
    }
  }
  return undefined;
}

function applyJsSelection(
  walk: RustFactWalk,
  expression: Node,
  selection: JsOperationSelection,
  sourceFile: SourceFile,
  argumentNodes: readonly (Node | undefined)[],
): void {
  for (const [index, argument] of argumentNodes.entries()) {
    if (argument !== undefined) {
      resolveExpressionCarrier(walk, argument, sourceFile, selection.parameterCarriers?.[index]);
    }
  }
  const fact = selection.fact;
  recordTargetOperation(
    walk,
    expression,
    fact.operationId,
    fact.kind === "provider-operation" ? fact.operationKind : "method",
    fact.operationId,
  );
  setRustOperationFact(walk, expression, fact);
  if (selection.resultCarrier !== undefined) {
    setCarrierFact(walk, expression, selection.resultCarrier);
  }
}

function selectJsCallForNode(
  walk: RustFactWalk,
  _expression: Node,
  callee: Node,
  _callArguments: readonly (Node | undefined)[],
  sourceFile: SourceFile,
): JsOperationSelection | undefined {
  const { ast } = walk.lifecycle.compiler;
  if (ast.kindName(callee) !== KindPropertyAccessExpression) {
    return undefined;
  }
  const identity = libMemberIdentityFor(walk, callee);
  if (identity === undefined) {
    return undefined;
  }
  const receiver = Node_Expression(callee);
  const receiverCarrier = receiver === undefined
    ? undefined
    : resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
  return selectJsSurfaceOperation({
    ownerName: identity.ownerName,
    memberName: identity.memberName,
    operationKind: "call",
    ...(receiverCarrier === undefined ? {} : { receiverCarrier }),
  });
}

function selectJsConstructorForNode(
  walk: RustFactWalk,
  expression: Node,
  callee: Node,
  callArguments: readonly (Node | undefined)[],
  sourceFile: SourceFile,
): JsOperationSelection | undefined {
  const { ast, checker } = walk.lifecycle.compiler;
  const facts = walk.lifecycle.host.facts;
  const symbol = checker.getResolvedSymbolOrNil(callee) ?? checker.getSymbolAtLocation(callee);
  if (symbol === undefined) {
    return undefined;
  }
  const declarations = checker.getSymbolDeclarations(symbol);
  const isLibDeclaration = declarations.some((declaration) =>
    declaration !== undefined &&
    ast.getFileName(ast.getSourceFile(declaration)).endsWith(".d.ts") &&
    facts.get(declaration, providerVirtualDeclarationFactKey) === undefined);
  if (!isLibDeclaration) {
    return undefined;
  }
  const typeArgumentCarriers = ast.typeArguments(expression).map((typeNode) =>
    typeNode === undefined ? undefined : resolveTypeNodeCarrier(walk, typeNode));
  const argumentCarriers = callArguments.map((argument) =>
    argument === undefined ? undefined : resolveExpressionCarrier(walk, argument, sourceFile, undefined));
  return selectJsSurfaceConstructor({
    className: checker.getSymbolName(symbol),
    typeArgumentCarriers,
    argumentCarriers,
  });
}

function resolveArrayLiteralCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const { ast } = walk.lifecycle.compiler;
  const elements = ast.elements(expression).filter((element): element is Node => element !== undefined);
  const hasHoles = elements.some((element) => ast.kindName(element) === KindOmittedExpression);
  const presentElements = elements.filter((element) => ast.kindName(element) !== KindOmittedExpression);

  let expectedElement: TargetTypeRef | undefined;
  let lane: "dense" | "sparse" = hasHoles ? "sparse" : "dense";
  if (expected !== undefined && isRustVecCarrier(expected)) {
    expectedElement = expected.element;
  } else if (expected?.kind === "target-named" && isRustJsArrayCarrier(expected)) {
    expectedElement = expected.typeArguments?.[0];
    lane = "sparse";
  }
  if (expectedElement === undefined) {
    for (const element of presentElements) {
      const carrier = resolveExpressionCarrier(walk, element, sourceFile, undefined);
      if (carrier !== undefined) {
        expectedElement = carrier;
        break;
      }
    }
  }
  if (expectedElement === undefined && presentElements.every((element) => ast.kindName(element) === KindNumericLiteral)) {
    expectedElement = rustSourcePrimitiveTargetType("float64");
  }
  if (expectedElement === undefined) {
    return undefined;
  }
  if (lane === "sparse" && !walk.jsEnabled) {
    walk.lifecycle.host.diagnostics.append({
      extensionId: rustTargetSemanticsExtensionId,
      extensionCode: "RUST_JS_SURFACE_REQUIRED",
      numericCode: 0,
      category: "error",
      message: "Sparse array literals require the js surface or compat mode for the Rust target.",
      evidence: [{ message: "target.capability=rust.js.sparse-array" }],
    });
    return undefined;
  }
  for (const element of presentElements) {
    resolveExpressionCarrier(walk, element, sourceFile, expectedElement);
  }
  const resultCarrier = lane === "sparse"
    ? rustJsArrayTargetType(expectedElement)
    : rustVecTargetType(expectedElement);
  setRustOperationFact(walk, expression, {
    kind: "array-literal",
    operationId: `tsonic.rust.js.array-literal.${lane}`,
    lane,
    elementCarrier: expectedElement,
    resultCarrier,
    length: elements.length,
  });
  return setCarrierFact(walk, expression, resultCarrier);
}

function recordForOfFacts(
  walk: RustFactWalk,
  statement: Node,
  sourceFile: SourceFile,
  returnCarrier: TargetTypeRef | undefined,
): void {
  const iterable = Node_Expression(statement);
  const iterableCarrier = iterable === undefined
    ? undefined
    : resolveExpressionCarrier(walk, iterable, sourceFile, undefined);
  const sliceElement = rustSliceElementCarrier(iterableCarrier);
  const denseElementForOf = iterableCarrier !== undefined && isRustVecCarrier(iterableCarrier)
    ? iterableCarrier.element
    : sliceElement;
  if (iterable !== undefined && denseElementForOf !== undefined && isRustNumericCarrier(denseElementForOf)) {
    const element = denseElementForOf;
    setRustOperationFact(walk, statement, {
      kind: "for-of",
      operationId: "tsonic.rust.js.for-of.dense",
      elementCarrier: element,
      style: "copied",
    });
    const initializer = ForInOrOfStatement_Initializer(statement);
    if (initializer !== undefined) {
      for (const declaration of collectDescendantsOfKind(walk, initializer, KindVariableDeclaration)) {
        setCarrierFact(walk, declaration, element);
      }
    }
  }
  const body = ForInOrOfStatement_Statement(statement);
  if (body !== undefined) {
    recordStatementFacts(walk, body, sourceFile, returnCarrier);
  }
}

function recordJsAssignmentFacts(
  walk: RustFactWalk,
  assignment: Node,
  left: Node,
  right: Node,
  sourceFile: SourceFile,
): boolean {
  const { ast } = walk.lifecycle.compiler;
  const leftKind = ast.kindName(left);
  if (leftKind === KindPropertyAccessExpression) {
    const identity = libMemberIdentityFor(walk, left);
    const receiver = Node_Expression(left);
    if (identity === undefined || receiver === undefined || !walk.jsEnabled) {
      return false;
    }
    const receiverCarrier = resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
    const selection = selectJsSurfaceOperation({
      ownerName: identity.ownerName,
      memberName: identity.memberName,
      operationKind: "property-set",
      ...(receiverCarrier === undefined ? {} : { receiverCarrier }),
    });
    if (selection === undefined) {
      return false;
    }
    resolveExpressionCarrier(walk, right, sourceFile, selection.parameterCarriers?.[0]);
    setRustOperationFact(walk, assignment, selection.fact);
    return true;
  }
  if (leftKind === KindElementAccessExpression && walk.jsEnabled) {
    const receiver = Node_Expression(left);
    const receiverCarrier = receiver === undefined
      ? undefined
      : resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
    if (receiverCarrier === undefined) {
      return false;
    }
    const selection = selectJsSurfaceOperation({
      ownerName: "Array",
      memberName: "index",
      operationKind: "index-set",
      receiverCarrier,
    });
    if (selection === undefined) {
      return false;
    }
    const index = (left as { readonly ArgumentExpression?: Node }).ArgumentExpression;
    if (index !== undefined) {
      resolveExpressionCarrier(walk, index, sourceFile, selection.parameterCarriers?.[0]);
    }
    resolveExpressionCarrier(walk, right, sourceFile, selection.parameterCarriers?.[1]);
    setRustOperationFact(walk, assignment, selection.fact);
    return true;
  }
  return false;
}

function tryRecordOptionUndefinedCheck(
  walk: RustFactWalk,
  expression: Node,
  left: Node,
  right: Node,
  sourceFile: SourceFile,
  negated: boolean,
): TargetTypeRef | undefined {
  const { ast, checker, typeShape } = walk.lifecycle.compiler;
  const isUndefinedLiteral = (node: Node): boolean => {
    if (ast.kindName(node) !== KindIdentifier) {
      return false;
    }
    const type = checker.getTypeAtLocation(node);
    return type !== undefined && typeShape.isVoidLike(type);
  };
  const undefinedSide = isUndefinedLiteral(left) ? left : isUndefinedLiteral(right) ? right : undefined;
  const valueSide = undefinedSide === left ? right : left;
  if (undefinedSide === undefined) {
    return undefined;
  }
  const valueCarrier = resolveExpressionCarrier(walk, valueSide, sourceFile, undefined);
  if (!isRustOptionCarrier(valueCarrier)) {
    return undefined;
  }
  setRustOperationFact(walk, expression, {
    kind: "option-check",
    operationId: negated ? "tsonic.rust.js.option.is-some" : "tsonic.rust.js.option.is-none",
    negated,
  });
  recordTargetOperation(walk, expression, "tsonic.rust.js.option-check", "operator", negated ? "is_some" : "is_none");
  return setCarrierFact(walk, expression, boolCarrier);
}

// --- Project-source classes and enums --------------------------------------

function projectDeclarationFor(walk: RustFactWalk, reference: Node): Node | undefined {
  const { ast, checker } = walk.lifecycle.compiler;
  const symbol = checker.getResolvedSymbolOrNil(reference) ?? checker.getSymbolAtLocation(reference);
  if (symbol === undefined) {
    return undefined;
  }
  const aliased = safeAliasedSymbol(checker, symbol) ?? symbol;
  const declaration = checker.getSymbolValueDeclaration(aliased) ??
    checker.getSymbolValueDeclaration(symbol) ??
    checker.getPrimarySymbolDeclaration(aliased) ??
    checker.getPrimarySymbolDeclaration(symbol) ??
    checker.getSymbolDeclarations(symbol)[0];
  if (declaration === undefined) {
    return undefined;
  }
  const fileName = ast.getFileName(ast.getSourceFile(declaration));
  return fileName.endsWith(".d.ts") ? undefined : declaration;
}

function sourceTypeCarrierForDeclaration(walk: RustFactWalk, declaration: Node): TargetTypeRef | undefined {
  const { ast } = walk.lifecycle.compiler;
  const kind = ast.kindName(declaration);
  const shape = kind === "KindClassDeclaration" ? "struct" : kind === "KindEnumDeclaration" ? "enum" : undefined;
  if (shape === undefined) {
    return undefined;
  }
  const nameNode = ast.name(declaration);
  const typeName = nameNode === undefined ? "" : ast.text(nameNode);
  if (typeName.length === 0) {
    return undefined;
  }
  const fileName = ast.getFileName(ast.getSourceFile(declaration));
  return rustSourceTypeCarrier(fileName, typeName, shape);
}

function sourceTypeCarrierForReference(walk: RustFactWalk, typeNode: Node): TargetTypeRef | undefined {
  const { ast } = walk.lifecycle.compiler;
  const typeName = (typeNode as unknown as { readonly TypeName?: Node }).TypeName;
  const nameNode = typeName ?? ast.name(typeNode) ?? typeNode;
  const declaration = projectDeclarationFor(walk, nameNode);
  return declaration === undefined ? undefined : sourceTypeCarrierForDeclaration(walk, declaration);
}

function methodMutatesSelf(walk: RustFactWalk, method: Node): boolean {
  const { ast } = walk.lifecycle.compiler;
  let mutates = false;
  const visit = (node: Node): void => {
    if (mutates) {
      return;
    }
    if (ast.kindName(node) === KindBinaryExpression) {
      const operatorToken = BinaryExpression_OperatorToken(node);
      const operatorKind = operatorToken === undefined ? "" : ast.kindName(operatorToken);
      if (operatorKind.endsWith("EqualsToken") && operatorKind !== KindEqualsEqualsEqualsTokenName && operatorKind !== KindExclamationEqualsEqualsTokenName) {
        const left = BinaryExpression_Left(node);
        if (left !== undefined && ast.kindName(left) === KindPropertyAccessExpression) {
          const receiver = Node_Expression(left);
          const receiverKind = receiver === undefined ? "" : ast.kindName(receiver);
          if (receiverKind === "KindThisExpression" || receiverKind === "KindThisKeyword") {
            mutates = true;
            return;
          }
        }
      }
    }
    ast.forEachChild(node, (child) => {
      if (child !== undefined) {
        visit(child);
      }
    });
  };
  visit(method);
  return mutates;
}

const KindEqualsEqualsEqualsTokenName = "KindEqualsEqualsEqualsToken";
const KindExclamationEqualsEqualsTokenName = "KindExclamationEqualsEqualsToken";

function recordClassFacts(walk: RustFactWalk, declaration: Node, sourceFile: SourceFile): void {
  const { ast } = walk.lifecycle.compiler;
  const classCarrier = sourceTypeCarrierForDeclaration(walk, declaration);
  if (classCarrier === undefined) {
    return;
  }
  setCarrierFact(walk, declaration, classCarrier);
  const previousThis = walk.currentThisCarrier;
  walk.currentThisCarrier = classCarrier;
  for (const member of ast.members(declaration)) {
    if (member === undefined) {
      continue;
    }
    const memberKind = ast.kindName(member);
    if (memberKind === "KindPropertyDeclaration") {
      const fieldCarrier = resolveTypeNodeCarrier(walk, Node_Type(member));
      if (fieldCarrier !== undefined) {
        setCarrierFact(walk, member, fieldCarrier);
      }
      continue;
    }
    if (memberKind === "KindConstructor" || memberKind === "KindMethodDeclaration") {
      for (const parameter of ast.parameters(member)) {
        if (parameter === undefined) {
          continue;
        }
        const parameterCarrier = resolveTypeNodeCarrier(walk, Node_Type(parameter));
        if (parameterCarrier !== undefined) {
          setCarrierFact(walk, parameter, parameterCarrier);
        }
      }
      const returnCarrier = memberKind === "KindMethodDeclaration"
        ? resolveTypeNodeCarrier(walk, Node_Type(member))
        : undefined;
      const body = ast.body(member);
      if (body !== undefined) {
        for (const statement of ast.statements(body)) {
          if (statement !== undefined) {
            recordStatementFacts(walk, statement, sourceFile, returnCarrier);
          }
        }
      }
    }
  }
  walk.currentThisCarrier = previousThis;
}

function recordEnumFacts(walk: RustFactWalk, declaration: Node, _sourceFile: SourceFile): void {
  const carrier = sourceTypeCarrierForDeclaration(walk, declaration);
  if (carrier !== undefined) {
    setCarrierFact(walk, declaration, carrier);
  }
}

function trySourceMemberAccess(
  walk: RustFactWalk,
  expression: Node,
  receiver: Node | undefined,
  sourceFile: SourceFile,
): TargetTypeRef | undefined {
  const { ast } = walk.lifecycle.compiler;
  const memberDeclaration = projectDeclarationFor(walk, expression);
  if (memberDeclaration === undefined) {
    return undefined;
  }
  const memberKind = ast.kindName(memberDeclaration);
  if (memberKind === "KindPropertyDeclaration") {
    if (receiver !== undefined) {
      resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
    }
    const fieldCarrier = walk.lifecycle.host.facts.get(memberDeclaration, runtimeCarrierFactKey)?.carrier ??
      resolveTypeNodeCarrier(walk, Node_Type(memberDeclaration));
    const nameNode = ast.name(memberDeclaration);
    const fieldName = nameNode === undefined ? "" : ast.text(nameNode);
    if (fieldCarrier === undefined || fieldName.length === 0) {
      return undefined;
    }
    const operationId = `tsonic.rust.source.field:${fieldName}`;
    recordTargetOperation(walk, expression, operationId, "property", fieldName);
    setRustOperationFact(walk, expression, {
      kind: "source-field",
      operationId,
      name: fieldName,
      resultCarrier: fieldCarrier,
    });
    return setCarrierFact(walk, expression, fieldCarrier);
  }
  if (memberKind === "KindEnumMember") {
    const enumDeclaration = ast.parent(memberDeclaration);
    const enumCarrier = enumDeclaration === undefined
      ? undefined
      : sourceTypeCarrierForDeclaration(walk, enumDeclaration);
    const nameNode = ast.name(memberDeclaration);
    const memberName = nameNode === undefined ? "" : ast.text(nameNode);
    if (enumCarrier === undefined || memberName.length === 0) {
      return undefined;
    }
    const operationId = `tsonic.rust.source.enum-member:${memberName}`;
    recordTargetOperation(walk, expression, operationId, "property", memberName);
    setRustOperationFact(walk, expression, {
      kind: "source-enum-member",
      operationId,
      name: memberName,
      resultCarrier: enumCarrier,
    });
    return setCarrierFact(walk, expression, enumCarrier);
  }
  return undefined;
}

function trySourceCallLike(
  walk: RustFactWalk,
  expression: Node,
  callee: Node,
  callArguments: readonly (Node | undefined)[],
  sourceFile: SourceFile,
  expressionKind: string,
): TargetTypeRef | undefined {
  const { ast } = walk.lifecycle.compiler;
  if (expressionKind === KindNewExpression) {
    const classDeclaration = projectDeclarationFor(walk, callee);
    if (classDeclaration === undefined || ast.kindName(classDeclaration) !== "KindClassDeclaration") {
      return undefined;
    }
    const classCarrier = sourceTypeCarrierForDeclaration(walk, classDeclaration);
    if (classCarrier === undefined) {
      return undefined;
    }
    const constructorMember = ast.members(classDeclaration).find((member) =>
      member !== undefined && ast.kindName(member) === "KindConstructor");
    const parameters = constructorMember === undefined ? [] : ast.parameters(constructorMember);
    for (const [index, argument] of callArguments.entries()) {
      if (argument === undefined) {
        continue;
      }
      const parameter = parameters[index];
      const expected = parameter === undefined
        ? undefined
        : walk.lifecycle.host.facts.get(parameter, runtimeCarrierFactKey)?.carrier ??
          resolveTypeNodeCarrier(walk, Node_Type(parameter));
      resolveExpressionCarrier(walk, argument, sourceFile, expected);
    }
    const operationId = "tsonic.rust.source.constructor";
    recordTargetOperation(walk, expression, operationId, "constructor", "new");
    setRustOperationFact(walk, expression, {
      kind: "source-constructor",
      operationId,
      resultCarrier: classCarrier,
    });
    return setCarrierFact(walk, expression, classCarrier);
  }
  if (ast.kindName(callee) !== KindPropertyAccessExpression) {
    return undefined;
  }
  const methodDeclaration = projectDeclarationFor(walk, callee);
  if (methodDeclaration === undefined || ast.kindName(methodDeclaration) !== "KindMethodDeclaration") {
    return undefined;
  }
  const receiver = Node_Expression(callee);
  if (receiver !== undefined) {
    resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
  }
  const parameters = ast.parameters(methodDeclaration);
  for (const [index, argument] of callArguments.entries()) {
    if (argument === undefined) {
      continue;
    }
    const parameter = parameters[index];
    const expected = parameter === undefined
      ? undefined
      : walk.lifecycle.host.facts.get(parameter, runtimeCarrierFactKey)?.carrier ??
        resolveTypeNodeCarrier(walk, Node_Type(parameter));
    resolveExpressionCarrier(walk, argument, sourceFile, expected);
  }
  const returnCarrier = resolveTypeNodeCarrier(walk, Node_Type(methodDeclaration)) ?? rustUnitTargetType();
  const nameNode = ast.name(methodDeclaration);
  const methodName = nameNode === undefined ? "" : ast.text(nameNode);
  if (methodName.length === 0) {
    return undefined;
  }
  const operationId = `tsonic.rust.source.method:${methodName}`;
  recordTargetOperation(walk, expression, operationId, "method", methodName);
  setRustOperationFact(walk, expression, {
    kind: "source-method",
    operationId,
    name: methodName,
    mutatesSelf: methodMutatesSelf(walk, methodDeclaration),
    resultCarrier: returnCarrier,
  });
  return setCarrierFact(walk, expression, returnCarrier);
}

// --- Source-core flow markers ----------------------------------------------

interface FlowMarkerResolution {
  readonly carrier: TargetTypeRef | undefined;
}

// The generic source-semantics extension records flowStateFactKey on marker
// calls (borrow/borrowMut/move) and argumentPassingFactKey on out/ref/inref
// calls. The Rust target lowers flow markers by erasure (the consuming
// position's finalized argument mode owns the passing shape) and rejects the
// by-ref passing markers, which have no Rust lane.
function tryFlowMarkerCall(
  walk: RustFactWalk,
  expression: Node,
  callArguments: readonly (Node | undefined)[],
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): FlowMarkerResolution | undefined {
  const facts = walk.lifecycle.host.facts;
  const passing = facts.get(expression, argumentPassingFactKey);
  if (passing !== undefined && passing.mode.startsWith("byref")) {
    walk.lifecycle.host.diagnostics.append({
      extensionId: rustTargetSemanticsExtensionId,
      extensionCode: "RUST_SOURCE_MARKER_UNSUPPORTED",
      numericCode: 0,
      category: "error",
      message: `Source passing marker mode '${passing.mode}' has no Rust target lane; use borrow/borrowMut/move markers with finalized argument modes.`,
      evidence: [{ message: "target.capability=rust.source.passing-marker" }],
    });
    return { carrier: undefined };
  }
  const flow = facts.get(expression, flowStateFactKey);
  if (flow === undefined) {
    return undefined;
  }
  const [argument] = callArguments;
  const argumentCarrier = argument === undefined
    ? undefined
    : resolveExpressionCarrier(walk, argument, sourceFile, expected);
  if (flow.state !== "moved" && flow.state !== "borrowed-shared" && flow.state !== "borrowed-mut") {
    return { carrier: undefined };
  }
  setRustOperationFact(walk, expression, {
    kind: "flow-marker",
    operationId: `tsonic.rust.flow.${flow.state}`,
    state: flow.state,
  });
  if (argumentCarrier !== undefined) {
    setCarrierFact(walk, expression, argumentCarrier);
  }
  return { carrier: argumentCarrier };
}

function rowArgumentMode(row: RustProviderOperationRow, index: number): "value" | "ref" {
  const target = row.target;
  if (target.form === "call" || target.form === "free-call" || target.form === "receiver-method") {
    return target.argModes?.[index] ?? "value";
  }
  return "value";
}

function validateFlowMarkerAgainstMode(
  walk: RustFactWalk,
  argument: Node,
  mode: "value" | "ref",
): void {
  const flow = walk.lifecycle.host.facts.get(argument, flowStateFactKey) ??
    walk.lifecycle.host.facts.get(argument, flowStateFactKey);
  const rustFact = walk.lifecycle.host.facts.get(argument, rustTargetOperationFactKey);
  const markerState = rustFact !== undefined && rustFact.kind === "flow-marker" ? rustFact.state : flow?.state;
  if (markerState === undefined) {
    return;
  }
  const compatible =
    (markerState === "moved" && mode === "value") ||
    (markerState === "borrowed-shared" && mode === "ref");
  if (!compatible) {
    walk.lifecycle.host.diagnostics.append({
      extensionId: rustTargetSemanticsExtensionId,
      extensionCode: "RUST_FLOW_MARKER_MISMATCH",
      numericCode: 0,
      category: "error",
      message: `Flow marker state '${markerState}' does not match the finalized argument mode '${mode}' for this position.`,
      evidence: [{ message: "target.capability=rust.source.flow-marker" }],
    });
  }
}
