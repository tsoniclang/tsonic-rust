import {
  flowStateFactKey,
  functionPointerFactKey,
} from "@tsonic/tsts";
import type {
  AstReader,
  Node,
  SourceFile,
} from "@tsonic/tsts";
import type { RustAssignmentOperator } from "../../common/rust-syntax.js";
import { isDenseDataArray } from "../../common/closed-metadata.js";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import {
  ElementAccessExpression_ArgumentExpression,
  BinaryExpression_Left,
  BinaryExpression_OperatorToken,
  BinaryExpression_Right,
  CatchClause_Block,
  ForInOrOfStatement_Initializer,
  ForInOrOfStatement_Statement,
  TryStatement_CatchClause,
  TryStatement_TryBlock,
  ForStatement_Condition,
  ForStatement_Incrementor,
  ForStatement_Initializer,
  IfStatement_ElseStatement,
  IfStatement_ThenStatement,
  IterationStatement_Statement,
  Node_Operand,
  KindBinaryExpression,
  KindBlock,
  KindCallExpression,
  KindElementAccessExpression,
  KindEqualsEqualsEqualsToken,
  KindEqualsToken,
  KindExclamationEqualsEqualsToken,
  KindExpressionStatement,
  KindFalseKeyword,
  KindForOfStatement,
  KindForStatement,
  KindFunctionDeclaration,
  KindIdentifier,
  KindIfStatement,
  KindArrayLiteralExpression,
  KindNewExpression,
  KindNumericLiteral,
  KindOmittedExpression,
  KindParameter,
  KindParenthesizedExpression,
  KindPostfixUnaryExpression,
  KindPrefixUnaryExpression,
  KindPropertyAccessExpression,
  KindQuestionQuestionToken,
  KindReturnStatement,
  KindStringLiteral,
  KindTrueKeyword,
  KindVariableDeclaration,
  KindVariableStatement,
  KindWhileStatement,
  Node_Expression,
  Node_Initializer,
  Node_Type,
  asSourceNode,
} from "../../common/source-ast.js";
import {
  isRustJsArrayCarrier,
  rustFutureOutputCarrier,
  isRustNumericCarrier,
  isRustNullishSourceCarrier,
  isRustOptionCarrier,
  rustOptionElementCarrier,
  isRustVecCarrier,
  rustJsArrayTargetType,
  rustNullishSourceTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
  inferRustTargetTypeParameterBindings,
  substituteRustTargetTypeParameters,
  rustVecTargetType,
} from "../rust-target-types.js";
import { rustAsyncFunctionFactKey, rustFallibleFactKey, rustMutatedBindingFactKey, rustMutatedReferentFactKey, rustOptionWrapFactKey, rustPostCheckOperationKind, rustPostCheckUnaryMinusOperationId, rustPostCheckUnaryPlusOperationId, rustSelfModeFactKey, rustSourceBindingFactKey, rustSourceCallEffectsFactKey, rustSourceParameterAbiFactKey, rustSourceTypeCarrierValue, rustTargetOperationFactKey, rustTargetOperationResultCarrier, rustUnionVariantsFactKey } from "../rust-facts/keys.js";
import type { RustTargetOperationFact } from "../rust-facts/keys.js";
import {
  rustTargetOperationIsDirectLocation,
  rustTargetOperationText,
} from "../rust-facts/target-operation.js";
import { rustValueConversionIsFallible } from "../rust-facts/value-conversions.js";
import {
  isRustFinalizedSliceInput,
  isRustFinalizedSourceInput,
} from "../rust-facts/finalized-operation-abi.js";
import type { RustFinalizedOperationAbi } from "../rust-facts/finalized-operation-abi.js";
import { collectRustProviderSemantics } from "../provider-packages/index.js";
import type { RustProviderOperationRow } from "../provider-packages/index.js";
import {
  isRustAssignmentOperator,
  rustBinaryResultCarrierIsIndependentOfOperands,
  rustOperatorCarrierKey,
  selectRustBinaryOperator,
  selectRustCompoundAssignment,
  selectRustEquivalentAssignment,
} from "./operator-rules.js";
import { readRustTypescriptCompatibilityMode } from "../../options/rust-target-options.js";
import {
  finalizeRustDeferredCheckedCall,
  selectRustCheckedCall,
  selectRustCheckedConversion,
  selectRustCheckedElementAccess,
  selectRustCheckedIteration,
  selectRustCheckedOperator,
  selectRustCheckedPropertyAccess,
  selectRustCheckedValue,
} from "./operations-provider.js";
import type { RustOperationsProviderOptions } from "./operations-provider.js";
import { resolveRustTargetTypeRef } from "./target-type-resolution.js";
import type { RustTargetTypeResolutionContext } from "./target-type-resolution.js";
import { createRustSourceTypeRegistry } from "./source-type-registry.js";
import type { RustSourceTypeRegistry } from "./source-type-registry.js";
import { createRustSourceProfileRegistry } from "./source-profile-registry.js";
import type { RustSourceProfileRegistry } from "./source-profile-registry.js";
import { selectedSourceLiteralIsRepresentable } from "./selected-numeric-literal.js";
import {
  createRustSourceCallableAbiResolver,
} from "./source-callable-abi.js";
import type { RustSourceCallableAbiResolver } from "./source-callable-abi.js";
import type {
  RustSelectedTargetSignature,
  RustTargetMember,
  TargetTypeRef,
} from "../../policy/types.js";
import {
  rustArgumentPassingKey,
  rustConversionKey,
  rustRuntimeCarrierKey,
  rustSelectedCallKey,
  rustSelectedOperationKey,
} from "../../policy/model.js";
import type { RustTranslationContext } from "../../translate/context.js";
import type { RustOperationPolicyContext } from "../../policy/operations/contracts.js";
import { rustPolicyTargetDiagnostic } from "../../policy/operations/contracts.js";

export const rustTargetSemanticsExtensionId = "tsonic.rust.policy";

interface RustFactWalk {
  readonly context: RustTranslationContext;
  readonly providerRows: readonly RustProviderOperationRow[];
  readonly resolving: Set<object>;
  readonly jsEnabled: boolean;
  readonly sourceProfiles: RustSourceProfileRegistry;
  readonly sourceTypes: RustSourceTypeRegistry;
  readonly providerCarrierPaths: ReadonlyMap<string, string>;
  readonly sourceCallableAbi: RustSourceCallableAbiResolver;
  readonly operationOptions: RustOperationsProviderOptions;
  readonly operationAttempts: WeakSet<object>;
  readonly postCheckOperations: WeakMap<object, "binary" | "unary-minus" | "unary-plus">;
  readonly deferredCallbackCalls: WeakMap<Node, {
    readonly request: import("../../policy/operations/contracts.js").RustCheckedCallSelectionInput;
    readonly selection: Extract<
      import("../../policy/operations/contracts.js").RustCheckedCallSelectionResult,
      { readonly kind: "deferred-callback" }
    >;
  }>;
  currentThisCarrier?: TargetTypeRef;
  currentMethodDeclaration?: Node;
  currentCallableDeclaration?: Node;
}

const boolCarrier = rustSourcePrimitiveTargetType("bool");

function rustResolutionContext(
  walk: RustFactWalk,
  node: Node,
): RustTargetTypeResolutionContext {
  const checker = walk.context.semanticsFor(node);
  return {
    ...walk.context,
    currentSourceFile: checker.sourceFile,
    checker,
    typeShape: checker,
  };
}

function appendRustDiagnostic(
  walk: RustFactWalk,
  code: string,
  message: string,
  node: Node | undefined,
  evidence: readonly string[],
): void {
  walk.context.diagnostics.push({
    code,
    category: "error",
    source: "tsonic-rust",
    message,
    ...(node === undefined ? {} : { sourceNode: node }),
    evidence,
  });
}

function rustOperationContext(
  walk: RustFactWalk,
  node: Node,
): RustOperationPolicyContext {
  return {
    ...rustResolutionContext(walk, node),
    extensionId: rustTargetSemanticsExtensionId,
  };
}

function recordPolicySelection<T extends { readonly operation?: unknown }>(
  walk: RustFactWalk,
  subject: Node,
  selection: import("../../policy/operations/contracts.js").RustPolicySelection<T>,
): void {
  if (selection.kind === "reject") {
    walk.context.diagnostics.push(rustPolicyTargetDiagnostic(selection.diagnostic));
    return;
  }
  const operation = selection.value.operation;
  const deferredKind = operation === undefined
    ? undefined
    : rustPostCheckOperationKind(
        (operation as import("../../policy/types.js").RustSelectedTargetOperation).operationId,
      );
  if (deferredKind !== undefined) {
    walk.postCheckOperations.set(subject, deferredKind);
    return;
  }
  if (operation !== undefined && walk.context.facts.getSelectedTargetOperator(subject) === undefined) {
    walk.context.facts.set(
      subject,
      rustSelectedOperationKey,
      operation as import("../../policy/types.js").RustSelectedTargetOperation,
    );
  }
}

function selectExpressionOperation(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
): void {
  if (walk.operationAttempts.has(expression)) {
    return;
  }
  walk.operationAttempts.add(expression);
  const { ast } = walk.context;
  const semantics = walk.context.semantics(sourceFile);
  const context = rustOperationContext(walk, expression);
  const kind = ast.kindName(expression);
  if (kind === KindIdentifier) {
    const reference = walk.context.source.navigation.sourceReferenceFor(expression);
    recordPolicySelection(walk, expression, selectRustCheckedValue({
      target: "rust",
      expression,
      ...(reference?.symbol === undefined ? {} : { sourceSelectedSymbol: reference.symbol }),
      ...(reference?.declaration === undefined ? {} : { sourceSelectedDeclaration: reference.declaration }),
    }, context, walk.operationOptions));
    return;
  }
  if (kind === "KindRegularExpressionLiteral") {
    const literalText = ast.text(expression);
    const lastSlash = literalText.lastIndexOf("/");
    if (literalText.startsWith("/") && lastSlash > 0) {
      resolveRegExpCreation(
        walk,
        expression,
        literalText.slice(1, lastSlash),
        literalText.slice(lastSlash + 1),
      );
    }
    return;
  }
  if (kind === KindCallExpression || kind === KindNewExpression) {
    const source = semantics.getResolvedCallInfo(expression);
    if (source === undefined) {
      return;
    }
    const sourceSelectedDeclaration = semantics.getSignatureDeclaration(source.selectedSignature);
    const sourceCalleeSymbol = source.sourceCallee.selectedSymbol ?? source.sourceCallee.symbol;
    const sourceCalleeDeclaration = source.sourceCallee.selectedDeclaration ?? source.sourceCallee.declaration;
    const request: import("../../policy/operations/contracts.js").RustCheckedCallSelectionInput = {
      target: "rust",
      call: expression,
      callee: source.sourceCallee.expression,
      arguments: source.sourceArguments.map((argument) => argument.expression),
      sourceArgumentBindings: source.sourceArgumentBindings,
      sourceSelectedSignatureParameters: source.sourceSelectedSignatureParameters,
      ...(source.sourceReceiver === undefined ? {} : { sourceReceiver: source.sourceReceiver }),
      ...(source.sourceCalleeAccess === undefined ? {} : { sourceCalleeAccess: source.sourceCalleeAccess }),
      sourceSelectedSignature: source.selectedSignature,
      ...(sourceSelectedDeclaration === undefined ? {} : { sourceSelectedDeclaration }),
      ...(sourceCalleeSymbol === undefined ? {} : { sourceCalleeSymbol }),
      ...(sourceCalleeDeclaration === undefined ? {} : { sourceCalleeDeclaration }),
      sourceReturnType: source.sourceResultType,
      ...(source.sourceSelectedMethodTypeArguments === undefined
        ? {}
        : { sourceSelectedMethodTypeArguments: source.sourceSelectedMethodTypeArguments }),
    };
    const selection = selectRustCheckedCall(request, context, walk.operationOptions);
    if (selection.kind === "reject") {
      walk.context.diagnostics.push(rustPolicyTargetDiagnostic(selection.diagnostic));
    } else if (selection.value.kind === "deferred-callback") {
      walk.deferredCallbackCalls.set(expression, {
        request,
        selection: selection.value,
      });
    }
    return;
  }
  if (kind === KindPropertyAccessExpression) {
    const source = semantics.getResolvedPropertyAccessInfo(expression);
    if (source === undefined || source.callCallee) {
      return;
    }
    recordPolicySelection(walk, expression, selectRustCheckedPropertyAccess({
      target: "rust",
      expression,
      receiver: source.receiver.expression,
      ...(source.selectedSymbol === undefined ? {} : { sourceSelectedSymbol: source.selectedSymbol }),
      ...(source.selectedDeclaration === undefined ? {} : { sourceSelectedDeclaration: source.selectedDeclaration }),
      sourceResultType: source.sourceReadType ?? source.sourceWriteType,
      optionalChain: source.optionalChain,
    }, context, walk.operationOptions));
    return;
  }
  if (kind === KindElementAccessExpression) {
    const source = semantics.getResolvedElementAccessInfo(expression);
    if (source === undefined || source.callCallee) {
      return;
    }
    recordPolicySelection(walk, expression, selectRustCheckedElementAccess({
      target: "rust",
      expression,
      receiver: source.receiver.expression,
      argument: source.argument.expression,
      ...(source.selectedSymbol === undefined ? {} : { sourceSelectedSymbol: source.selectedSymbol }),
      ...(source.selectedDeclaration === undefined ? {} : { sourceSelectedDeclaration: source.selectedDeclaration }),
      ...(source.selectedElementIndex === undefined ? {} : { sourceSelectedElementIndex: source.selectedElementIndex }),
      sourceResultType: source.sourceReadType ?? source.sourceWriteType,
      optionalChain: source.optionalChain,
    }, context, walk.operationOptions));
    return;
  }
  if ((kind === "KindAsExpression" || kind === "KindTypeAssertionExpression") &&
    !ast.isConstAssertion(expression)) {
    const sourceExpression = Node_Expression(ast, expression);
    const explicitTargetTypeNode = Node_Type(ast, expression);
    if (sourceExpression === undefined || explicitTargetTypeNode === undefined) {
      return;
    }
    const target = semantics.getTypeAtLocation(explicitTargetTypeNode);
    if (target === undefined) {
      return;
    }
    const sourceReference = walk.context.source.navigation.sourceReferenceFor(sourceExpression);
    const selection = selectRustCheckedConversion({
      conversionKind: "assertion",
      expression,
      sourceExpression,
      explicitTargetTypeNode,
      target,
      ...(sourceReference === undefined
        ? {}
        : {
            sourceSelectedSymbol: sourceReference.symbol,
            sourceSelectedDeclaration: sourceReference.declaration,
          }),
    }, context, walk.operationOptions);
    recordPolicySelection(walk, expression, selection);
    if (selection.kind === "accept" && selection.value.convertedType !== undefined) {
      walk.context.facts.set(expression, rustConversionKey, {
        convertedType: selection.value.convertedType,
      });
    }
    return;
  }
  if (kind !== KindBinaryExpression && kind !== KindPrefixUnaryExpression && kind !== KindPostfixUnaryExpression) {
    return;
  }
  const operator = rustOperatorText(ast.operatorKindName(expression));
  if (operator === undefined) {
    return;
  }
  const left = kind === KindBinaryExpression
    ? BinaryExpression_Left(ast, expression)
    : Node_Operand(ast, expression);
  const right = kind === KindBinaryExpression
    ? BinaryExpression_Right(ast, expression)
    : undefined;
  recordPolicySelection(walk, expression, selectRustCheckedOperator({
    target: "rust",
    expression,
    operator,
    ...(left === undefined ? {} : { left }),
    ...(right === undefined ? {} : { right }),
  }, context, walk.operationOptions));
}

function rustOperatorText(kind: string | undefined): string | undefined {
  const operators: Readonly<Record<string, string>> = {
    KindEqualsToken: "=",
    KindPlusToken: "+",
    KindMinusToken: "-",
    KindAsteriskToken: "*",
    KindSlashToken: "/",
    KindPercentToken: "%",
    KindLessThanToken: "<",
    KindLessThanEqualsToken: "<=",
    KindGreaterThanToken: ">",
    KindGreaterThanEqualsToken: ">=",
    KindEqualsEqualsEqualsToken: "===",
    KindExclamationEqualsEqualsToken: "!==",
    KindAmpersandAmpersandToken: "&&",
    KindBarBarToken: "||",
    KindQuestionQuestionToken: "??",
    KindPlusEqualsToken: "+=",
    KindMinusEqualsToken: "-=",
    KindAsteriskEqualsToken: "*=",
    KindSlashEqualsToken: "/=",
    KindPercentEqualsToken: "%=",
    KindExclamationToken: "!",
    KindPlusPlusToken: "++",
    KindMinusMinusToken: "--",
  };
  return kind === undefined ? undefined : operators[kind];
}

export function analyzeRustProgram(context: RustTranslationContext): void {
  const { ast } = context;
  const rawSourceFiles: readonly (SourceFile | undefined)[] = context.source.sourceFiles;
  if (!isDenseDataArray(rawSourceFiles) || rawSourceFiles.some((sourceFile) => sourceFile === undefined)) {
    appendMalformedSourceAstDiagnostic(context, "Checked source program contains an undefined or non-data source-file slot.");
    return;
  }
  const allSourceFiles = rawSourceFiles as readonly SourceFile[];
  const providerSemantics = collectRustProviderSemantics(context.backend);
  const providerRows = providerSemantics.operations;
  const jsEnabled = context.backend.selectedSurfaces.some((surface) => surface.id === "js") ||
    readRustTypescriptCompatibilityMode(context.target) === "compat";
  const sourceProfiles = createRustSourceProfileRegistry(
    allSourceFiles,
    ast,
    jsEnabled,
  );
  const sourceTypes = createRustSourceTypeRegistry();
  const sourceCallableAbi = createRustSourceCallableAbiResolver();
  const projectSourceFiles = [...context.sourceFiles]
    .sort((left, right) => ast.getFileName(left).localeCompare(ast.getFileName(right)));
  for (const sourceFile of projectSourceFiles) {
    const statements = ast.statements(sourceFile);
    if (!isDenseDataArray(statements) || statements.some((statement) => statement === undefined)) {
      appendMalformedSourceAstDiagnostic(context, "Project source file contains an undefined or non-data top-level statement slot.");
      return;
    }
  }
  const operationOptions: RustOperationsProviderOptions = {
    providerExports: providerSemantics.exports,
    providerRows,
    providerTypes: providerSemantics.types,
    providerCarrierPaths: providerSemantics.carrierPaths,
    jsEnabled,
    regExpSubsetViolation: rustRegExpSubsetViolation,
    sourceProfiles,
    sourceTypes,
    sourceCallableAbi,
  };
  const walk: RustFactWalk = {
    context,
    providerRows,
    resolving: new Set(),
    jsEnabled,
    sourceProfiles,
    sourceTypes,
    providerCarrierPaths: providerSemantics.carrierPaths,
    sourceCallableAbi,
    operationOptions,
    operationAttempts: new WeakSet<object>(),
    postCheckOperations: new WeakMap<object, "binary" | "unary-minus" | "unary-plus">(),
    deferredCallbackCalls: new WeakMap(),
  };
  // Pass 0: register every project type declaration so contextual record
  // binding works regardless of file order.
  for (const sourceFile of projectSourceFiles) {
    sourceTypes.registerSourceFile(sourceFile, ast);
    for (const statement of ast.statements(sourceFile) as readonly Node[]) {
      const kind = ast.kindName(statement);
      if (kind === "KindInterfaceDeclaration") {
        recordInterfaceFacts(walk, statement);
      } else if (kind === "KindTypeAliasDeclaration") {
        registerUnionAlias(walk, statement);
      }
    }
  }
  // Pass 1: finalize every callable declaration ABI before walking any body.
  // Cross-file and forward calls therefore observe the same parameter facts.
  const signatureDiagnosticCount = context.diagnostics.length;
  for (const sourceFile of projectSourceFiles) {
    for (const statement of ast.statements(sourceFile) as readonly Node[]) {
      const kind = ast.kindName(statement);
      if (kind === KindFunctionDeclaration) {
        recordFunctionSignatureFacts(walk, statement);
      } else if (kind === "KindClassDeclaration") {
        recordClassSignatureFacts(walk, statement);
      } else if (kind === "KindEnumDeclaration") {
        recordEnumFacts(walk, statement, sourceFile);
      }
    }
  }
  if (context.diagnostics.length !== signatureDiagnosticCount) {
    return;
  }
  // Pass 1b: close method receiver modes from checked source identity before
  // any call ABI is recorded. Direct writes and finalized mutating provider
  // receivers seed a source-method call graph; mutability then propagates to
  // callers to a fixpoint.
  recordMethodSelfModeFacts(walk, projectSourceFiles);
  // Pass 2: finalize bodies and expressions against the closed declaration
  // ABI from pass 1.
  for (const sourceFile of projectSourceFiles) {
    for (const statement of ast.statements(sourceFile) as readonly Node[]) {
      const kind = ast.kindName(statement);
      if (kind === KindFunctionDeclaration) {
        recordFunctionBodyFacts(walk, statement, sourceFile);
      } else if (kind === KindVariableStatement) {
        recordVariableStatementFacts(walk, statement, sourceFile);
      } else if (kind === "KindClassDeclaration") {
        recordClassBodyFacts(walk, statement, sourceFile);
      }
    }
  }
  // Fallibility depends on finalized operation facts produced while walking
  // bodies. Compute the declaration fixpoint only after those facts exist.
  recordFallibilityFacts(walk, projectSourceFiles);
}

function promiseInnerCarrier(walk: RustFactWalk, typeNode: Node | undefined): TargetTypeRef | undefined {
  return rustFutureOutputCarrier(resolveTypeNodeCarrier(walk, typeNode));
}

function recordFunctionSignatureFacts(walk: RustFactWalk, declaration: Node): void {
  const { ast } = walk.context;
  if (ast.hasModifierKind(declaration, "async")) {
    const inner = promiseInnerCarrier(walk, Node_Type(walk.context.ast, declaration));
    if (inner !== undefined) {
      walk.context.facts.set(declaration, rustAsyncFunctionFactKey, { isAsync: true, outputCarrier: inner }, [
        { message: "rust async function" },
      ]);
    }
  }
  const parameters = requireDenseSourceNodes(walk, ast.parameters(declaration), "Function declaration contains an undefined or non-data parameter slot.");
  if (parameters === undefined) {
    return;
  }
  for (const parameter of parameters) {
    recordParameterAbiFacts(walk, parameter);
  }
}

function recordFunctionBodyFacts(walk: RustFactWalk, declaration: Node, sourceFile: SourceFile): void {
  const { ast } = walk.context;
  const asyncFact = walk.context.facts.get(declaration, rustAsyncFunctionFactKey);
  const returnCarrier = asyncFact?.outputCarrier ?? resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, declaration));
  const body = ast.body(declaration);
  const previousCallable = walk.currentCallableDeclaration;
  walk.currentCallableDeclaration = declaration;
  if (body !== undefined) {
    const statements = requireDenseSourceNodes(walk, ast.statements(body), "Function body contains an undefined or non-data statement slot.");
    if (statements === undefined) {
      walk.currentCallableDeclaration = previousCallable;
      return;
    }
    for (const statement of statements) {
      recordStatementFacts(walk, statement, sourceFile, returnCarrier);
    }
  }
  walk.currentCallableDeclaration = previousCallable;
}

function recordVariableStatementFacts(walk: RustFactWalk, statement: Node, sourceFile: SourceFile): void {
  for (const declaration of collectDescendantsOfKind(walk, statement, KindVariableDeclaration)) {
    const annotated = resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, declaration));
    const initializer = Node_Initializer(walk.context.ast, declaration);
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
  const { ast } = walk.context;
  const kind = ast.kindName(statement);
  if (kind === KindBlock) {
    const statements = requireDenseSourceNodes(walk, ast.statements(statement), "Block contains an undefined or non-data statement slot.");
    if (statements === undefined) {
      return;
    }
    for (const child of statements) {
      recordStatementFacts(walk, child, sourceFile, returnCarrier);
    }
    return;
  }
  if (kind === KindVariableStatement) {
    recordVariableStatementFacts(walk, statement, sourceFile);
    return;
  }
  if (kind === KindReturnStatement) {
    const expression = Node_Expression(walk.context.ast, statement);
    if (expression !== undefined) {
      resolveExpressionCarrier(walk, expression, sourceFile, returnCarrier);
    }
    return;
  }
  if (kind === KindExpressionStatement) {
    const expression = Node_Expression(walk.context.ast, statement);
    if (expression === undefined) {
      return;
    }
    if (ast.kindName(expression) === KindBinaryExpression) {
      const operatorToken = BinaryExpression_OperatorToken(walk.context.ast, expression);
      const operatorKind = operatorToken === undefined ? "" : ast.kindName(operatorToken);
      if (isRustAssignmentOperator(operatorKind)) {
        const left = BinaryExpression_Left(walk.context.ast, expression);
        recordBindingWrite(walk, left);
      }
    }
    resolveExpressionCarrier(walk, expression, sourceFile, undefined);
    return;
  }
  if (kind === "KindThrowStatement") {
    recordThrowFacts(walk, statement, sourceFile);
    return;
  }
  if (kind === "KindTryStatement") {
    const tryBlock = TryStatement_TryBlock(walk.context.ast, statement);
    if (tryBlock !== undefined) {
      recordStatementFacts(walk, tryBlock, sourceFile, returnCarrier);
    }
    const catchBlock = CatchClause_Block(walk.context.ast, TryStatement_CatchClause(walk.context.ast, statement));
    if (catchBlock !== undefined) {
      recordStatementFacts(walk, catchBlock, sourceFile, returnCarrier);
    }
    return;
  }
  if (kind === KindIfStatement) {
    const condition = Node_Expression(walk.context.ast, statement);
    if (condition !== undefined) {
      resolveExpressionCarrier(walk, condition, sourceFile, boolCarrier);
    }
    const thenStatement = IfStatement_ThenStatement(walk.context.ast, statement);
    if (thenStatement !== undefined) {
      recordStatementFacts(walk, thenStatement, sourceFile, returnCarrier);
    }
    const elseStatement = IfStatement_ElseStatement(walk.context.ast, statement);
    if (elseStatement !== undefined) {
      recordStatementFacts(walk, elseStatement, sourceFile, returnCarrier);
    }
    return;
  }
  if (kind === KindWhileStatement) {
    const condition = Node_Expression(walk.context.ast, statement);
    if (condition !== undefined) {
      resolveExpressionCarrier(walk, condition, sourceFile, boolCarrier);
    }
    const body = IterationStatement_Statement(walk.context.ast, statement);
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
    const initializer = ForStatement_Initializer(walk.context.ast, statement);
    if (initializer !== undefined) {
      for (const declaration of collectDescendantsOfKind(walk, initializer, KindVariableDeclaration)) {
        const annotated = resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, declaration));
        const declarationInitializer = Node_Initializer(walk.context.ast, declaration);
        const initializerCarrier = declarationInitializer === undefined
          ? undefined
          : resolveExpressionCarrier(walk, declarationInitializer, sourceFile, annotated);
        const effective = annotated ?? initializerCarrier;
        if (effective !== undefined) {
          setCarrierFact(walk, declaration, effective);
        }
      }
    }
    const condition = ForStatement_Condition(walk.context.ast, statement);
    if (condition !== undefined) {
      resolveExpressionCarrier(walk, condition, sourceFile, boolCarrier);
    }
    const incrementor = ForStatement_Incrementor(walk.context.ast, statement);
    if (incrementor !== undefined) {
      resolveExpressionCarrier(walk, incrementor, sourceFile, undefined);
    }
    const body = IterationStatement_Statement(walk.context.ast, statement);
    if (body !== undefined) {
      recordStatementFacts(walk, body, sourceFile, returnCarrier);
    }
    return;
  }
}



function resolveTypeNodeCarrier(walk: RustFactWalk, typeNode: Node | undefined): TargetTypeRef | undefined {
  if (typeNode === undefined) {
    return undefined;
  }
  const facts = walk.context.facts;
  const existing = facts.get(typeNode, rustRuntimeCarrierKey) ??
    walk.context.facts.resolve(typeNode, rustRuntimeCarrierKey);
  if (existing !== undefined) {
    return existing.carrier;
  }
  if (facts.get(typeNode, functionPointerFactKey) !== undefined) {
    appendRustDiagnostic(
      walk,
      "RUST_SOURCE_MARKER_UNSUPPORTED",
      "FunctionPointer type markers have no Rust target lane yet; they require a separately approved callable ABI contract.",
      typeNode,
      ["target.capability=rust.source.type-marker"],
    );
    return undefined;
  }
  const carrier = resolveRustTargetTypeRef(
    typeNode,
    rustResolutionContext(walk, typeNode),
    walk.operationOptions,
  );
  return carrier === undefined ? undefined : setCarrierFact(walk, typeNode, carrier);
}

function resolveExpressionCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const facts = walk.context.facts;
  const existing = facts.get(expression, rustRuntimeCarrierKey) ??
    walk.context.facts.resolve(expression, rustRuntimeCarrierKey);
  if (walk.resolving.has(expression)) {
    return existing === undefined
      ? undefined
      : applyOptionLane(walk, expression, existing.carrier, expected);
  }
  walk.resolving.add(expression);
  try {
    if (existing !== undefined) {
      const operation = facts.get(expression, rustTargetOperationFactKey) ??
        walk.context.facts.resolve(expression, rustTargetOperationFactKey);
      recordSelectedOperationInputs(walk, expression, sourceFile, operation);
      return applyOptionLane(walk, expression, existing.carrier, expected);
    }
    resolveExpressionOperationDependencies(walk, expression, sourceFile, expected);
    selectExpressionOperation(walk, expression, sourceFile);
    const selectedCarrier = facts.get(expression, rustRuntimeCarrierKey) ??
      walk.context.facts.resolve(expression, rustRuntimeCarrierKey);
    if (selectedCarrier !== undefined) {
      return applyOptionLane(walk, expression, selectedCarrier.carrier, expected);
    }
    const selectedOperation = facts.get(expression, rustSelectedOperationKey) ??
      walk.context.facts.resolve(expression, rustSelectedOperationKey);
    if (selectedOperation !== undefined) {
      const rustOperation = facts.get(expression, rustTargetOperationFactKey) ??
        walk.context.facts.resolve(expression, rustTargetOperationFactKey);
      const finalizedResult = rustOperation === undefined
        ? selectedOperation.resultType
        : rustTargetOperationResultCarrier(rustOperation) ?? selectedOperation.resultType;
      const expressionKind = walk.context.ast.kindName(expression);
      const sourceCallNeedsLifecycle = finalizedResult === undefined && rustOperation === undefined &&
        (expressionKind === KindCallExpression || expressionKind === KindNewExpression);
      if (!sourceCallNeedsLifecycle &&
        (finalizedResult !== undefined || rustPostCheckOperationKind(selectedOperation.operationId) === undefined)) {
        recordSelectedOperationInputs(
          walk,
          expression,
          sourceFile,
          rustOperation,
        );
        return finalizedResult === undefined
          ? undefined
          : applyOptionLane(
              walk,
              expression,
              setCarrierFact(walk, expression, finalizedResult),
              expected,
            );
      }
    }
    const resolved = resolveExpressionCarrierUncached(walk, expression, sourceFile, expected);
    return applyOptionLane(walk, expression, resolved, expected);
  } finally {
    walk.resolving.delete(expression);
  }
}

function resolveExpressionOperationDependencies(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): void {
  const { ast } = walk.context;
  const kind = ast.kindName(expression);
  if (kind === KindBinaryExpression) {
    resolveBinaryOperandCarriers(walk, expression, sourceFile, expected);
    return;
  }
  if (kind === KindPrefixUnaryExpression || kind === KindPostfixUnaryExpression) {
    const operand = Node_Operand(ast, expression);
    if (operand !== undefined) {
      resolveExpressionCarrier(walk, operand, sourceFile, expected);
    }
    return;
  }
  if (kind === KindPropertyAccessExpression || kind === KindElementAccessExpression) {
    const receiver = Node_Expression(ast, expression);
    if (receiver !== undefined) {
      resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
    }
    if (kind === KindElementAccessExpression) {
      const argument = ElementAccessExpression_ArgumentExpression(ast, expression);
      if (argument !== undefined) {
        resolveExpressionCarrier(walk, argument, sourceFile, undefined);
      }
    }
    return;
  }
  if (kind === "KindAsExpression" || kind === "KindTypeAssertionExpression") {
    const operand = Node_Expression(ast, expression);
    if (operand !== undefined) {
      resolveExpressionCarrier(walk, operand, sourceFile, expected);
    }
    return;
  }
  if (kind === KindCallExpression || kind === KindNewExpression) {
    const source = walk.context.semantics(sourceFile).getResolvedCallInfo(expression);
    const receiver = source?.sourceReceiver?.expression;
    if (receiver !== undefined) {
      resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
    }
    for (const argument of source?.sourceArguments ?? []) {
      resolveExpressionCarrier(walk, argument.expression, sourceFile, undefined);
    }
  }
}

// Nullish lane: values flow into Option<T> positions through explicit
// Some-wrapping facts; null literals become None.
function applyOptionLane(
  walk: RustFactWalk,
  expression: Node,
  resolved: TargetTypeRef | undefined,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  if (expected === undefined || !isRustOptionCarrier(expected)) {
    return resolved;
  }
  const inner = rustOptionElementCarrier(expected);
  if (inner === undefined) {
    return resolved;
  }
  const existing = walk.context.facts.get(expression, rustTargetOperationFactKey);
  if (resolved !== undefined && isRustOptionCarrier(resolved)) {
    return resolved;
  }
  if (walk.context.ast.kindName(expression) === "KindNullKeyword" || isRustNullishSourceCarrier(resolved)) {
    if (existing === undefined) {
      setRustOperationFact(walk, expression, { kind: "option-none", operationId: "tsonic.rust.option.none" });
    }
    walk.context.facts.set(expression, rustConversionKey, { convertedType: expected }, [
      { message: "rust option none conversion" },
    ]);
    return expected;
  }
  if (resolved !== undefined && rustTargetTypeRefEquals(resolved, inner)) {
    if (existing === undefined || existing.kind === "operator-token" ||
      existing.kind === "provider-operation" || existing.kind === "source-field" ||
      existing.kind === "source-call" || existing.kind === "typed-location") {
      walk.context.facts.set(expression, rustOptionWrapFactKey, { wrap: true }, [{ message: "rust option wrap" }]);
    }
    walk.context.facts.set(expression, rustConversionKey, { convertedType: expected }, [
      { message: "rust option some conversion" },
    ]);
    return expected;
  }
  return resolved;
}

function resolveExpressionCarrierUncached(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const kind = walk.context.ast.kindName(expression);
  switch (kind) {
    case KindNumericLiteral: {
      const effectiveExpected = expected !== undefined && isRustOptionCarrier(expected)
        ? rustOptionElementCarrier(expected)
        : expected;
      if (effectiveExpected !== undefined && isRustNumericCarrier(effectiveExpected)) {
        return setCarrierFact(walk, expression, effectiveExpected);
      }
      if (effectiveExpected !== undefined) {
        return undefined;
      }
      const selected = resolveRustTargetTypeRef(
        expression,
        rustResolutionContext(walk, expression),
        walk.operationOptions,
      );
      return selected !== undefined && isRustNumericCarrier(selected)
        ? setCarrierFact(walk, expression, selected)
        : undefined;
    }
    case KindStringLiteral: {
      if (expected !== undefined) {
        const value = rustSourceTypeCarrierValue(expected);
        if (value !== undefined && value.shape === "enum") {
          const literal = walk.context.ast.text(expression);
          const variant = walk.sourceTypes.enumVariantForLiteral(expected, literal);
          if (variant !== undefined) {
            setRustOperationFact(walk, expression, {
              kind: "source-enum-member",
              operationId: `tsonic.rust.union.variant:${variant.name}`,
              name: variant.name,
              resultCarrier: expected,
            });
            return setCarrierFact(walk, expression, expected);
          }
        }
      }
      return setCarrierFact(walk, expression, rustStringTargetType());
    }
    case KindTrueKeyword:
    case KindFalseKeyword: {
      return setCarrierFact(walk, expression, boolCarrier);
    }
    case "KindNullKeyword": {
      return setCarrierFact(walk, expression, rustNullishSourceTargetType());
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
    case "KindObjectLiteralExpression": {
      return resolveRecordLiteralCarrier(walk, expression, sourceFile, expected);
    }
    case "KindArrowFunction": {
      return resolveArrowFunctionCarrier(walk, expression, sourceFile, expected);
    }
    case "KindRegularExpressionLiteral": {
      return undefined;
    }
    case "KindAwaitExpression": {
      const operand = Node_Expression(walk.context.ast, expression);
      const operandCarrier = operand === undefined
        ? undefined
        : resolveExpressionCarrier(walk, operand, sourceFile, undefined);
      const output = rustFutureOutputCarrier(operandCarrier);
      if (output === undefined) {
        return undefined;
      }
      setRustOperationFact(walk, expression, {
        kind: "await-op",
        operationId: "tsonic.rust.async.await",
        resultCarrier: output,
      });
      return setCarrierFact(walk, expression, output);
    }
    case KindParenthesizedExpression: {
      const inner = Node_Expression(walk.context.ast, expression);
      const carrier = inner === undefined
        ? undefined
        : resolveExpressionCarrier(walk, inner, sourceFile, expected);
      return carrier === undefined ? undefined : setCarrierFact(walk, expression, carrier);
    }
    case "KindAsExpression":
    case "KindTypeAssertionExpression": {
      const inner = Node_Expression(walk.context.ast, expression);
      const constAssertion = walk.context.ast.isConstAssertion(expression);
      const defaultedExpected = expected === undefined && constAssertion &&
        inner !== undefined && walk.context.ast.kindName(inner) === KindNumericLiteral
        ? rustSourcePrimitiveTargetType("float64")
        : expected;
      const carrier = inner === undefined
        ? undefined
        : resolveExpressionCarrier(walk, inner, sourceFile, defaultedExpected);
      if (carrier === undefined) {
        return undefined;
      }
      if (constAssertion) {
        const fact: RustTargetOperationFact = {
          kind: "source-conversion",
          operationId: "tsonic.rust.assertion.const",
          resultCarrier: carrier,
        };
        setRustOperationFact(walk, expression, fact);
        recordFinalizedOperatorSelection(walk, expression, fact, carrier);
      }
      return setCarrierFact(walk, expression, carrier);
    }
    case KindPrefixUnaryExpression:
    case KindPostfixUnaryExpression: {
      return resolvePostCheckUnaryCarrier(walk, expression, sourceFile, expected);
    }
    case KindBinaryExpression: {
      return resolvePostCheckBinaryCarrier(walk, expression, sourceFile, expected);
    }
    case KindCallExpression:
    case KindNewExpression: {
      return resolveCallLikeCarrier(walk, expression, sourceFile, kind, expected);
    }
    case KindPropertyAccessExpression: {
      return undefined;
    }
    case KindElementAccessExpression: {
      return undefined;
    }
    default: {
      return undefined;
    }
  }
}

function resolveBinaryOperandCarriers(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
  useAssignmentReadCarrier: boolean = false,
): {
  readonly left: TargetTypeRef | undefined;
  readonly right: TargetTypeRef | undefined;
  readonly leftNode: Node;
  readonly rightNode: Node;
  readonly operatorKind: string;
} | undefined {
  const leftNode = BinaryExpression_Left(walk.context.ast, expression);
  const rightNode = BinaryExpression_Right(walk.context.ast, expression);
  const operatorToken = BinaryExpression_OperatorToken(walk.context.ast, expression);
  if (leftNode === undefined || rightNode === undefined || operatorToken === undefined) {
    return undefined;
  }
  const operatorKind = walk.context.ast.kindName(operatorToken);
  const strictEquality = operatorKind === KindEqualsEqualsEqualsToken ||
    operatorKind === KindExclamationEqualsEqualsToken;
  const operandExpected = rustBinaryResultCarrierIsIndependentOfOperands(operatorKind)
    ? undefined
    : expected;
  if (strictEquality && expressionUsesContextualLiteralCarrier(walk.context.ast, leftNode)) {
    const right = resolveExpressionCarrier(walk, rightNode, sourceFile, operandExpected);
    const rightSemanticCarrier = resolveRustTargetTypeRef(
      rightNode,
      rustResolutionContext(walk, rightNode),
      walk.operationOptions,
    );
    const left = resolveExpressionCarrier(
      walk,
      leftNode,
      sourceFile,
      isRustNullishSourceCarrier(rightSemanticCarrier) ? undefined : right ?? operandExpected,
    );
    return { left, right, leftNode, rightNode, operatorKind };
  }
  let left = resolveExpressionCarrier(walk, leftNode, sourceFile, operandExpected);
  const rightSemanticCarrier = strictEquality
    ? resolveRustTargetTypeRef(
        rightNode,
        rustResolutionContext(walk, rightNode),
        walk.operationOptions,
      )
    : undefined;
  const initialRightExpectation = operatorKind === KindQuestionQuestionToken
    ? rustOptionElementCarrier(left) ?? expected
    : operatorKind === KindEqualsToken
      ? useAssignmentReadCarrier ? left ?? operandExpected : operandExpected
    : strictEquality
      ? isRustNullishSourceCarrier(rightSemanticCarrier) ? undefined : left ?? operandExpected
      : left ?? operandExpected;
  let right = resolveExpressionCarrier(
    walk,
    rightNode,
    sourceFile,
    initialRightExpectation,
  );
  if (left === undefined && right !== undefined) {
    left = resolveExpressionCarrier(walk, leftNode, sourceFile, right);
  }
  if (right === undefined && left !== undefined &&
    (operatorKind !== KindEqualsToken || useAssignmentReadCarrier)) {
    right = resolveExpressionCarrier(walk, rightNode, sourceFile, left);
  }
  return {
    left,
    right,
    leftNode,
    rightNode,
    operatorKind,
  };
}

function expressionUsesContextualLiteralCarrier(ast: AstReader, expression: Node): boolean {
  const kind = ast.kindName(expression);
  return kind === KindNumericLiteral || kind === KindStringLiteral;
}

function resolvePostCheckBinaryCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  if (walk.postCheckOperations.get(expression) !== "binary") {
    return undefined;
  }
  const operands = resolveBinaryOperandCarriers(walk, expression, sourceFile, expected, true);
  if (operands === undefined) {
    return undefined;
  }
  const { left, right, leftNode, operatorKind } = operands;
  const selectedLeftOperation = walk.context.facts.get(leftNode, rustSelectedOperationKey) ??
    walk.context.facts.resolve(leftNode, rustSelectedOperationKey);
  const selectedLeftFact = walk.context.facts.get(leftNode, rustTargetOperationFactKey) ??
    walk.context.facts.resolve(leftNode, rustTargetOperationFactKey);
  let fact: RustTargetOperationFact | undefined;
  if (operatorKind === KindQuestionQuestionToken) {
    const inner = rustOptionElementCarrier(left);
    if (inner !== undefined && right !== undefined &&
      rustTargetTypeRefEquals(inner, right)) {
      fact = {
        kind: "option-coalesce",
        operationId: "tsonic.rust.option.coalesce",
      };
    } else if (left !== undefined && right !== undefined &&
      rustTargetTypeRefEquals(left, right) &&
      !isRustOptionCarrier(left) && !isRustNullishSourceCarrier(left)) {
      fact = {
        kind: "nullish-identity",
        operationId: "tsonic.rust.nullish.identity",
        resultCarrier: left,
      };
    }
  } else if ((operatorKind === KindEqualsEqualsEqualsToken ||
      operatorKind === KindExclamationEqualsEqualsToken) &&
    ((isRustOptionCarrier(left) && isRustNullishSourceCarrier(right)) ||
      (isRustNullishSourceCarrier(left) && isRustOptionCarrier(right)))) {
    fact = {
      kind: "option-check",
      operationId: operatorKind === KindExclamationEqualsEqualsToken
        ? "tsonic.rust.option.is-some"
        : "tsonic.rust.option.is-none",
      negated: operatorKind === KindExclamationEqualsEqualsToken,
      optionOperand: isRustOptionCarrier(left) ? "left" : "right",
    };
  } else if (operatorKind === KindEqualsToken &&
    (selectedLeftOperation === undefined || rustTargetOperationIsDirectLocation(selectedLeftFact)) &&
    left !== undefined && right !== undefined &&
    rustTargetTypeRefEquals(left, right)) {
    const equivalentOperator = selectEquivalentBindingAssignment(
      walk,
      leftNode,
      operands.rightNode,
      left,
    );
    fact = {
      kind: "operator-token",
      operationId: equivalentOperator === undefined
        ? `tsonic.rust.operator.=.${rustOperatorCarrierKey(right)}`
        : `tsonic.rust.operator.${equivalentOperator}.equivalent.${rustOperatorCarrierKey(right)}`,
      operator: equivalentOperator ?? "=",
      resultCarrier: right,
    };
  } else {
    const compound = selectRustCompoundAssignment(operatorKind, left, right);
    if (compound !== undefined && left !== undefined) {
      fact = {
        kind: "operator-token",
        operationId: `tsonic.rust.operator.${compound}.${rustOperatorCarrierKey(left)}`,
        operator: compound,
        resultCarrier: left,
      };
    } else {
      const binary = selectRustBinaryOperator(operatorKind, left, right);
      if (binary !== undefined) {
        fact = binary.kind === "string-concat"
          ? {
              kind: "string-concat",
              operationId: "tsonic.rust.operator.concat.string",
              resultCarrier: binary.resultCarrier,
            }
          : {
              kind: "operator-token",
              operationId: `tsonic.rust.operator.${binary.rustOperator}.${rustOperatorCarrierKey(binary.resultCarrier)}`,
              operator: binary.rustOperator,
              resultCarrier: binary.resultCarrier,
            };
      }
    }
  }
  if (fact === undefined) {
    walk.postCheckOperations.delete(expression);
    if (operatorKind === KindEqualsToken && selectedLeftOperation !== undefined &&
      !rustTargetOperationIsDirectLocation(selectedLeftFact)) {
      appendRustDiagnostic(
        walk,
        "RUST_SELECTED_ASSIGNMENT_UNSUPPORTED",
        "Checked assignment target has no finalized Rust write operation.",
        expression,
        [
          "target.capability=rust.operation.assignment",
          `source.operatorKind=${operatorKind}`,
        ],
      );
    } else if (left !== undefined && right !== undefined) {
      const assignment = operatorKind === KindEqualsToken;
      appendRustDiagnostic(
        walk,
        assignment
          ? "RUST_ASSIGNMENT_CARRIER_UNSUPPORTED"
          : "RUST_BINARY_OPERATOR_CARRIER_UNSUPPORTED",
        assignment
          ? "Checked assignment has no closed Rust operation for the finalized value carriers."
          : `Checked binary operator '${operatorKind}' has no closed Rust operation for the finalized operand carriers.`,
        expression,
        [
          `target.capability=rust.operation.${assignment ? "assignment" : "binary"}`,
          `source.operatorKind=${operatorKind}`,
        ],
      );
    }
    return undefined;
  }
  const resultCarrier = fact.kind === "option-coalesce"
    ? rustOptionElementCarrier(left)
    : fact.kind === "option-check"
      ? rustSourcePrimitiveTargetType("bool")
      : rustTargetOperationResultCarrier(fact);
  if (resultCarrier === undefined) {
    return undefined;
  }
  setRustOperationFact(walk, expression, fact);
  recordFinalizedOperatorSelection(walk, expression, fact, resultCarrier);
  return setCarrierFact(walk, expression, resultCarrier);
}

function selectEquivalentBindingAssignment(
  walk: RustFactWalk,
  target: Node,
  value: Node,
  targetCarrier: TargetTypeRef,
): RustAssignmentOperator | undefined {
  const { ast } = walk.context;
  if (ast.kindName(target) !== KindIdentifier || ast.kindName(value) !== KindBinaryExpression) {
    return undefined;
  }
  const valueLeft = BinaryExpression_Left(ast, value);
  if (valueLeft === undefined || ast.kindName(valueLeft) !== KindIdentifier) {
    return undefined;
  }
  const targetReference = walk.context.source.navigation.sourceReferenceFor(target);
  const valueReference = walk.context.source.navigation.sourceReferenceFor(valueLeft);
  if (targetReference === undefined || valueReference === undefined ||
    targetReference.symbol !== valueReference.symbol ||
    targetReference.declaration !== valueReference.declaration) {
    return undefined;
  }
  const valueFact = walk.context.facts.get(value, rustTargetOperationFactKey) ??
    walk.context.facts.resolve(value, rustTargetOperationFactKey);
  return valueFact?.kind === "operator-token"
    ? selectRustEquivalentAssignment(valueFact.operator, targetCarrier, valueFact.resultCarrier)
    : undefined;
}

function resolvePostCheckUnaryCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const pendingKind = walk.postCheckOperations.get(expression);
  if ((pendingKind !== "unary-minus" && pendingKind !== "unary-plus") ||
    expected?.kind !== "source-primitive" || !isRustNumericCarrier(expected) ||
    !selectedSourceLiteralIsRepresentable(expression, expected.name, walk.context.ast)) {
    return undefined;
  }
  const operand = Node_Operand(walk.context.ast, expression);
  if (operand === undefined || resolveExpressionCarrier(walk, operand, sourceFile, expected) === undefined) {
    return undefined;
  }
  const fact: RustTargetOperationFact = pendingKind === "unary-minus"
    ? {
        kind: "operator-token",
        operationId: rustPostCheckUnaryMinusOperationId,
        operator: "-",
        resultCarrier: expected,
      }
    : {
        kind: "source-conversion",
        operationId: rustPostCheckUnaryPlusOperationId,
        resultCarrier: expected,
      };
  setRustOperationFact(walk, expression, fact);
  recordFinalizedOperatorSelection(walk, expression, fact, expected);
  return setCarrierFact(walk, expression, expected);
}

function recordFinalizedOperatorSelection(
  walk: RustFactWalk,
  expression: Node,
  fact: RustTargetOperationFact,
  resultType: TargetTypeRef,
): void {
  walk.context.facts.set(expression, rustSelectedOperationKey, {
    operationId: fact.operationId,
    operationKind: "operator",
    targetOperation: rustTargetOperationText(fact),
    resultType,
    provenance: { sourceExpression: expression },
  }, [{ message: `rust finalized operator ${fact.operationId}` }]);
}

function resolveIdentifierCarrier(walk: RustFactWalk, identifier: Node, sourceFile: SourceFile): TargetTypeRef | undefined {
  const { ast } = walk.context;
  const reference = walk.context.source.navigation.sourceReferenceFor(identifier);
  const declaration = reference?.declaration;
  if (reference !== undefined && declaration !== undefined && reference.project) {
    const declarationKind = ast.kindName(declaration);
    const declarationFileName = ast.getFileName(ast.getSourceFile(declaration));
    const declarationName = ast.name(declaration);
    if (declarationName !== undefined && !isImportBindingDeclarationKind(declarationKind)) {
      const sourceName = ast.text(declarationName);
      if (sourceName.length > 0) {
        walk.context.facts.set(identifier, rustSourceBindingFactKey, {
          sourceName,
          fileName: declarationFileName,
        }, [{ message: "rust project-source binding" }]);
      }
    }
    if (declarationKind === KindParameter || declarationKind === KindVariableDeclaration) {
      const facts = walk.context.facts;
      const parameterAbi = declarationKind === KindParameter
        ? facts.get(declaration, rustSourceParameterAbiFactKey) ??
          walk.context.facts.resolve(declaration, rustSourceParameterAbiFactKey)
        : undefined;
      if (parameterAbi !== undefined) {
        facts.set(identifier, rustSourceParameterAbiFactKey, parameterAbi, [
          { message: "rust project-source parameter ABI use" },
        ]);
      }
      const declarationFact = facts.get(declaration, rustRuntimeCarrierKey);
      if (declarationFact !== undefined) {
        return setCarrierFact(walk, identifier, declarationFact.carrier);
      }
      const annotated = resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, declaration));
      if (annotated !== undefined) {
        setCarrierFact(walk, declaration, annotated);
        return setCarrierFact(walk, identifier, annotated);
      }
      const initializer = Node_Initializer(walk.context.ast, declaration);
      if (initializer !== undefined) {
        const initializerCarrier = resolveExpressionCarrier(walk, initializer, sourceFile, undefined);
        if (initializerCarrier !== undefined) {
          setCarrierFact(walk, declaration, initializerCarrier);
          return setCarrierFact(walk, identifier, initializerCarrier);
        }
      }
    }
  }
  const semantics = walk.context.semantics(sourceFile);
  const semanticType = semantics.getTypeAtLocation(identifier);
  return semanticType !== undefined && semantics.isNullish(semanticType)
    ? setCarrierFact(walk, identifier, rustNullishSourceTargetType())
    : undefined;
}

function isImportBindingDeclarationKind(kind: string): boolean {
  return kind === "KindImportSpecifier" ||
    kind === "KindImportClause" ||
    kind === "KindNamespaceImport" ||
    kind === "KindImportEqualsDeclaration";
}

function resolveCallLikeCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expressionKind: string,
  expected?: TargetTypeRef,
): TargetTypeRef | undefined {
  const { ast } = walk.context;
  const callee = Node_Expression(walk.context.ast, expression);
  if (callee === undefined) {
    return undefined;
  }
  const callArguments = ast.arguments(expression);
  const flowHandled = tryFlowMarkerCall(walk, expression, callArguments, sourceFile, expected);
  if (flowHandled !== undefined) {
    return flowHandled.carrier;
  }
  const deferred = walk.deferredCallbackCalls.get(expression);
  if (deferred !== undefined) {
    walk.deferredCallbackCalls.delete(expression);
    const finalized = finalizeRustDeferredCheckedCall(
      deferred.request,
      deferred.selection,
      rustOperationContext(walk, expression),
      walk.operationOptions,
      (argument, argumentExpected) =>
        resolveExpressionCarrier(walk, argument, sourceFile, argumentExpected),
    );
    if (finalized.kind === "reject") {
      walk.context.diagnostics.push(
        rustPolicyTargetDiagnostic(finalized.diagnostic),
      );
      return undefined;
    }
    const operation = walk.context.facts.get(
      expression,
      rustTargetOperationFactKey,
    );
    const resultCarrier = operation === undefined
      ? undefined
      : rustTargetOperationResultCarrier(operation);
    recordSelectedOperationInputs(
      walk,
      expression,
      sourceFile,
      operation,
    );
    return resultCarrier === undefined
      ? undefined
      : setCarrierFact(walk, expression, resultCarrier);
  }
  const selectedSignature = walk.context.facts.get(expression, rustSelectedCallKey);
  const selectedSourceDeclaration = asSourceNode(
    selectedSignature?.sourceDeclaration,
    walk.context.ast,
  );
  if (selectedSignature !== undefined && selectedSourceDeclaration !== undefined &&
    selectedDeclarationIsProjectSource(walk, selectedSourceDeclaration)) {
    return applySelectedProjectSourceCall(
      walk,
      expression,
      callee,
      callArguments,
      sourceFile,
      expressionKind,
      selectedSourceDeclaration,
      selectedSignature,
      expected,
    );
  }
  return undefined;
}

function selectedDeclarationIsProjectSource(walk: RustFactWalk, declaration: Node): boolean {
  const { ast } = walk.context;
  const kind = ast.kindName(declaration);
  if (kind.length === 0) {
    return false;
  }
  const sourceFile = ast.getSourceFile(declaration);
  return ast.getFileName(sourceFile).length > 0 && !ast.isDeclarationFile(sourceFile);
}

function applySelectedProjectSourceCall(
  walk: RustFactWalk,
  expression: Node,
  callee: Node,
  callArguments: readonly (Node | undefined)[],
  sourceFile: SourceFile,
  expressionKind: string,
  selectedDeclaration: Node,
  selectedSignature: RustSelectedTargetSignature,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const { ast } = walk.context;
  const selectedMember = selectedSignature.member;
  if (!isDenseDataArray(callArguments) || callArguments.some((argument) => argument === undefined)) {
    appendMalformedSourceAst(walk, "Checked project-source call contains an undefined or non-data argument slot.");
    return undefined;
  }
  const targetTypeArguments = finalizeProjectSourceTargetTypeArguments(
    walk,
    selectedSignature,
    callArguments as readonly Node[],
    expected,
  );
  if (targetTypeArguments === undefined) {
    return undefined;
  }
  const substitutions = new Map<string, TargetTypeRef>();
  for (let index = 0; index < (selectedSignature.sourceSelectedMethodTypeArguments?.length ?? 0); index += 1) {
    const name = selectedSignature.sourceSelectedMethodTypeArguments?.[index]?.typeParameterName;
    const target = targetTypeArguments[index];
    if (name === undefined || target === undefined) {
      return undefined;
    }
    substitutions.set(name, target);
  }
  const bindings = selectedSignature.sourceArgumentBindings;
  const selectedParameters = selectedSignature.sourceSelectedSignatureParameters;
  if (bindings === undefined || selectedParameters === undefined) {
    appendRustDiagnostic(
      walk,
      "RUST_SOURCE_CALL_BINDINGS_MISSING",
      "Selected project-source call has no exact checker-selected argument binding evidence.",
      expression,
      ["target.capability=rust.source-call.argument-bindings"],
    );
    return undefined;
  }
  const parameterCarriers: TargetTypeRef[] = [];
  const argumentModes: ("value" | "ref" | "mut-ref")[] = [];
  for (const [index, argument] of (callArguments as readonly Node[]).entries()) {
    const argumentBindings = bindings.filter((binding) =>
      binding.sourceArgumentIndex === index);
    const firstBinding = argumentBindings[0];
    if (firstBinding === undefined || argumentBindings.some((binding) =>
      binding.sourceParameterIndex !== firstBinding.sourceParameterIndex ||
      binding.sourceForm !== firstBinding.sourceForm)) {
      appendRustDiagnostic(
        walk,
        "RUST_SOURCE_CALL_BINDING_AMBIGUOUS",
        `Project-source argument ${index} does not have one exact selected parameter binding.`,
        argument,
        ["target.capability=rust.source-call.argument-bindings"],
      );
      return undefined;
    }
    const selectedParameter = selectedParameters[firstBinding.sourceParameterIndex];
    const targetParameter = selectedMember.parameters[firstBinding.sourceParameterIndex];
    if (selectedParameter === undefined || targetParameter === undefined ||
      selectedParameter.parameterIndex !== firstBinding.sourceParameterIndex) {
      appendRustDiagnostic(
        walk,
        "RUST_SOURCE_CALL_PARAMETER_MISSING",
        `Project-source argument ${index} selects unavailable parameter ${firstBinding.sourceParameterIndex}.`,
        argument,
        ["target.capability=rust.source-call.argument-bindings"],
      );
      return undefined;
    }
    const parameterCarrier = substituteRustTargetTypeParameters(
      targetParameter.type,
      substitutions,
    );
    const mode = targetParameter.passingMode === "borrow-mut"
      ? "mut-ref" as const
      : targetParameter.passingMode === "borrow-shared"
        ? "ref" as const
        : "value" as const;
    parameterCarriers.push(parameterCarrier);
    argumentModes.push(mode);
    resolveExpressionCarrier(walk, argument, sourceFile, parameterCarrier);
    const passingMode = mode === "mut-ref"
      ? "borrow-mut" as const
      : mode === "ref" ? "borrow-shared" as const : "by-value" as const;
    walk.context.facts.set(argument, rustArgumentPassingKey, {
      mode: passingMode,
      ...(mode === "value" ? {} : { storageExpression: argument }),
    }, [{ message: `rust selected project-source argument ${index} passes as ${passingMode}` }]);
    validateFlowMarkerAgainstMode(walk, argument, mode);
    if (mode === "mut-ref") {
      recordBindingWrite(walk, argument, "referent");
    }
  }
  const resultCarrier = selectedMember.returnType === undefined
    ? undefined
    : substituteRustTargetTypeParameters(selectedMember.returnType, substitutions);
  if (resultCarrier === undefined) {
    return undefined;
  }
  const declarationKind = ast.kindName(selectedDeclaration);
  const operationId = selectedMember.id;
  let target: Extract<RustTargetOperationFact, { readonly kind: "source-call" }>["target"] | undefined;
  let operationKind: "method" | "constructor" = "method";
  if (expressionKind === KindNewExpression || declarationKind === "KindConstructor") {
    target = { form: "constructor", typeCarrier: resultCarrier };
    operationKind = "constructor";
  } else if (declarationKind === "KindMethodDeclaration") {
    const methodName = ast.text(ast.name(selectedDeclaration));
    if (methodName.length === 0) {
      return undefined;
    }
    if (ast.hasModifierKind(selectedDeclaration, "static")) {
      const classDeclaration = ast.parent(selectedDeclaration);
      const typeCarrier = classDeclaration === undefined
        ? undefined
        : sourceTypeCarrierForDeclaration(walk, classDeclaration);
      if (typeCarrier === undefined) {
        return undefined;
      }
      target = { form: "static-method", name: methodName, typeCarrier };
    } else {
      const receiver = ast.kindName(callee) === KindPropertyAccessExpression
        ? Node_Expression(walk.context.ast, callee)
        : undefined;
      if (receiver === undefined) {
        return undefined;
      }
      resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
      const selfMode = walk.context.facts.get(selectedDeclaration, rustSelfModeFactKey) ??
        walk.context.facts.resolve(selectedDeclaration, rustSelfModeFactKey);
      if (selfMode === undefined) {
        return undefined;
      }
      const mutatesSelf = selfMode.mode === "mut-ref";
      if (mutatesSelf) {
        recordBindingWrite(walk, receiver, "referent");
      }
      target = { form: "method", name: methodName, mutatesSelf };
    }
  } else if (declarationKind === KindFunctionDeclaration) {
    const name = ast.text(ast.name(selectedDeclaration));
    const fileName = ast.getFileName(ast.getSourceFile(selectedDeclaration));
    if (name.length === 0 || fileName.length === 0) {
      return undefined;
    }
    target = { form: "function", fileName, name };
  }
  if (target === undefined) {
    return undefined;
  }
  recordTargetOperation(walk, expression, operationId, operationKind, target.form);
  setRustOperationFact(walk, expression, {
    kind: "source-call",
    operationId,
    target,
    parameterCarriers,
    argumentModes,
    ...(targetTypeArguments.length === 0 ? {} : { targetTypeArguments }),
    resultCarrier,
  });
  return setCarrierFact(walk, expression, resultCarrier);
}

function finalizeProjectSourceTargetTypeArguments(
  walk: RustFactWalk,
  selected: RustSelectedTargetSignature,
  callArguments: readonly Node[],
  expected: TargetTypeRef | undefined,
): readonly TargetTypeRef[] | undefined {
  const sourceArguments = selected.sourceSelectedMethodTypeArguments ?? [];
  const selectedTargets = selected.targetTypeArguments ?? [];
  if (sourceArguments.length !== selectedTargets.length) {
    return undefined;
  }
  if (sourceArguments.length === 0) {
    return selectedTargets;
  }
  const parameterNames = new Set(sourceArguments.map((argument) => argument.typeParameterName));
  const finalized = [...selectedTargets];
  const inferred = reconcileProjectSourceArgumentTypeParameters(
    walk,
    selected,
    callArguments,
    parameterNames,
  );
  if (inferred === undefined) {
    return undefined;
  }
  for (let index = 0; index < sourceArguments.length; index += 1) {
    const source = sourceArguments[index]!;
    const target = inferred.get(source.typeParameterName);
    if (target !== undefined && source.explicitTypeNode === undefined) {
      finalized[index] = target;
    }
  }
  if (expected === undefined || selected.member.returnType === undefined) {
    return finalized;
  }
  const contextual = inferRustTargetTypeParameterBindings(
    selected.member.returnType,
    expected,
    parameterNames,
  );
  if (contextual === undefined || contextual.size === 0) {
    return finalized;
  }
  for (let index = 0; index < sourceArguments.length; index += 1) {
    const source = sourceArguments[index]!;
    const selectedTarget = finalized[index]!;
    const contextualTarget = contextual.get(source.typeParameterName);
    if (contextualTarget === undefined || rustTargetTypeRefEquals(selectedTarget, contextualTarget)) {
      continue;
    }
    if (source.explicitTypeNode !== undefined || !isRustNumericCarrier(selectedTarget) ||
      contextualTarget.kind !== "source-primitive" || !isRustNumericCarrier(contextualTarget) ||
      !projectSourceTypeArgumentHasLiteralProof(
        walk,
        selected.member,
        source.typeParameterName,
        callArguments,
        contextualTarget,
      )) {
      continue;
    }
    finalized[index] = contextualTarget;
  }
  return finalized;
}

function reconcileProjectSourceArgumentTypeParameters(
  walk: RustFactWalk,
  selected: RustSelectedTargetSignature,
  callArguments: readonly Node[],
  parameterNames: ReadonlySet<string>,
): ReadonlyMap<string, TargetTypeRef> | undefined {
  const reconciled = new Map<string, TargetTypeRef>();
  const bindings = selected.sourceArgumentBindings;
  if (bindings === undefined) {
    return reconciled;
  }
  for (const [argumentIndex, argument] of callArguments.entries()) {
    if (walk.context.ast.kindName(argument) === "KindNumericLiteral") {
      continue;
    }
    const matches = bindings.filter((binding) =>
      binding.sourceArgumentIndex === argumentIndex);
    const first = matches[0];
    if (first === undefined || matches.some((binding) =>
      binding.sourceParameterIndex !== first.sourceParameterIndex ||
      binding.sourceForm !== first.sourceForm)) {
      return undefined;
    }
    const parameter = selected.member.parameters[first.sourceParameterIndex];
    const actual = walk.context.facts.getRuntimeCarrierFact(argument)?.carrier;
    if (parameter === undefined || actual === undefined) {
      continue;
    }
    const candidate = inferRustTargetTypeParameterBindings(
      parameter.type,
      actual,
      parameterNames,
    );
    if (candidate === undefined) {
      continue;
    }
    for (const [name, carrier] of candidate) {
      const existing = reconciled.get(name);
      if (existing !== undefined && !rustTargetTypeRefEquals(existing, carrier)) {
        return undefined;
      }
      reconciled.set(name, carrier);
    }
  }
  return reconciled;
}

function projectSourceTypeArgumentHasLiteralProof(
  walk: RustFactWalk,
  member: RustTargetMember,
  typeParameterName: string,
  callArguments: readonly Node[],
  target: Extract<TargetTypeRef, { readonly kind: "source-primitive" }>,
): boolean {
  let proven = false;
  for (let index = 0; index < member.parameters.length; index += 1) {
    const parameter = member.parameters[index];
    if (parameter?.type.kind !== "type-parameter" || parameter.type.name !== typeParameterName) {
      continue;
    }
    const argument = callArguments[index];
    if (argument === undefined) {
      return false;
    }
    if (!selectedSourceLiteralIsRepresentable(argument, target.name, walk.context.ast)) {
      return false;
    }
    proven = true;
  }
  return proven;
}

function recordTargetOperation(
  walk: RustFactWalk,
  expression: Node,
  operationId: string,
  operationKind: "property" | "method" | "indexer" | "operator" | "constructor",
  targetOperation: string,
): void {
  walk.context.facts.set(
    expression,
    rustSelectedOperationKey,
    { operationId, operationKind, targetOperation },
    [{ message: `rust target operation ${operationId}` }],
  );
}

function setRustOperationFact(walk: RustFactWalk, expression: Node, fact: RustTargetOperationFact): void {
  walk.context.facts.set(expression, rustTargetOperationFactKey, fact, [
    { message: `rust operation ${fact.operationId}` },
  ]);
}

function setCarrierFact(walk: RustFactWalk, subject: Node, carrier: TargetTypeRef): TargetTypeRef | undefined {
  const facts = walk.context.facts;
  const existing = facts.get(subject, rustRuntimeCarrierKey) ??
    walk.context.facts.resolve(subject, rustRuntimeCarrierKey);
  if (existing !== undefined) {
    if (!rustTargetTypeRefEquals(existing.carrier, carrier)) {
      appendRustDiagnostic(
        walk,
        "RUST_RUNTIME_CARRIER_CONFLICT",
        "Selected source evidence and Rust analysis produced incompatible runtime carriers for the same source subject.",
        subject,
        [
          "target.capability=rust.runtime-carrier.single-owner",
          `existing=${JSON.stringify(existing.carrier)}`,
          `incoming=${JSON.stringify(carrier)}`,
        ],
      );
      return undefined;
    }
    return existing.carrier;
  }
  facts.set(subject, rustRuntimeCarrierKey, { carrier }, [{ message: "rust carrier" }]);
  return carrier;
}

function recordSelectedOperationInputs(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  fact: RustTargetOperationFact | undefined,
): void {
  const { ast } = walk.context;
  const kind = ast.kindName(expression);
  if (kind === KindBinaryExpression) {
    const left = BinaryExpression_Left(walk.context.ast, expression);
    const right = BinaryExpression_Right(walk.context.ast, expression);
    if (left !== undefined) {
      resolveExpressionCarrier(walk, left, sourceFile, undefined);
    }
    if (right !== undefined) {
      resolveExpressionCarrier(walk, right, sourceFile, undefined);
    }
    return;
  }
  if (kind === KindPrefixUnaryExpression || kind === KindPostfixUnaryExpression) {
    const operand = Node_Operand(walk.context.ast, expression);
    if (operand !== undefined) {
      resolveExpressionCarrier(walk, operand, sourceFile, undefined);
      if (fact?.kind === "operator-token" && (fact.operator === "+=" || fact.operator === "-=")) {
        recordBindingWrite(walk, operand);
      }
    }
    return;
  }
  if (kind === "KindAsExpression" || kind === "KindTypeAssertionExpression") {
    const operand = Node_Expression(walk.context.ast, expression);
    if (operand !== undefined) {
      resolveExpressionCarrier(walk, operand, sourceFile, undefined);
    }
    return;
  }
  if (kind === KindPropertyAccessExpression) {
    const receiver = Node_Expression(walk.context.ast, expression);
    if (receiver !== undefined) {
      resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
    }
    return;
  }
  if (kind === KindElementAccessExpression) {
    const receiver = Node_Expression(walk.context.ast, expression);
    const argument = ElementAccessExpression_ArgumentExpression(walk.context.ast, expression);
    if (receiver !== undefined) {
      resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
    }
    if (argument !== undefined) {
      resolveExpressionCarrier(
        walk,
        argument,
        sourceFile,
        fact?.kind === "provider-operation" ? fact.abi.sourceArguments[0]?.carrier : undefined,
      );
    }
    return;
  }
  if (kind === KindCallExpression || kind === KindNewExpression) {
    const callee = Node_Expression(walk.context.ast, expression);
    if (callee !== undefined && ast.kindName(callee) === KindPropertyAccessExpression) {
      const receiver = Node_Expression(walk.context.ast, callee);
      if (receiver !== undefined) {
        resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
        if (fact?.kind === "provider-operation" && fact.abi.targetReceiver.kind === "input" && fact.abi.targetReceiver.input.mode === "mut-ref") {
          recordBindingWrite(walk, receiver, "referent");
        }
      }
    }
    const callArguments = ast.arguments(expression);
    const selectedCall = walk.context.facts.getSelectedTargetCall(expression);
    for (const [index, argument] of callArguments.entries()) {
      if (argument === undefined) {
        continue;
      }
      resolveExpressionCarrier(
        walk,
        argument,
        sourceFile,
        selectedCall?.member.parameters[index]?.type ??
          (fact?.kind === "provider-operation"
            ? fact.abi.sourceArguments[index]?.carrier
            : undefined),
      );
      if (fact?.kind !== "provider-operation") {
        continue;
      }
      const mode = fact.abi.sourceArguments[index]?.mode;
      if (mode === undefined) {
        continue;
      }
      validateFlowMarkerAgainstMode(walk, argument, mode);
      if (mode === "mut-ref") {
        recordBindingWrite(walk, argument, "referent");
      }
    }
  }
}

function collectDescendantsOfKind(walk: RustFactWalk, root: Node, kindName: string): readonly Node[] {
  const { ast } = walk.context;
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

function resolveArrayLiteralCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const { ast } = walk.context;
  const sourceElements = ast.elements(expression);
  if (sourceElements.some((element) => element === undefined)) {
    appendMalformedSourceAst(walk, "Array literal contains an undefined element slot.");
    return undefined;
  }
  const elements = sourceElements as readonly Node[];
  const hasHoles = elements.some((element) => ast.kindName(element) === KindOmittedExpression);
  const presentElements = elements.filter((element) => ast.kindName(element) !== KindOmittedExpression);

  if (expected?.kind === "tuple" && expected.elements.length > 0 && !hasHoles && presentElements.length === expected.elements.length) {
    for (const [index, element] of presentElements.entries()) {
      resolveExpressionCarrier(walk, element, sourceFile, expected.elements[index]);
    }
    setRustOperationFact(walk, expression, {
      kind: "tuple-literal",
      operationId: "tsonic.rust.tuple.literal",
      resultCarrier: expected,
    });
    return setCarrierFact(walk, expression, expected);
  }
  let expectedElement: TargetTypeRef | undefined;
  let lane: "dense" | "sparse" = hasHoles ? "sparse" : "dense";
  if (expected !== undefined && isRustVecCarrier(expected)) {
    expectedElement = expected.element;
  } else if (expected?.kind === "target-named" && isRustJsArrayCarrier(expected)) {
    expectedElement = expected.typeArguments?.[0];
    lane = "sparse";
  }
  if (expected?.kind === "target-specific" && expected.name === "fixed-array") {
    const value = expected.value as { element: TargetTypeRef; length: number };
    if (presentElements.length !== value.length) {
      return undefined;
    }
    for (const element of presentElements) {
      resolveExpressionCarrier(walk, element, sourceFile, value.element);
    }
    setRustOperationFact(walk, expression, { kind: "fixed-array-literal", operationId: "tsonic.rust.fixed-array.literal" });
    return setCarrierFact(walk, expression, expected);
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
    appendRustDiagnostic(
      walk,
      "RUST_JS_SURFACE_REQUIRED",
      "Sparse array literals require the js surface or compat mode for the Rust target.",
      expression,
      ["target.capability=rust.js.sparse-array"],
    );
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
  const expression = Node_Expression(walk.context.ast, statement);
  if (expression !== undefined) {
    resolveExpressionCarrier(walk, expression, sourceFile, undefined);
  }
  const source = walk.context.semantics(sourceFile).getResolvedIterationInfo(statement);
  if (expression !== undefined && source !== undefined) {
    recordPolicySelection(walk, statement, selectRustCheckedIteration({
      target: "rust",
      statement,
      expression,
      initializer: ForInOrOfStatement_Initializer(walk.context.ast, statement),
      kind: source.iterationKind,
      sourceElementType: source.sourceElementType,
    }, rustOperationContext(walk, statement), walk.operationOptions));
  }
  const selected = walk.context.facts.get(statement, rustTargetOperationFactKey);
  if (selected?.kind === "for-of") {
    const initializer = ForInOrOfStatement_Initializer(walk.context.ast, statement);
    if (initializer !== undefined) {
      for (const declaration of collectDescendantsOfKind(walk, initializer, KindVariableDeclaration)) {
        setCarrierFact(walk, declaration, selected.elementCarrier);
      }
    }
    const body = ForInOrOfStatement_Statement(walk.context.ast, statement);
    if (body !== undefined) {
      recordStatementFacts(walk, body, sourceFile, returnCarrier);
    }
    return;
  }
  const body = ForInOrOfStatement_Statement(walk.context.ast, statement);
  if (body !== undefined) {
    recordStatementFacts(walk, body, sourceFile, returnCarrier);
  }
}

// --- Project-source classes and enums --------------------------------------

function sourceTypeCarrierForDeclaration(walk: RustFactWalk, declaration: Node): TargetTypeRef | undefined {
  return walk.sourceTypes.carrierForDeclaration(declaration, walk.context.ast);
}

function recordMethodSelfModeFacts(walk: RustFactWalk, sourceFiles: readonly SourceFile[]): void {
  const { ast } = walk.context;
  const methods: Node[] = [];
  for (const sourceFile of sourceFiles) {
    for (const statement of ast.statements(sourceFile) as readonly Node[]) {
      if (ast.kindName(statement) !== "KindClassDeclaration") {
        continue;
      }
      const members = requireDenseSourceNodes(walk, ast.members(statement), "Class declaration contains an undefined or non-data member slot.");
      if (members === undefined) {
        return;
      }
      for (const member of members) {
        if (ast.kindName(member) === "KindMethodDeclaration" &&
          !ast.hasModifierKind(member, "static")) {
          methods.push(member);
        }
      }
    }
  }
  const methodSet = new Set<Node>(methods);
  const mutating = new Set<Node>();
  const calls = new Map<Node, Set<Node>>();
  for (const method of methods) {
    const callees = new Set<Node>();
    calls.set(method, callees);
    const body = ast.body(method);
    if (body === undefined) {
      continue;
    }
    const visit = (node: Node): void => {
      const kind = ast.kindName(node);
      if (kind === KindBinaryExpression) {
        const operator = BinaryExpression_OperatorToken(walk.context.ast, node);
        const left = BinaryExpression_Left(walk.context.ast, node);
        if (operator !== undefined && left !== undefined &&
          isRustAssignmentOperator(ast.kindName(operator)) && expressionIsRootedAtThis(ast, left)) {
          mutating.add(method);
        }
      } else if ((kind === KindPrefixUnaryExpression || kind === KindPostfixUnaryExpression) &&
        expressionIsRootedAtThis(ast, Node_Operand(walk.context.ast, node))) {
        mutating.add(method);
      } else if (kind === KindCallExpression) {
        const callee = Node_Expression(walk.context.ast, node);
        const receiver = callee !== undefined && ast.kindName(callee) === KindPropertyAccessExpression
          ? Node_Expression(walk.context.ast, callee)
          : undefined;
        if (expressionIsRootedAtThis(ast, receiver)) {
          const selected = walk.context.facts.get(node, rustSelectedCallKey) ??
            walk.context.facts.resolve(node, rustSelectedCallKey);
          const selectedDeclaration = asSourceNode(selected?.sourceDeclaration, ast);
          if (selectedDeclaration !== undefined && methodSet.has(selectedDeclaration)) {
            callees.add(selectedDeclaration);
          }
          const operation = walk.context.facts.get(node, rustTargetOperationFactKey) ??
            walk.context.facts.resolve(node, rustTargetOperationFactKey);
          if ((operation?.kind === "provider-operation" || operation?.kind === "runtime-set") &&
            operation.abi.targetReceiver.kind === "input" &&
            operation.abi.targetReceiver.input.mode === "mut-ref") {
            mutating.add(method);
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
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const method of methods) {
      if (!mutating.has(method) && [...(calls.get(method) ?? [])].some((callee) => mutating.has(callee))) {
        mutating.add(method);
        changed = true;
      }
    }
  }
  for (const method of methods) {
    walk.context.facts.set(method, rustSelfModeFactKey, {
      mode: mutating.has(method) ? "mut-ref" : "ref",
    }, [{ message: "rust finalized method self mode" }]);
  }
}

function expressionIsRootedAtThis(ast: AstReader, expression: Node | undefined): boolean {
  let current = expression;
  while (current !== undefined) {
    const kind = ast.kindName(current);
    if (kind === "KindThisExpression" || kind === "KindThisKeyword") {
      return true;
    }
    if (kind !== KindPropertyAccessExpression && kind !== KindElementAccessExpression) {
      return false;
    }
    current = Node_Expression(ast, current);
  }
  return false;
}

function recordClassSignatureFacts(walk: RustFactWalk, declaration: Node): void {
  const { ast } = walk.context;
  const classCarrier = sourceTypeCarrierForDeclaration(walk, declaration);
  if (classCarrier === undefined) {
    return;
  }
  setCarrierFact(walk, declaration, classCarrier);
  const members = requireDenseSourceNodes(walk, ast.members(declaration), "Class declaration contains an undefined or non-data member slot.");
  if (members === undefined) {
    return;
  }
  for (const member of members) {
    const memberKind = ast.kindName(member);
    if (memberKind === "KindPropertyDeclaration") {
      const fieldCarrier = resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, member));
      if (fieldCarrier !== undefined) {
        setCarrierFact(walk, member, fieldCarrier);
      }
      continue;
    }
    if (memberKind === "KindConstructor" || memberKind === "KindMethodDeclaration") {
      const parameters = requireDenseSourceNodes(walk, ast.parameters(member), "Class callable contains an undefined or non-data parameter slot.");
      if (parameters === undefined) {
        return;
      }
      for (const parameter of parameters) {
        recordParameterAbiFacts(walk, parameter);
      }
    }
  }
}

function recordClassBodyFacts(walk: RustFactWalk, declaration: Node, sourceFile: SourceFile): void {
  const { ast } = walk.context;
  const classCarrier = sourceTypeCarrierForDeclaration(walk, declaration);
  if (classCarrier === undefined) {
    return;
  }
  const previousThis = walk.currentThisCarrier;
  walk.currentThisCarrier = classCarrier;
  const members = requireDenseSourceNodes(walk, ast.members(declaration), "Class declaration contains an undefined or non-data member slot.");
  if (members === undefined) {
    walk.currentThisCarrier = previousThis;
    return;
  }
  for (const member of members) {
    const memberKind = ast.kindName(member);
    if (memberKind === "KindConstructor" || memberKind === "KindMethodDeclaration") {
      const returnCarrier = memberKind === "KindMethodDeclaration"
        ? resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, member))
        : undefined;
      const previousMethod = walk.currentMethodDeclaration;
      const previousCallable = walk.currentCallableDeclaration;
      walk.currentMethodDeclaration = memberKind === "KindMethodDeclaration" ? member : undefined;
      walk.currentCallableDeclaration = member;
      const body = ast.body(member);
      if (body !== undefined) {
        const statements = requireDenseSourceNodes(walk, ast.statements(body), "Class callable body contains an undefined or non-data statement slot.");
        if (statements === undefined) {
          walk.currentMethodDeclaration = previousMethod;
          walk.currentCallableDeclaration = previousCallable;
          walk.currentThisCarrier = previousThis;
          return;
        }
        for (const statement of statements) {
          recordStatementFacts(walk, statement, sourceFile, returnCarrier);
        }
      }
      walk.currentMethodDeclaration = previousMethod;
      walk.currentCallableDeclaration = previousCallable;
    }
  }
  walk.currentThisCarrier = previousThis;
}

function recordInterfaceFacts(walk: RustFactWalk, declaration: Node): void {
  const { ast } = walk.context;
  const carrier = sourceTypeCarrierForDeclaration(walk, declaration);
  if (carrier === undefined) {
    return;
  }
  setCarrierFact(walk, declaration, carrier);
  const members = requireDenseSourceNodes(walk, ast.members(declaration), "Interface declaration contains an undefined or non-data member slot.");
  if (members === undefined) {
    return;
  }
  for (const member of members) {
    if (ast.kindName(member) !== "KindPropertySignature") {
      continue;
    }
    const fieldCarrier = resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, member));
    if (fieldCarrier !== undefined) {
      setCarrierFact(walk, member, fieldCarrier);
    }
  }
}

function appendMalformedSourceAstDiagnostic(context: RustTranslationContext, message: string): void {
  context.diagnostics.push({
    code: "RUST_SOURCE_AST_INCOMPLETE",
    category: "error",
    source: "tsonic-rust",
    message,
    evidence: ["target.capability=rust.source-ast.closed"],
  });
}

function appendMalformedSourceAst(walk: RustFactWalk, message: string): void {
  appendMalformedSourceAstDiagnostic(walk.context, message);
}

function requireDenseSourceNodes(
  walk: RustFactWalk,
  values: readonly (Node | undefined)[],
  message: string,
): readonly Node[] | undefined {
  if (!isDenseDataArray(values) || values.some((value) => value === undefined)) {
    appendMalformedSourceAst(walk, message);
    return undefined;
  }
  return values as readonly Node[];
}

function resolveRecordLiteralCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const { ast } = walk.context;
  const value = expected === undefined ? undefined : rustSourceTypeCarrierValue(expected);
  if (value === undefined || value.shape !== "struct" || expected === undefined) {
    return undefined;
  }
  const propertiesByName = new Map<string, Node>();
  const properties = requireDenseSourceNodes(walk, ast.properties(expression), "Object literal contains an undefined or non-data property slot.");
  if (properties === undefined) {
    return undefined;
  }
  for (const property of properties) {
    if (ast.kindName(property) !== "KindPropertyAssignment") {
      return undefined;
    }
    const nameNode = ast.name(property);
    const fieldName = nameNode === undefined ? "" : ast.text(nameNode);
    if (fieldName.length === 0) {
      return undefined;
    }
    if (propertiesByName.has(fieldName)) {
      return undefined;
    }
    propertiesByName.set(fieldName, property);
  }
  const shapeDeclaration = walk.sourceTypes.declarationForCarrier(expected);
  if (shapeDeclaration === undefined) {
    return undefined;
  }
  const fieldNames: string[] = [];
  const members = requireDenseSourceNodes(walk, ast.members(shapeDeclaration), "Record shape declaration contains an undefined or non-data member slot.");
  if (members === undefined) {
    return undefined;
  }
  for (const memberDeclaration of members) {
    if (ast.kindName(memberDeclaration) !== "KindPropertySignature") {
      continue;
    }
    const fieldName = ast.text(ast.name(memberDeclaration) ?? memberDeclaration);
    const property = propertiesByName.get(fieldName);
    if (fieldName.length === 0 || property === undefined) {
      return undefined;
    }
    const expectedField = walk.context.facts.get(memberDeclaration, rustRuntimeCarrierKey)?.carrier ??
      resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, memberDeclaration));
    const initializer = Node_Initializer(walk.context.ast, property);
    if (expectedField === undefined || initializer === undefined ||
      resolveExpressionCarrier(walk, initializer, sourceFile, expectedField) === undefined) {
      return undefined;
    }
    fieldNames.push(fieldName);
  }
  if (fieldNames.length !== propertiesByName.size) {
    return undefined;
  }
  setRustOperationFact(walk, expression, {
    kind: "record-literal",
    operationId: "tsonic.rust.record.literal",
    resultCarrier: expected,
    fieldNames,
  });
  return setCarrierFact(walk, expression, expected);
}

function registerUnionAlias(walk: RustFactWalk, declaration: Node): void {
  const variants = walk.sourceTypes.enumVariantsForDeclaration(declaration);
  if (variants === undefined) {
    return;
  }
  const carrier = sourceTypeCarrierForDeclaration(walk, declaration);
  if (carrier === undefined) {
    return;
  }
  setCarrierFact(walk, declaration, carrier);
  walk.context.facts.set(declaration, rustUnionVariantsFactKey, { variants }, [
    { message: "rust union variants" },
  ]);
}

function recordEnumFacts(walk: RustFactWalk, declaration: Node, _sourceFile: SourceFile): void {
  const carrier = sourceTypeCarrierForDeclaration(walk, declaration);
  if (carrier !== undefined) {
    setCarrierFact(walk, declaration, carrier);
  }
}

function resolveParameterAbi(walk: RustFactWalk, parameter: Node) {
  return walk.sourceCallableAbi.resolveParameterAbi(
    parameter,
    rustResolutionContext(walk, parameter),
    walk.operationOptions,
  );
}

function recordParameterAbiFacts(walk: RustFactWalk, parameter: Node): void {
  const parameterAbi = resolveParameterAbi(walk, parameter);
  if (parameterAbi === undefined) {
    appendRustDiagnostic(
      walk,
      "RUST_PARAMETER_CARRIER_UNSUPPORTED",
      "Parameter type has no closed Rust runtime carrier under the selected source-profile and surface policy.",
      parameter,
      ["target.capability=rust.callable.parameter-carrier"],
    );
    return;
  }
  setCarrierFact(walk, parameter, parameterAbi.valueCarrier);
  setParameterAbiFact(walk, parameter, parameterAbi.parameterCarrier, parameterAbi.mode);
}

function setParameterAbiFact(
  walk: RustFactWalk,
  parameter: Node,
  parameterCarrier: TargetTypeRef,
  mode: import("../rust-facts/keys.js").RustArgumentMode,
): void {
  walk.context.facts.set(parameter, rustSourceParameterAbiFactKey, { parameterCarrier, mode }, [
    { message: "rust finalized source parameter ABI" },
  ]);
}

// Formal source-use rule: a write records a mutation fact on the resolved
// declaration of the written binding (or a mut-ref self mode on the enclosing
// method for `this` field writes). Backend mutability reads facts only.
function recordBindingWrite(walk: RustFactWalk, target: Node | undefined, writeKind: "binding" | "referent" = "binding"): void {
  if (target === undefined) {
    return;
  }
  const { ast } = walk.context;
  const kind = ast.kindName(target);
  if (kind === KindPropertyAccessExpression || kind === KindElementAccessExpression) {
    const receiver = Node_Expression(walk.context.ast, target);
    const receiverKind = receiver === undefined ? "" : ast.kindName(receiver);
    if (receiverKind === "KindThisExpression" || receiverKind === "KindThisKeyword") {
      if (walk.currentMethodDeclaration !== undefined) {
        walk.context.facts.set(walk.currentMethodDeclaration, rustSelfModeFactKey, { mode: "mut-ref" }, [
          { message: "rust self write" },
        ]);
      }
      return;
    }
    recordBindingWrite(walk, receiver, "referent");
    return;
  }
  if (kind === KindCallExpression) {
    const fact = walk.context.facts.get(target, rustTargetOperationFactKey);
    if (fact !== undefined && fact.kind === "flow-marker") {
      recordBindingWrite(walk, ast.arguments(target)[0], "referent");
    }
    return;
  }
  if (kind !== KindIdentifier) {
    return;
  }
  const declaration = walk.context.source.navigation.sourceReferenceFor(target)?.declaration;
  if (declaration !== undefined) {
    const key = writeKind === "binding" ? rustMutatedBindingFactKey : rustMutatedReferentFactKey;
    walk.context.facts.set(declaration, key, { mutated: true }, [
      { message: `rust ${writeKind} write` },
    ]);
  }
}

// --- Source-core flow markers ----------------------------------------------

interface FlowMarkerResolution {
  readonly carrier: TargetTypeRef | undefined;
}

// The generic source-semantics extension records flowStateFactKey on neutral
// sharedBorrow/mutableBorrow/move operations (including exact Rust aliases).
// This target converts those source facts into Rust-owned operation facts.
// Flow operations erase at emission because the consuming position's finalized
// Rust argument mode owns the passing shape. Non-flow source markers are
// rejected by the checked source-call operation provider, which is the sole
// owner of marker legality.
function tryFlowMarkerCall(
  walk: RustFactWalk,
  expression: Node,
  callArguments: readonly (Node | undefined)[],
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): FlowMarkerResolution | undefined {
  const facts = walk.context.facts;
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

function validateFlowMarkerAgainstMode(
  walk: RustFactWalk,
  argument: Node,
  mode: "value" | "ref" | "mut-ref",
): void {
  const flow = walk.context.facts.resolve(argument, flowStateFactKey) ??
    walk.context.facts.get(argument, flowStateFactKey);
  const rustFact = walk.context.facts.get(argument, rustTargetOperationFactKey);
  const markerState = rustFact !== undefined && rustFact.kind === "flow-marker" ? rustFact.state : flow?.state;
  if (markerState === undefined) {
    return;
  }
  const compatible =
    (markerState === "moved" && mode === "value") ||
    (markerState === "borrowed-shared" && mode === "ref") ||
    (markerState === "borrowed-mut" && mode === "mut-ref");
  if (!compatible) {
    appendRustDiagnostic(
      walk,
      "RUST_FLOW_MARKER_MISMATCH",
      `Flow marker state '${markerState}' does not match the finalized argument mode '${mode}' for this position.`,
      argument,
      ["target.capability=rust.source.flow-marker"],
    );
  }
}

// --- Error model -------------------------------------------------------------

// Fallibility: a declaration lowers to TsonicResult when it throws or calls a
// fallible operation outside a try boundary. Computed to a fixpoint over all
// project declarations after operation facts are closed.
function rustOperationIsFallible(fact: RustTargetOperationFact | undefined): boolean {
  if (fact === undefined) {
    return false;
  }
  if (fact.kind === "regexp-create") {
    return true;
  }
  if (fact.kind === "source-conversion") {
    return rustValueConversionIsFallible(fact.conversion);
  }
  if (fact.kind === "provider-operation" || fact.kind === "runtime-set") {
    return rustOperationAbiInvocationIsFallible(fact.abi);
  }
  return false;
}

function rustOperationAbiInvocationIsFallible(abi: RustFinalizedOperationAbi): boolean {
  if (abi.effects.invocation === "fallible" ||
    (abi.targetReceiver.kind === "input" && abi.targetReceiver.input.conversion.fallible) ||
    abi.targetArguments.some((input) =>
      isRustFinalizedSourceInput(input)
        ? input.conversion.fallible
        : isRustFinalizedSliceInput(input) && input.elements.some((element) => element.conversion.fallible))) {
    return true;
  }
  return abi.result.kind === "sync" && abi.result.conversion.fallible;
}

function rustOperationAbiAwaitIsFallible(abi: RustFinalizedOperationAbi): boolean {
  return abi.result.kind === "async" &&
    (abi.effects.awaiting === "fallible" || abi.result.awaitedConversion.fallible);
}

function recordFallibilityFacts(walk: RustFactWalk, projectSourceFiles: readonly SourceFile[]): void {
  const { ast } = walk.context;
  const declarations: Node[] = [];
  for (const sourceFile of projectSourceFiles) {
    for (const statement of ast.statements(sourceFile) as readonly Node[]) {
      const kind = ast.kindName(statement);
      if (kind === KindFunctionDeclaration) {
        declarations.push(statement);
      } else if (kind === "KindClassDeclaration") {
        const members = requireDenseSourceNodes(walk, ast.members(statement), "Class declaration contains an undefined or non-data member slot.");
        if (members === undefined) {
          return;
        }
        for (const member of members) {
          if (ast.kindName(member) === "KindMethodDeclaration" || ast.kindName(member) === "KindConstructor") {
            declarations.push(member);
          }
        }
      }
    }
  }
  const fallible = new Set<Node>();
  const selectedProjectDeclaration = (node: Node): Node | undefined => {
    const selected = walk.context.facts.get(node, rustSelectedCallKey) ??
      walk.context.facts.resolve(node, rustSelectedCallKey);
    const declaration = asSourceNode(
      selected?.sourceDeclaration,
      walk.context.ast,
    );
    return declaration !== undefined && selectedDeclarationIsProjectSource(walk, declaration)
      ? declaration
      : undefined;
  };
  const operationIsFallible = (node: Node): boolean => {
    const fact = walk.context.facts.get(node, rustTargetOperationFactKey) ??
      walk.context.facts.resolve(node, rustTargetOperationFactKey);
    return rustOperationIsFallible(fact);
  };

  const expressionRegionIsFallible = (root: Node): boolean => {
    let found = false;
    const visit = (node: Node, insideTry: boolean): void => {
      if (found) {
        return;
      }
      const kind = ast.kindName(node);
      if (kind === "KindThrowStatement" && !insideTry) {
        found = true;
        return;
      }
      if (kind === "KindArrowFunction") {
        // Closures are fallibility boundaries: errors cannot propagate out.
        return;
      }
      if (kind === "KindRegularExpressionLiteral" && !insideTry) {
        // Constant RegExp construction is fallible at runtime.
        found = true;
        return;
      }
      if (kind === "KindTryStatement") {
        const tryBlock = TryStatement_TryBlock(walk.context.ast, node);
        const catchBlock = CatchClause_Block(walk.context.ast, TryStatement_CatchClause(walk.context.ast, node));
        if (tryBlock !== undefined) {
          visit(tryBlock, true);
        }
        if (catchBlock !== undefined) {
          visit(catchBlock, insideTry);
        }
        return;
      }
      if (!insideTry && operationIsFallible(node)) {
        found = true;
        return;
      }
      if (!insideTry && kind === "KindAwaitExpression") {
        const operand = Node_Expression(walk.context.ast, node);
        const operandFact = operand === undefined
          ? undefined
          : walk.context.facts.get(operand, rustTargetOperationFactKey) ??
            walk.context.facts.resolve(operand, rustTargetOperationFactKey);
        const selectedDeclaration = operand === undefined ? undefined : selectedProjectDeclaration(operand);
        const selectedAsync = selectedDeclaration !== undefined &&
          walk.context.facts.get(selectedDeclaration, rustAsyncFunctionFactKey) !== undefined;
        if ((operandFact?.kind === "provider-operation" && rustOperationAbiAwaitIsFallible(operandFact.abi)) ||
          (operandFact?.kind === "source-call" && selectedDeclaration !== undefined &&
            selectedAsync && fallible.has(selectedDeclaration))) {
          found = true;
          return;
        }
      }
      if (!insideTry && (kind === KindCallExpression || kind === KindNewExpression)) {
        const target = selectedProjectDeclaration(node);
        if (target !== undefined && fallible.has(target) &&
          walk.context.facts.get(target, rustAsyncFunctionFactKey) === undefined) {
          found = true;
          return;
        }
      }
      ast.forEachChild(node, (child) => {
        if (child !== undefined) {
          visit(child, insideTry);
        }
      });
    };
    visit(root, false);
    return found;
  };
  const bodyIsFallible = (declaration: Node): boolean => {
    const body = ast.body(declaration);
    return body !== undefined && expressionRegionIsFallible(body);
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      if (!fallible.has(declaration) && bodyIsFallible(declaration)) {
        fallible.add(declaration);
        changed = true;
      }
    }
  }
  for (const declaration of fallible) {
    walk.context.facts.set(declaration, rustFallibleFactKey, { fallible: true }, [
      { message: "rust fallible declaration" },
    ]);
  }
  for (const sourceFile of projectSourceFiles) {
    const visit = (node: Node): void => {
      const kind = ast.kindName(node);
      if (kind === "KindArrowFunction") {
        const operation = walk.context.facts.get(node, rustTargetOperationFactKey) ??
          walk.context.facts.resolve(node, rustTargetOperationFactKey);
        const body = ast.body(node);
        if (operation?.kind === "closure" && body !== undefined && expressionRegionIsFallible(body)) {
          appendRustDiagnostic(
            walk,
            "RUST_FALLIBLE_CLOSURE_UNSUPPORTED",
            "Rust closures cannot contain fallible operations because the selected target callback ABI has an infallible result.",
            node,
            ["target.capability=rust.closure.infallible-result"],
          );
        }
      } else if (kind === KindCallExpression || kind === KindNewExpression) {
        const declaration = selectedProjectDeclaration(node);
        const operation = walk.context.facts.get(node, rustTargetOperationFactKey) ??
          walk.context.facts.resolve(node, rustTargetOperationFactKey);
        if (declaration !== undefined && operation?.kind === "source-call") {
          const isAsync = walk.context.facts.get(declaration, rustAsyncFunctionFactKey) !== undefined;
          const isFallible = fallible.has(declaration);
          walk.context.facts.set(node, rustSourceCallEffectsFactKey, {
            invocation: isFallible && !isAsync ? "fallible" : "infallible",
            awaiting: isAsync
              ? isFallible ? "fallible" : "infallible"
              : "not-applicable",
          }, [{ message: "rust finalized selected project-source call effects" }]);
        }
      }
      ast.forEachChild(node, (child) => {
        if (child !== undefined) {
          visit(child);
        }
      });
    };
    visit(sourceFile);
  }
}

// `throw new Error(message)` records a throw fact; anything else stays an
// unsupported statement for the backend.
function recordThrowFacts(walk: RustFactWalk, statement: Node, sourceFile: SourceFile): void {
  const { ast } = walk.context;
  const expression = Node_Expression(walk.context.ast, statement);
  if (expression === undefined || ast.kindName(expression) !== KindNewExpression) {
    return;
  }
  resolveExpressionCarrier(walk, expression, sourceFile, undefined);
  const constructor = walk.context.facts.get(expression, rustTargetOperationFactKey) ??
    walk.context.facts.resolve(expression, rustTargetOperationFactKey);
  if (constructor?.kind !== "provider-operation" || constructor.operationId !== "tsonic.rust.error.constructor") {
    return;
  }
  const [message] = ast.arguments(expression);
  if (message !== undefined) {
    resolveExpressionCarrier(walk, message, sourceFile, rustStringTargetType());
  }
  setRustOperationFact(walk, statement, {
    kind: "throw-op",
    operationId: "tsonic.rust.error.throw",
    constructorOperationId: constructor.operationId,
  });
}

// Arrow-function arguments lower to Rust closures when the expectation is a
// finalized function-pointer carrier. Expression bodies only.
function resolveArrowFunctionCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const { ast } = walk.context;
  if (expected?.kind !== "function-pointer") {
    return undefined;
  }
  const parameters = ast.parameters(expression);
  if (parameters.length !== expected.args.length) {
    return undefined;
  }
  const byRefCopyParams: boolean[] = [];
  for (const [index, parameter] of parameters.entries()) {
    if (parameter === undefined) {
      return undefined;
    }
    const argCarrier = expected.args[index];
    if (argCarrier === undefined || (argCarrier.kind === "opaque" && argCarrier.id === "tsonic.rust.infer")) {
      return undefined;
    }
    setCarrierFact(walk, parameter, argCarrier);
    // Slice-based dense helpers hand elements by reference: primitive
    // elements bind with |&x| copy patterns; accumulators pass by value.
    byRefCopyParams.push(index === parameters.length - 1 && argCarrier.kind === "source-primitive");
  }
  const body = ast.body(expression);
  if (body === undefined || ast.kindName(body) === KindBlock) {
    return undefined;
  }
  const resultExpectation = expected.result.kind === "opaque" && expected.result.id === "tsonic.rust.infer"
    ? undefined
    : expected.result;
  const bodyCarrier = resolveExpressionCarrier(walk, body, sourceFile, resultExpectation);
  if (bodyCarrier === undefined) {
    return undefined;
  }
  const closureCarrier: TargetTypeRef = {
    kind: "function-pointer",
    args: expected.args,
    result: bodyCarrier,
  };
  setRustOperationFact(walk, expression, {
    kind: "closure",
    operationId: "tsonic.rust.closure",
    byRefCopyParams,
    resultCarrier: closureCarrier,
  });
  return setCarrierFact(walk, expression, closureCarrier);
}

// --- RegExp constant lane ----------------------------------------------------

// Compile-time mirror of the runtime RegExp parser contract: a faithful
// TypeScript port of `rust-js/crates/tsonic_rust_js/src/regexp/parser.rs`
// (`parse_flags` + `parse_pattern`). The returned violation string is the
// engine's exact construction-time error message, and the acceptance
// decision is held equal to the engine by the shared corpus at
// `rust-js/tests/oracle/regexp-acceptance-corpus.json`.

// Mirrors `MAX_QUANTIFIER_BOUND` in parser.rs.
const rustRegExpMaxQuantifierBound = 1000;
// Mirrors `MAX_CLASS_RANGE_HIGH` in parser.rs.
const rustRegExpMaxClassRangeHigh = 0xd7ff;

// Mirrors `code_unit_sensitivity_error` in parser.rs.
function rustRegExpCodeUnitMessage(construct: string): string {
  return `${construct} is not supported: dot, negated classes, and surrogate-range classes are outside the oracle-proven subset (they require UTF-16 code-unit matching semantics)`;
}

// Internal sentinel carrying the engine's rejection message out of the
// recursive-descent walk.
class RustRegExpViolation {
  constructor(readonly violation: string) {}
}

type RustRegExpAtom = "anchor" | "astral-char" | "other";
type RustRegExpClassMember = { readonly kind: "char"; readonly value: number } | { readonly kind: "item" };

function isAsciiDigitChar(unit: string): boolean {
  return unit >= "0" && unit <= "9";
}

function isAsciiAlphanumericCode(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

export function rustRegExpSubsetViolation(pattern: string, flags: string): string | undefined {
  // parse_flags: only i/g/m, each at most once.
  const seen = new Set<string>();
  for (const flag of flags) {
    if (flag !== "i" && flag !== "g" && flag !== "m") {
      return `RegExp flag \`${flag}\` is not supported`;
    }
    if (seen.has(flag)) {
      return `duplicate RegExp flag \`${flag}\``;
    }
    seen.add(flag);
  }

  // The runtime parser walks Unicode scalar values; a Rust string can never
  // hold a lone surrogate, so a pattern containing one is unrepresentable at
  // runtime and fails closed here.
  const chars = [...pattern];
  for (const unit of chars) {
    const code = unit.codePointAt(0) ?? 0;
    if (code >= 0xd800 && code <= 0xdfff) {
      return "pattern contains a lone surrogate code unit";
    }
  }

  let pos = 0;
  const peek = (offset = 0): string | undefined => chars[pos + offset];
  const bump = (): string | undefined => {
    const next = peek();
    if (next !== undefined) {
      pos += 1;
    }
    return next;
  };
  const eat = (expected: string): boolean => {
    if (peek() === expected) {
      pos += 1;
      return true;
    }
    return false;
  };
  const reject = (violation: string): never => {
    throw new RustRegExpViolation(violation);
  };

  // Mirrors `Parser::parse_bound`: reads a decimal bound, rejecting the
  // moment it exceeds the cap; `undefined` means no digits were present.
  const parseBound = (): number | undefined => {
    let digits = 0;
    let value = 0;
    for (let next = peek(); next !== undefined && isAsciiDigitChar(next); next = peek()) {
      pos += 1;
      digits += 1;
      value = value * 10 + (next.codePointAt(0) ?? 0) - 0x30;
      if (value > rustRegExpMaxQuantifierBound) {
        reject(`quantifier bound exceeds the supported limit of ${rustRegExpMaxQuantifierBound}`);
      }
    }
    return digits === 0 ? undefined : value;
  };

  // Mirrors `Parser::parse_braced_quantifier`: `true` when the braces form a
  // well-formed `{n}`/`{n,}`/`{n,m}` quantifier, `false` when they do not
  // (the caller then reports the bare-`{` rejection).
  const parseBracedQuantifier = (): boolean => {
    const start = pos;
    pos += 1; // consume `{`
    const min = parseBound();
    if (min === undefined) {
      pos = start;
      return false;
    }
    let max: number | undefined;
    if (eat(",")) {
      if (peek() === "}") {
        max = undefined;
      } else {
        max = parseBound();
        if (max === undefined) {
          pos = start;
          return false;
        }
      }
    } else {
      max = min;
    }
    if (!eat("}")) {
      pos = start;
      return false;
    }
    if (max !== undefined && min > max) {
      reject("numbers out of order in `{n,m}` quantifier");
    }
    return true;
  };

  // Mirrors `Parser::parse_quantifier`: `true` when a quantifier was
  // consumed; a trailing `?` (lazy) always rejects.
  const parseQuantifier = (): boolean => {
    let label: string;
    switch (peek()) {
      case "*":
        pos += 1;
        label = "*?";
        break;
      case "+":
        pos += 1;
        label = "+?";
        break;
      case "?":
        pos += 1;
        label = "??";
        break;
      case "{":
        if (!parseBracedQuantifier()) {
          reject("bare `{` is not supported in RegExp pattern");
        }
        label = "{n,m}?";
        break;
      default:
        return false;
    }
    if (peek() === "?") {
      reject(`lazy quantifier \`${label}\` is not supported`);
    }
    return true;
  };

  // Mirrors `Parser::parse_hex_escape`.
  const parseHexEscape = (digits: number): number => {
    let value = 0;
    for (let remaining = 0; remaining < digits; remaining += 1) {
      const next = bump();
      const digit = next === undefined ? Number.NaN : Number.parseInt(next, 16);
      if (next === undefined || !/^[0-9a-fA-F]$/u.test(next) || Number.isNaN(digit)) {
        reject("malformed hex escape in RegExp pattern");
      }
      value = value * 16 + digit;
    }
    if (value >= 0xd800 && value <= 0xdfff) {
      reject("hex escape resolving to a lone surrogate is not supported");
    }
    return value;
  };

  // Mirrors `Parser::finish_common_escape`: escapes valid both inside and
  // outside classes, resolved to their code point.
  const finishCommonEscape = (escaped: string): number => {
    switch (escaped) {
      case "n":
        return 0x0a;
      case "r":
        return 0x0d;
      case "t":
        return 0x09;
      case "f":
        return 0x0c;
      case "v":
        return 0x0b;
      case "0": {
        const next = peek();
        if (next !== undefined && isAsciiDigitChar(next)) {
          reject("legacy octal escape (`\\0` followed by a digit) is not supported");
        }
        return 0;
      }
      case "x":
        return parseHexEscape(2);
      case "u":
        if (peek() === "{") {
          reject("`\\u{...}` escape requires the unsupported `u` flag");
        }
        return parseHexEscape(4);
      default: {
        const code = escaped.codePointAt(0) ?? 0;
        if (!isAsciiAlphanumericCode(code)) {
          return code;
        }
        return reject(`unrecognized escape \`\\${escaped}\` in RegExp pattern`);
      }
    }
  };

  // Mirrors `Parser::parse_escape_atom`.
  const parseEscapeAtom = (): RustRegExpAtom => {
    const escaped = bump();
    if (escaped === undefined) {
      return reject("pattern ends with a trailing `\\`");
    }
    switch (escaped) {
      case "d":
      case "w":
      case "s":
        return "other";
      case "D":
      case "W":
      case "S":
        return reject(rustRegExpCodeUnitMessage(`negated class escape \`\\${escaped}\``));
      case "b":
      case "B":
        return reject(`word-boundary assertion \`\\${escaped}\` is not supported`);
      case "p":
      case "P":
        return reject(`unicode property escape \`\\${escaped}\` is not supported`);
      case "k":
        return reject("named backreference `\\k` is not supported");
      case "c":
        return reject("control escape `\\c` is not supported");
      default:
        if (escaped >= "1" && escaped <= "9") {
          return reject(`backreference \`\\${escaped}\` is not supported`);
        }
        return finishCommonEscape(escaped) > 0xffff ? "astral-char" : "other";
    }
  };

  // Mirrors `Parser::parse_class_member`.
  const parseClassMember = (): RustRegExpClassMember => {
    const next = bump();
    if (next === undefined) {
      return reject("unterminated character class: missing `]`");
    }
    if (next !== "\\") {
      return { kind: "char", value: next.codePointAt(0) ?? 0 };
    }
    const escaped = bump();
    if (escaped === undefined) {
      return reject("pattern ends with a trailing `\\`");
    }
    switch (escaped) {
      case "d":
      case "w":
      case "s":
        return { kind: "item" };
      case "D":
      case "W":
      case "S":
        return reject(rustRegExpCodeUnitMessage(`negated class escape \`\\${escaped}\``));
      case "b":
        return { kind: "char", value: 0x08 };
      case "p":
      case "P":
        return reject(`unicode property escape \`\\${escaped}\` is not supported`);
      case "c":
        return reject("control escape `\\c` is not supported");
      default:
        if (escaped >= "1" && escaped <= "9") {
          return reject(`octal escape \`\\${escaped}\` in character class is not supported`);
        }
        return { kind: "char", value: finishCommonEscape(escaped) };
    }
  };

  // Mirrors `Parser::parse_class`.
  const parseClass = (): void => {
    if (peek() === "^") {
      reject(rustRegExpCodeUnitMessage("negated character class `[^`"));
    }
    for (;;) {
      const next = peek();
      if (next === undefined) {
        reject("unterminated character class: missing `]`");
      }
      if (next === "]") {
        pos += 1;
        return;
      }
      const first = parseClassMember();
      const rangeFollows = peek() === "-" && peek(1) !== undefined && peek(1) !== "]";
      if (rangeFollows) {
        pos += 1; // consume `-`
        if (peek() === undefined) {
          reject("unterminated character class: missing `]`");
        }
        const second = parseClassMember();
        if (first.kind === "char" && second.kind === "char") {
          if (first.value > second.value) {
            reject("character class range out of order");
          }
          if (second.value > rustRegExpMaxClassRangeHigh) {
            reject(rustRegExpCodeUnitMessage("character class range reaching beyond U+D7FF"));
          }
        } else {
          reject("character class range bounded by a class escape is not supported");
        }
      } else if (first.kind === "char" && first.value > 0xffff) {
        reject(rustRegExpCodeUnitMessage("astral character in character class"));
      }
    }
  };

  // Mirrors `Parser::parse_atom`.
  const parseAtom = (): RustRegExpAtom => {
    const next = bump();
    if (next === undefined) {
      return reject("pattern ends unexpectedly");
    }
    switch (next) {
      case "^":
      case "$":
        return "anchor";
      case ".":
        return reject(rustRegExpCodeUnitMessage("`.`"));
      case "(":
        parseGroup();
        return "other";
      case "[":
        parseClass();
        return "other";
      case "\\":
        return parseEscapeAtom();
      case "*":
      case "+":
      case "?":
        return reject(`quantifier \`${next}\` has nothing to repeat`);
      case "{":
        return reject("bare `{` is not supported in RegExp pattern");
      case "}":
        return reject("bare `}` is not supported in RegExp pattern");
      default:
        return (next.codePointAt(0) ?? 0) > 0xffff ? "astral-char" : "other";
    }
  };

  // Mirrors `Parser::parse_group`.
  const parseGroup = (): void => {
    if (eat("?")) {
      switch (peek()) {
        case ":":
          pos += 1;
          break;
        case "=":
          reject("lookahead `(?=` is not supported");
          break;
        case "!":
          reject("negative lookahead `(?!` is not supported");
          break;
        case "<":
          if (peek(1) === "=") {
            reject("lookbehind `(?<=` is not supported");
          }
          if (peek(1) === "!") {
            reject("negative lookbehind `(?<!` is not supported");
          }
          reject("named capture group `(?<name>` is not supported");
          break;
        default:
          reject("unrecognized group modifier after `(?`");
      }
    }
    parseAlternation();
    if (!eat(")")) {
      reject("unterminated group: missing `)`");
    }
  };

  // Mirrors `Parser::parse_term`.
  const parseTerm = (): void => {
    const atom = parseAtom();
    if (!parseQuantifier()) {
      return;
    }
    if (atom === "anchor") {
      reject("quantifier on `^`/`$` anchor is not supported");
    }
    if (atom === "astral-char") {
      reject(rustRegExpCodeUnitMessage("quantifier on an astral literal"));
    }
  };

  // Mirrors `Parser::parse_concat`.
  const parseConcat = (): void => {
    for (let next = peek(); next !== undefined && next !== "|" && next !== ")"; next = peek()) {
      parseTerm();
    }
  };

  // Mirrors `Parser::parse_alternation`.
  const parseAlternation = (): void => {
    parseConcat();
    while (eat("|")) {
      parseConcat();
    }
  };

  try {
    parseAlternation();
    if (pos < chars.length) {
      reject("unmatched `)` in RegExp pattern");
    }
  } catch (error) {
    if (error instanceof RustRegExpViolation) {
      return error.violation;
    }
    throw error;
  }
  return undefined;
}

function appendRegExpDiagnostic(walk: RustFactWalk, expression: Node, violation: string): void {
  appendRustDiagnostic(
    walk,
    "RUST_REGEXP_UNSUPPORTED",
    `RegExp construct outside the oracle-proven subset: ${violation}.`,
    expression,
    ["target.capability=rust.js.regexp"],
  );
}

export function resolveRegExpCreation(
  walk: RustFactWalk,
  expression: Node,
  pattern: string,
  flags: string,
): TargetTypeRef | undefined {
  if (!walk.jsEnabled) {
    return undefined;
  }
  const violation = rustRegExpSubsetViolation(pattern, flags);
  if (violation !== undefined) {
    appendRegExpDiagnostic(walk, expression, violation);
    return undefined;
  }
  setRustOperationFact(walk, expression, {
    kind: "regexp-create",
    operationId: "tsonic.rust.js.regexp.create",
    pattern,
    flags,
  });
  return setCarrierFact(walk, expression, { kind: "target-named", id: "rust.js.JsRegExp" });
}
