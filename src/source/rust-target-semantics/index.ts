import {
  ExtensionLifecycleEvent,
  argumentPassingFactKey,
  flowStateFactKey,
  functionPointerFactKey,
  pointerFactKey,
  runtimeCarrierFactKey,
  selectedTargetSignatureFactKey,
  targetOperationFactKey,
} from "@tsonic/tsts";
import type {
  CompilerExtension,
  ExtensionLifecycleContext,
  Node,
  SourceFile,
  SourceFileBoundLifecycleRequest,
  SelectedTargetSignatureFact,
  TargetMember,
  TargetTypeRef,
} from "@tsonic/tsts";
import { tsonicCoreSourceExtensionId } from "@tsonic/source-core";
import { createLazyTargetSourceAnalysis } from "@tsonic/target-api";
import type { TargetLazySourceAnalysis, TargetProviderContext } from "@tsonic/target-api";
import { isDenseDataArray } from "../../common/closed-metadata.js";
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
  TypeReferenceNode_TypeName,
  KindBinaryExpression,
  KindBlock,
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
  KindNewExpression,
  KindNumericLiteral,
  KindOmittedExpression,
  KindParameter,
  KindParenthesizedExpression,
  KindPostfixUnaryExpression,
  KindPrefixUnaryExpression,
  KindPropertyAccessExpression,
  KindReturnStatement,
  KindStringLiteral,
  KindTypeReference,
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
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
  inferRustTargetTypeParameterBindings,
  substituteRustTargetTypeParameters,
  rustTargetTypeRefEquals,
  rustVecTargetType,
} from "../rust-target-types.js";
import { rustAsyncFunctionFactKey, rustExtensionId, rustFallibleFactKey, rustMutatedBindingFactKey, rustMutatedReferentFactKey, rustOptionWrapFactKey, rustPostCheckBinaryOperationId, rustPostCheckOperationKind, rustPostCheckUnaryMinusOperationId, rustPostCheckUnaryPlusOperationId, rustSelfModeFactKey, rustSourceBindingFactKey, rustSourceCallEffectsFactKey, rustSourceParameterAbiFactKey, rustSourceTypeCarrierValue, rustTargetOperationFactKey, rustTargetOperationResultCarrier, rustUnionVariantsFactKey } from "../rust-facts/keys.js";
import type { RustTargetOperationFact } from "../rust-facts/keys.js";
import { rustValueConversionIsFallible } from "../rust-facts/value-conversions.js";
import {
  isRustFinalizedSliceInput,
  isRustFinalizedSourceInput,
} from "../rust-facts/finalized-operation-abi.js";
import type { RustFinalizedOperationAbi } from "../rust-facts/finalized-operation-abi.js";
import { collectRustProviderSemantics } from "../provider-packages/index.js";
import type { RustProviderOperationRow } from "../provider-packages/index.js";
import { isRustAssignmentOperator, rustOperatorCarrierKey, selectRustBinaryOperator, selectRustCompoundAssignment } from "./operator-rules.js";
import { readRustTypescriptCompatibilityMode } from "../../options/rust-target-options.js";
import { createRustOperationsProvider } from "./operations-provider.js";
import { resolveRustTargetTypeRef } from "./target-type-resolution.js";
import { createRustSourceTypeRegistry } from "./source-type-registry.js";
import type { RustSourceTypeRegistry } from "./source-type-registry.js";
import { createRustSourceProfileRegistry } from "./source-profile-registry.js";
import type { RustSourceProfileRegistry } from "./source-profile-registry.js";
import { selectedSourceLiteralIsRepresentable } from "./selected-numeric-literal.js";
import {
  createRustSourceCallableAbiResolver,
} from "./source-callable-abi.js";
import type { RustSourceCallableAbiResolver } from "./source-callable-abi.js";

export const rustTargetSemanticsExtensionId = "tsonic.rust.target-semantics";

export function createRustTargetSemanticsExtension(context: TargetProviderContext): CompilerExtension {
  const providerSemantics = collectRustProviderSemantics(context.selectedCapabilities, context);
  const providerRows = providerSemantics.operations;
  const jsEnabled = context.selectedSurfaces.some((surface) => surface.id === "js") ||
    readRustTypescriptCompatibilityMode(context.target) === "compat";
  const sourceTypes = createRustSourceTypeRegistry();
  const sourceProfiles = createRustSourceProfileRegistry();
  const sourceCallableAbi = createRustSourceCallableAbiResolver();
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
      extensionContext.registerTargetSemanticProvider(createRustOperationsProvider({
        providerRows,
        providerCarrierPaths: providerSemantics.carrierPaths,
        jsEnabled,
        regExpSubsetViolation: rustRegExpSubsetViolation,
        sourceProfiles,
        sourceTypes,
        sourceCallableAbi,
      }));
      extensionContext.registerLifecycleHook(
        ExtensionLifecycleEvent.afterSourceFileBound,
        (request: SourceFileBoundLifecycleRequest, lifecycleContext) => {
          const sourceFile = request.sourceFile as SourceFile;
          sourceTypes.registerSourceFile(sourceFile, lifecycleContext.compiler.ast);
          sourceProfiles.registerSourceFile(sourceFile, lifecycleContext.compiler.ast, jsEnabled);
        },
      );
      extensionContext.registerLifecycleHook(
        ExtensionLifecycleEvent.beforeSemanticsFinalized,
        (_request, lifecycleContext) => {
          recordRustFactsBeforeFinalization(
            lifecycleContext,
            providerRows,
            jsEnabled,
            sourceProfiles,
            sourceTypes,
            providerSemantics.carrierPaths,
            sourceCallableAbi,
          );
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
  readonly sourceProfiles: RustSourceProfileRegistry;
  readonly sourceTypes: RustSourceTypeRegistry;
  readonly providerCarrierPaths: ReadonlyMap<string, string>;
  readonly analysis: TargetLazySourceAnalysis;
  readonly sourceCallableAbi: RustSourceCallableAbiResolver;
  currentThisCarrier?: TargetTypeRef;
  currentMethodDeclaration?: Node;
  currentCallableDeclaration?: Node;
}

const boolCarrier = rustSourcePrimitiveTargetType("bool");

export function recordRustFactsBeforeFinalization(
  lifecycle: ExtensionLifecycleContext,
  providerRows: readonly RustProviderOperationRow[],
  jsEnabled = false,
  sourceProfiles = createRustSourceProfileRegistry(),
  sourceTypes = createRustSourceTypeRegistry(),
  providerCarrierPaths: ReadonlyMap<string, string> = new Map(),
  sourceCallableAbi: RustSourceCallableAbiResolver = createRustSourceCallableAbiResolver(),
): void {
  const { ast } = lifecycle.compiler;
  const rawSourceFiles = lifecycle.compiler.getSourceFiles();
  if (!isDenseDataArray(rawSourceFiles) || rawSourceFiles.some((sourceFile) => sourceFile === undefined)) {
    appendMalformedSourceAstDiagnostic(lifecycle, "Compiler source file collection contains an undefined or non-data slot.");
    return;
  }
  const compilerSourceFiles = rawSourceFiles as readonly SourceFile[];
  const projectSourceFiles = compilerSourceFiles
    .filter((sourceFile) => !ast.getFileName(sourceFile).endsWith(".d.ts"))
    .sort((left, right) => ast.getFileName(left).localeCompare(ast.getFileName(right)));
  for (const sourceFile of projectSourceFiles) {
    const statements = ast.statements(sourceFile);
    if (!isDenseDataArray(statements) || statements.some((statement) => statement === undefined)) {
      appendMalformedSourceAstDiagnostic(lifecycle, "Project source file contains an undefined or non-data top-level statement slot.");
      return;
    }
  }
  const walk: RustFactWalk = {
    lifecycle,
    providerRows,
    resolving: new Set(),
    jsEnabled,
    sourceProfiles,
    sourceTypes,
    providerCarrierPaths,
    analysis: createLazyTargetSourceAnalysis(ast, lifecycle.compiler.checker, projectSourceFiles),
    sourceCallableAbi,
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
  recordUnfinalizedCheckedOperations(walk, projectSourceFiles);
  // Fallibility depends on finalized operation facts produced while walking
  // bodies. Compute the declaration fixpoint only after those facts exist.
  recordFallibilityFacts(walk, projectSourceFiles);
}

function recordUnfinalizedCheckedOperations(
  walk: RustFactWalk,
  sourceFiles: readonly SourceFile[],
): void {
  const { ast } = walk.lifecycle.compiler;
  for (const sourceFile of sourceFiles) {
    const visit = (node: Node): void => {
      const selected = walk.lifecycle.host.facts.get(node, targetOperationFactKey) ??
        walk.lifecycle.host.factResolver.resolve(node, targetOperationFactKey);
      const finalized = walk.lifecycle.host.facts.get(node, rustTargetOperationFactKey) ??
        walk.lifecycle.host.factResolver.resolve(node, rustTargetOperationFactKey);
      if (selected !== undefined && rustPostCheckOperationKind(selected.operationId) !== undefined && finalized === undefined) {
        const operatorToken = ast.kindName(node) === KindBinaryExpression
          ? BinaryExpression_OperatorToken(node)
          : undefined;
        const pendingKind = rustPostCheckOperationKind(selected.operationId);
        const operatorKind = operatorToken === undefined
          ? pendingKind === "unary-minus"
            ? "KindMinusToken"
            : pendingKind === "unary-plus"
              ? "KindPlusToken"
              : "unknown"
          : ast.kindName(operatorToken);
        walk.lifecycle.host.diagnostics.append({
          extensionId: rustTargetSemanticsExtensionId,
          extensionCode: "RUST_CHECKED_OPERATION_NOT_FINALIZED",
          numericCode: 0,
          category: "error",
          message: "Checked Rust operation has no finalized target fact after post-check carrier closure.",
          nodeOrSpan: node,
          identity: `${rustTargetSemanticsExtensionId}:unfinalized:${ast.getFileName(sourceFile)}:${ast.pos(node)}:${ast.end(node)}`,
          evidence: [
            { message: "target.capability=rust.operation.post-check-finalization" },
            { message: `source.operatorKind=${operatorKind}` },
          ],
        });
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

function promiseInnerCarrier(walk: RustFactWalk, typeNode: Node | undefined): TargetTypeRef | undefined {
  return rustFutureOutputCarrier(resolveTypeNodeCarrier(walk, typeNode));
}

function recordFunctionSignatureFacts(walk: RustFactWalk, declaration: Node): void {
  const { ast } = walk.lifecycle.compiler;
  if (ast.hasModifierKind(declaration, "async")) {
    const inner = promiseInnerCarrier(walk, Node_Type(declaration));
    if (inner !== undefined) {
      walk.lifecycle.host.facts.set(declaration, rustAsyncFunctionFactKey, { isAsync: true, outputCarrier: inner }, [
        { message: "rust async function" },
      ]);
    }
  }
  const parameters = requireDenseSourceNodes(walk, ast.parameters(declaration), "Function declaration contains an undefined or non-data parameter slot.");
  if (parameters === undefined) {
    return;
  }
  for (const parameter of parameters) {
    const parameterAbi = resolveParameterAbi(walk, parameter);
    if (parameterAbi !== undefined) {
      setCarrierFact(walk, parameter, parameterAbi.valueCarrier);
      setParameterAbiFact(walk, parameter, parameterAbi.parameterCarrier, parameterAbi.mode);
    }
  }
}

function recordFunctionBodyFacts(walk: RustFactWalk, declaration: Node, sourceFile: SourceFile): void {
  const { ast } = walk.lifecycle.compiler;
  const asyncFact = walk.lifecycle.host.facts.get(declaration, rustAsyncFunctionFactKey);
  const returnCarrier = asyncFact?.outputCarrier ?? resolveTypeNodeCarrier(walk, Node_Type(declaration));
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
      if (isRustAssignmentOperator(operatorKind)) {
        const left = BinaryExpression_Left(expression);
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
    const tryBlock = TryStatement_TryBlock(statement);
    if (tryBlock !== undefined) {
      recordStatementFacts(walk, tryBlock, sourceFile, returnCarrier);
    }
    const catchBlock = CatchClause_Block(TryStatement_CatchClause(statement));
    if (catchBlock !== undefined) {
      recordStatementFacts(walk, catchBlock, sourceFile, returnCarrier);
    }
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
    const body = IterationStatement_Statement(statement);
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
    const body = IterationStatement_Statement(statement);
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
  const facts = walk.lifecycle.host.facts;
  const existing = facts.get(typeNode, runtimeCarrierFactKey) ??
    walk.lifecycle.host.factResolver.resolve(typeNode, runtimeCarrierFactKey);
  if (existing !== undefined) {
    return existing.carrier;
  }
  if (facts.get(typeNode, pointerFactKey) !== undefined || facts.get(typeNode, functionPointerFactKey) !== undefined) {
    walk.lifecycle.host.diagnostics.append({
      extensionId: rustTargetSemanticsExtensionId,
      extensionCode: "RUST_SOURCE_MARKER_UNSUPPORTED",
      numericCode: 0,
      category: "error",
      message: "Pointer/FunctionPointer type markers have no Rust target lane yet; they require a separately approved unsafe-boundary contract.",
      evidence: [{ message: "target.capability=rust.source.type-marker" }],
    });
    return undefined;
  }
  const carrier = resolveRustTargetTypeRef(typeNode, {
    compiler: walk.lifecycle.compiler,
    factResolver: walk.lifecycle.host.factResolver,
  }, {
    providerRows: walk.providerRows,
    jsEnabled: walk.jsEnabled,
    sourceProfiles: walk.sourceProfiles,
    sourceTypes: walk.sourceTypes,
    providerCarrierPaths: walk.providerCarrierPaths,
  });
  return carrier === undefined ? undefined : setCarrierFact(walk, typeNode, carrier);
}

function resolveExpressionCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const facts = walk.lifecycle.host.facts;
  const existing = facts.get(expression, runtimeCarrierFactKey) ??
    walk.lifecycle.host.factResolver.resolve(expression, runtimeCarrierFactKey);
  if (existing !== undefined) {
    return existing.carrier;
  }
  const selectedOperation = facts.get(expression, targetOperationFactKey) ??
    walk.lifecycle.host.factResolver.resolve(expression, targetOperationFactKey);
  if (selectedOperation !== undefined) {
    const rustOperation = facts.get(expression, rustTargetOperationFactKey) ??
      walk.lifecycle.host.factResolver.resolve(expression, rustTargetOperationFactKey);
    const finalizedResult = rustOperation === undefined
      ? selectedOperation.resultType
      : rustTargetOperationResultCarrier(rustOperation) ?? selectedOperation.resultType;
    const expressionKind = walk.lifecycle.compiler.ast.kindName(expression);
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
        : setCarrierFact(walk, expression, finalizedResult);
    }
  }
  if (walk.resolving.has(expression)) {
    return undefined;
  }
  walk.resolving.add(expression);
  try {
    const resolved = resolveExpressionCarrierUncached(walk, expression, sourceFile, expected);
    return applyOptionLane(walk, expression, resolved, expected);
  } finally {
    walk.resolving.delete(expression);
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
  const existing = walk.lifecycle.host.facts.get(expression, rustTargetOperationFactKey);
  if (resolved !== undefined && isRustOptionCarrier(resolved)) {
    return resolved;
  }
  if (walk.lifecycle.compiler.ast.kindName(expression) === "KindNullKeyword" || isRustNullishSourceCarrier(resolved)) {
    if (existing === undefined) {
      setRustOperationFact(walk, expression, { kind: "option-none", operationId: "tsonic.rust.option.none" });
    }
    return expected;
  }
  if (resolved !== undefined && rustTargetTypeRefEquals(resolved, inner)) {
    if (existing === undefined || existing.kind === "operator-token" || existing.kind === "provider-operation" || existing.kind === "source-field" || existing.kind === "source-call") {
      walk.lifecycle.host.facts.set(expression, rustOptionWrapFactKey, { wrap: true }, [{ message: "rust option wrap" }]);
    }
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
  const kind = walk.lifecycle.compiler.ast.kindName(expression);
  switch (kind) {
    case KindNumericLiteral: {
      const effectiveExpected = expected !== undefined && isRustOptionCarrier(expected)
        ? rustOptionElementCarrier(expected)
        : expected;
      if (effectiveExpected !== undefined && isRustNumericCarrier(effectiveExpected)) {
        return setCarrierFact(walk, expression, effectiveExpected);
      }
      return undefined;
    }
    case KindStringLiteral: {
      if (expected !== undefined) {
        const value = rustSourceTypeCarrierValue(expected);
        if (value !== undefined && value.shape === "enum") {
          const literal = walk.lifecycle.compiler.ast.text(expression);
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
      const literalText = walk.lifecycle.compiler.ast.text(expression);
      const lastSlash = literalText.lastIndexOf("/");
      if (!literalText.startsWith("/") || lastSlash <= 0) {
        return undefined;
      }
      return resolveRegExpCreation(walk, expression, literalText.slice(1, lastSlash), literalText.slice(lastSlash + 1));
    }
    case "KindAwaitExpression": {
      const operand = Node_Expression(expression);
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
      const inner = Node_Expression(expression);
      const carrier = inner === undefined
        ? undefined
        : resolveExpressionCarrier(walk, inner, sourceFile, expected);
      return carrier === undefined ? undefined : setCarrierFact(walk, expression, carrier);
    }
    case "KindAsExpression":
    case "KindTypeAssertionExpression": {
      const inner = Node_Expression(expression);
      const constAssertion = isConstAssertionExpression(walk, expression);
      const defaultedExpected = expected === undefined && constAssertion &&
        inner !== undefined && walk.lifecycle.compiler.ast.kindName(inner) === KindNumericLiteral
        ? rustSourcePrimitiveTargetType("float64")
        : expected;
      const carrier = inner === undefined
        ? undefined
        : resolveExpressionCarrier(walk, inner, sourceFile, defaultedExpected);
      if (carrier !== undefined && constAssertion) {
        setRustOperationFact(walk, expression, {
          kind: "source-conversion",
          operationId: "tsonic.rust.source.const-assertion",
          resultCarrier: carrier,
        });
      }
      return carrier === undefined ? undefined : setCarrierFact(walk, expression, carrier);
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

function resolvePostCheckBinaryCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const selected = walk.lifecycle.host.facts.get(expression, targetOperationFactKey) ??
    walk.lifecycle.host.factResolver.resolve(expression, targetOperationFactKey);
  if (selected?.operationId !== rustPostCheckBinaryOperationId) {
    return undefined;
  }
  const leftNode = BinaryExpression_Left(expression);
  const rightNode = BinaryExpression_Right(expression);
  const operatorToken = BinaryExpression_OperatorToken(expression);
  if (leftNode === undefined || rightNode === undefined || operatorToken === undefined) {
    return undefined;
  }
  let left = resolveExpressionCarrier(walk, leftNode, sourceFile, expected);
  let right = resolveExpressionCarrier(walk, rightNode, sourceFile, left ?? expected);
  if (left === undefined && right !== undefined) {
    left = resolveExpressionCarrier(walk, leftNode, sourceFile, right);
  }
  if (right === undefined && left !== undefined) {
    right = resolveExpressionCarrier(walk, rightNode, sourceFile, left);
  }
  const operatorKind = walk.lifecycle.compiler.ast.kindName(operatorToken);
  const selectedLeftOperation = walk.lifecycle.host.facts.get(leftNode, targetOperationFactKey) ??
    walk.lifecycle.host.factResolver.resolve(leftNode, targetOperationFactKey);
  let fact: RustTargetOperationFact | undefined;
  if (operatorKind === KindEqualsToken && selectedLeftOperation === undefined &&
    left !== undefined && right !== undefined &&
    rustTargetTypeRefEquals(left, right)) {
    fact = {
      kind: "operator-token",
      operationId: `tsonic.rust.operator.=.${rustOperatorCarrierKey(right)}`,
      operator: "=",
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
    return undefined;
  }
  const resultCarrier = rustTargetOperationResultCarrier(fact);
  if (resultCarrier === undefined) {
    return undefined;
  }
  setRustOperationFact(walk, expression, fact);
  return setCarrierFact(walk, expression, resultCarrier);
}

function resolvePostCheckUnaryCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const selected = walk.lifecycle.host.facts.get(expression, targetOperationFactKey) ??
    walk.lifecycle.host.factResolver.resolve(expression, targetOperationFactKey);
  const pendingKind = selected === undefined ? undefined : rustPostCheckOperationKind(selected.operationId);
  if ((pendingKind !== "unary-minus" && pendingKind !== "unary-plus") ||
    expected?.kind !== "source-primitive" || !isRustNumericCarrier(expected) ||
    !selectedSourceLiteralIsRepresentable(expression, expected.name, walk.lifecycle.compiler.ast, selected)) {
    return undefined;
  }
  const operand = Node_Operand(expression);
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
  return setCarrierFact(walk, expression, expected);
}

function isConstAssertionExpression(walk: RustFactWalk, expression: Node): boolean {
  const typeNode = Node_Type(expression);
  if (typeNode === undefined || walk.lifecycle.compiler.ast.kindName(typeNode) !== KindTypeReference) {
    return false;
  }
  const typeName = TypeReferenceNode_TypeName(typeNode);
  return typeName !== undefined && walk.lifecycle.compiler.ast.text(typeName) === "const";
}

function resolveIdentifierCarrier(walk: RustFactWalk, identifier: Node, sourceFile: SourceFile): TargetTypeRef | undefined {
  const { ast, checker } = walk.lifecycle.compiler;
  const symbol = checker.getSymbolAtLocation(identifier, { sourceFile });
  const declaration = symbol === undefined
    ? undefined
    : checker.getSymbolValueDeclaration(symbol) ?? checker.getPrimarySymbolDeclaration(symbol);
  if (declaration !== undefined) {
    const declarationKind = ast.kindName(declaration);
    const declarationFileName = ast.getFileName(ast.getSourceFile(declaration));
    const declarationName = ast.name(declaration);
    if (
      !declarationFileName.endsWith(".d.ts") &&
      declarationName !== undefined &&
      !isImportBindingDeclarationKind(declarationKind)
    ) {
      const sourceName = ast.text(declarationName);
      if (sourceName.length > 0) {
        walk.lifecycle.host.facts.set(identifier, rustSourceBindingFactKey, {
          sourceName,
          fileName: declarationFileName,
        }, [{ message: "rust project-source binding" }]);
      }
    }
    if (declarationKind === KindParameter || declarationKind === KindVariableDeclaration) {
      const facts = walk.lifecycle.host.facts;
      const parameterAbi = declarationKind === KindParameter
        ? facts.get(declaration, rustSourceParameterAbiFactKey) ??
          walk.lifecycle.host.factResolver.resolve(declaration, rustSourceParameterAbiFactKey)
        : undefined;
      if (parameterAbi !== undefined) {
        facts.set(identifier, rustSourceParameterAbiFactKey, parameterAbi, [
          { message: "rust project-source parameter ABI use" },
        ]);
      }
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
    }
  }
  return undefined;
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
  const { ast } = walk.lifecycle.compiler;
  const callee = Node_Expression(expression);
  if (callee === undefined) {
    return undefined;
  }
  const callArguments = ast.arguments(expression);
  const flowHandled = tryFlowMarkerCall(walk, expression, callArguments, sourceFile, expected);
  if (flowHandled !== undefined) {
    return flowHandled.carrier;
  }
  const selectedSignature = walk.lifecycle.host.facts.get(expression, selectedTargetSignatureFactKey);
  const selectedSourceDeclaration = asSourceNode(
    selectedSignature?.sourceDeclaration,
    walk.lifecycle.compiler.ast,
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
  const { ast } = walk.lifecycle.compiler;
  const kind = ast.kindName(declaration);
  if (kind.length === 0) {
    return false;
  }
  const fileName = ast.getFileName(ast.getSourceFile(declaration));
  return fileName.length > 0 && !fileName.endsWith(".d.ts");
}

function applySelectedProjectSourceCall(
  walk: RustFactWalk,
  expression: Node,
  callee: Node,
  callArguments: readonly (Node | undefined)[],
  sourceFile: SourceFile,
  expressionKind: string,
  selectedDeclaration: Node,
  selectedSignature: SelectedTargetSignatureFact,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const { ast } = walk.lifecycle.compiler;
  const selectedMember = selectedSignature.member;
  if (callArguments.length !== selectedMember.parameters.length) {
    return undefined;
  }
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
  const parameterCarriers = selectedMember.parameters.map((parameter) =>
    substituteRustTargetTypeParameters(parameter.type, substitutions));
  const argumentModes = selectedMember.parameters.map((parameter) =>
    parameter.passingMode === "borrow-mut"
      ? "mut-ref" as const
      : parameter.passingMode === "borrow-shared"
        ? "ref" as const
        : "value" as const);
  for (const [index, argument] of (callArguments as readonly Node[]).entries()) {
    const parameterCarrier = parameterCarriers[index];
    resolveExpressionCarrier(walk, argument, sourceFile, parameterCarrier);
    const mode = argumentModes[index];
    if (mode === undefined) {
      return undefined;
    }
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
        ? Node_Expression(callee)
        : undefined;
      if (receiver === undefined) {
        return undefined;
      }
      resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
      const selfMode = walk.lifecycle.host.facts.get(selectedDeclaration, rustSelfModeFactKey) ??
        walk.lifecycle.host.factResolver.resolve(selectedDeclaration, rustSelfModeFactKey);
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
  selected: SelectedTargetSignatureFact,
  callArguments: readonly Node[],
  expected: TargetTypeRef | undefined,
): readonly TargetTypeRef[] | undefined {
  const sourceArguments = selected.sourceSelectedMethodTypeArguments ?? [];
  const selectedTargets = selected.targetTypeArguments ?? [];
  if (sourceArguments.length !== selectedTargets.length) {
    return undefined;
  }
  if (sourceArguments.length === 0 || expected === undefined || selected.member.returnType === undefined) {
    return selectedTargets;
  }
  const parameterNames = new Set(sourceArguments.map((argument) => argument.typeParameterName));
  const contextual = inferRustTargetTypeParameterBindings(
    selected.member.returnType,
    expected,
    parameterNames,
  );
  if (contextual === undefined || contextual.size === 0) {
    return selectedTargets;
  }
  const finalized = [...selectedTargets];
  for (let index = 0; index < sourceArguments.length; index += 1) {
    const source = sourceArguments[index]!;
    const selectedTarget = selectedTargets[index]!;
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

function projectSourceTypeArgumentHasLiteralProof(
  walk: RustFactWalk,
  member: TargetMember,
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
    const selected = walk.lifecycle.host.facts.get(argument, targetOperationFactKey) ??
      walk.lifecycle.host.factResolver.resolve(argument, targetOperationFactKey);
    if (!selectedSourceLiteralIsRepresentable(argument, target.name, walk.lifecycle.compiler.ast, selected)) {
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

function setCarrierFact(walk: RustFactWalk, subject: Node, carrier: TargetTypeRef): TargetTypeRef | undefined {
  const facts = walk.lifecycle.host.facts;
  const existing = facts.get(subject, runtimeCarrierFactKey) ??
    walk.lifecycle.host.factResolver.resolve(subject, runtimeCarrierFactKey);
  if (existing !== undefined) {
    if (!rustTargetTypeRefEquals(existing.carrier, carrier)) {
      walk.lifecycle.host.diagnostics.append({
        extensionId: rustTargetSemanticsExtensionId,
        extensionCode: "RUST_RUNTIME_CARRIER_CONFLICT",
        numericCode: 0,
        category: "error",
        message: "Selected source evidence and Rust lifecycle analysis produced incompatible runtime carriers for the same source subject.",
        evidence: [
          { message: "target.capability=rust.runtime-carrier.single-owner" },
          { message: `existing=${JSON.stringify(existing.carrier)}` },
          { message: `incoming=${JSON.stringify(carrier)}` },
        ],
      });
      return undefined;
    }
    return existing.carrier;
  }
  facts.set(subject, runtimeCarrierFactKey, { carrier }, [{ message: "rust carrier" }]);
  return carrier;
}

function recordSelectedOperationInputs(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  fact: RustTargetOperationFact | undefined,
): void {
  const { ast } = walk.lifecycle.compiler;
  const kind = ast.kindName(expression);
  if (kind === KindBinaryExpression) {
    const left = BinaryExpression_Left(expression);
    const right = BinaryExpression_Right(expression);
    if (left !== undefined) {
      resolveExpressionCarrier(walk, left, sourceFile, undefined);
    }
    if (right !== undefined) {
      resolveExpressionCarrier(walk, right, sourceFile, undefined);
    }
    return;
  }
  if (kind === KindPrefixUnaryExpression || kind === KindPostfixUnaryExpression) {
    const operand = Node_Operand(expression);
    if (operand !== undefined) {
      resolveExpressionCarrier(walk, operand, sourceFile, undefined);
      if (fact?.kind === "operator-token" && (fact.operator === "+=" || fact.operator === "-=")) {
        recordBindingWrite(walk, operand);
      }
    }
    return;
  }
  if (kind === KindPropertyAccessExpression) {
    const receiver = Node_Expression(expression);
    if (receiver !== undefined) {
      resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
    }
    return;
  }
  if (kind === KindElementAccessExpression) {
    const receiver = Node_Expression(expression);
    const argument = ElementAccessExpression_ArgumentExpression(expression);
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
    const callee = Node_Expression(expression);
    if (callee !== undefined && ast.kindName(callee) === KindPropertyAccessExpression) {
      const receiver = Node_Expression(callee);
      if (receiver !== undefined) {
        resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
        if (fact?.kind === "provider-operation" && fact.abi.targetReceiver.kind === "input" && fact.abi.targetReceiver.input.mode === "mut-ref") {
          recordBindingWrite(walk, receiver, "referent");
        }
      }
    }
    const callArguments = ast.arguments(expression);
    for (const [index, argument] of callArguments.entries()) {
      if (argument === undefined) {
        continue;
      }
      resolveExpressionCarrier(
        walk,
        argument,
        sourceFile,
        fact?.kind === "provider-operation" ? fact.abi.sourceArguments[index]?.carrier : undefined,
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

function resolveArrayLiteralCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const { ast } = walk.lifecycle.compiler;
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
  const selected = walk.lifecycle.host.facts.get(statement, rustTargetOperationFactKey);
  if (selected?.kind === "for-of") {
    const initializer = ForInOrOfStatement_Initializer(statement);
    if (initializer !== undefined) {
      for (const declaration of collectDescendantsOfKind(walk, initializer, KindVariableDeclaration)) {
        setCarrierFact(walk, declaration, selected.elementCarrier);
      }
    }
    const body = ForInOrOfStatement_Statement(statement);
    if (body !== undefined) {
      recordStatementFacts(walk, body, sourceFile, returnCarrier);
    }
    return;
  }
  const body = ForInOrOfStatement_Statement(statement);
  if (body !== undefined) {
    recordStatementFacts(walk, body, sourceFile, returnCarrier);
  }
}

// --- Project-source classes and enums --------------------------------------

function sourceTypeCarrierForDeclaration(walk: RustFactWalk, declaration: Node): TargetTypeRef | undefined {
  return walk.sourceTypes.carrierForDeclaration(declaration, walk.lifecycle.compiler.ast);
}

function recordMethodSelfModeFacts(walk: RustFactWalk, sourceFiles: readonly SourceFile[]): void {
  const { ast } = walk.lifecycle.compiler;
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
        const operator = BinaryExpression_OperatorToken(node);
        const left = BinaryExpression_Left(node);
        if (operator !== undefined && left !== undefined &&
          isRustAssignmentOperator(ast.kindName(operator)) && expressionIsRootedAtThis(ast, left)) {
          mutating.add(method);
        }
      } else if ((kind === KindPrefixUnaryExpression || kind === KindPostfixUnaryExpression) &&
        expressionIsRootedAtThis(ast, Node_Operand(node))) {
        mutating.add(method);
      } else if (kind === KindCallExpression) {
        const callee = Node_Expression(node);
        const receiver = callee !== undefined && ast.kindName(callee) === KindPropertyAccessExpression
          ? Node_Expression(callee)
          : undefined;
        if (expressionIsRootedAtThis(ast, receiver)) {
          const selected = walk.lifecycle.host.facts.get(node, selectedTargetSignatureFactKey) ??
            walk.lifecycle.host.factResolver.resolve(node, selectedTargetSignatureFactKey);
          const selectedDeclaration = asSourceNode(selected?.sourceDeclaration, ast);
          if (selectedDeclaration !== undefined && methodSet.has(selectedDeclaration)) {
            callees.add(selectedDeclaration);
          }
          const operation = walk.lifecycle.host.facts.get(node, rustTargetOperationFactKey) ??
            walk.lifecycle.host.factResolver.resolve(node, rustTargetOperationFactKey);
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
    walk.lifecycle.host.facts.set(method, rustSelfModeFactKey, {
      mode: mutating.has(method) ? "mut-ref" : "ref",
    }, [{ message: "rust finalized method self mode" }]);
  }
}

function expressionIsRootedAtThis(ast: ExtensionLifecycleContext["compiler"]["ast"], expression: Node | undefined): boolean {
  let current = expression;
  while (current !== undefined) {
    const kind = ast.kindName(current);
    if (kind === "KindThisExpression" || kind === "KindThisKeyword") {
      return true;
    }
    if (kind !== KindPropertyAccessExpression && kind !== KindElementAccessExpression) {
      return false;
    }
    current = Node_Expression(current);
  }
  return false;
}

function recordClassSignatureFacts(walk: RustFactWalk, declaration: Node): void {
  const { ast } = walk.lifecycle.compiler;
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
      const fieldCarrier = resolveTypeNodeCarrier(walk, Node_Type(member));
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
        const parameterAbi = resolveParameterAbi(walk, parameter);
        if (parameterAbi !== undefined) {
          setCarrierFact(walk, parameter, parameterAbi.valueCarrier);
          setParameterAbiFact(walk, parameter, parameterAbi.parameterCarrier, parameterAbi.mode);
        }
      }
    }
  }
}

function recordClassBodyFacts(walk: RustFactWalk, declaration: Node, sourceFile: SourceFile): void {
  const { ast } = walk.lifecycle.compiler;
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
        ? resolveTypeNodeCarrier(walk, Node_Type(member))
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
  const { ast } = walk.lifecycle.compiler;
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
    const fieldCarrier = resolveTypeNodeCarrier(walk, Node_Type(member));
    if (fieldCarrier !== undefined) {
      setCarrierFact(walk, member, fieldCarrier);
    }
  }
}

function appendMalformedSourceAstDiagnostic(lifecycle: ExtensionLifecycleContext, message: string): void {
  lifecycle.host.diagnostics.append({
    extensionId: rustTargetSemanticsExtensionId,
    extensionCode: "RUST_SOURCE_AST_INCOMPLETE",
    numericCode: 0,
    category: "error",
    message,
    evidence: [{ message: "target.capability=rust.source-ast.closed" }],
  });
}

function appendMalformedSourceAst(walk: RustFactWalk, message: string): void {
  appendMalformedSourceAstDiagnostic(walk.lifecycle, message);
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
  const { ast } = walk.lifecycle.compiler;
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
    const expectedField = walk.lifecycle.host.facts.get(memberDeclaration, runtimeCarrierFactKey)?.carrier ??
      resolveTypeNodeCarrier(walk, Node_Type(memberDeclaration));
    const initializer = Node_Initializer(property);
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
  walk.lifecycle.host.facts.set(declaration, rustUnionVariantsFactKey, { variants }, [
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
  return walk.sourceCallableAbi.resolveParameterAbi(parameter, {
    compiler: walk.lifecycle.compiler,
    factResolver: walk.lifecycle.host.factResolver,
  }, {
    providerRows: walk.providerRows,
    jsEnabled: walk.jsEnabled,
    sourceProfiles: walk.sourceProfiles,
    sourceTypes: walk.sourceTypes,
    providerCarrierPaths: walk.providerCarrierPaths,
  }, walk.analysis);
}

function setParameterAbiFact(
  walk: RustFactWalk,
  parameter: Node,
  parameterCarrier: TargetTypeRef,
  mode: import("../rust-facts/keys.js").RustArgumentMode,
): void {
  walk.lifecycle.host.facts.set(parameter, rustSourceParameterAbiFactKey, { parameterCarrier, mode }, [
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
  const { ast, checker } = walk.lifecycle.compiler;
  const kind = ast.kindName(target);
  if (kind === KindPropertyAccessExpression || kind === KindElementAccessExpression) {
    const receiver = Node_Expression(target);
    const receiverKind = receiver === undefined ? "" : ast.kindName(receiver);
    if (receiverKind === "KindThisExpression" || receiverKind === "KindThisKeyword") {
      if (walk.currentMethodDeclaration !== undefined) {
        walk.lifecycle.host.facts.set(walk.currentMethodDeclaration, rustSelfModeFactKey, { mode: "mut-ref" }, [
          { message: "rust self write" },
        ]);
      }
      return;
    }
    recordBindingWrite(walk, receiver, "referent");
    return;
  }
  if (kind === KindCallExpression) {
    const fact = walk.lifecycle.host.facts.get(target, rustTargetOperationFactKey);
    if (fact !== undefined && fact.kind === "flow-marker") {
      recordBindingWrite(walk, ast.arguments(target)[0], "referent");
    }
    return;
  }
  if (kind !== KindIdentifier) {
    return;
  }
  const symbol = checker.getResolvedSymbolOrNil(target);
  if (symbol === undefined) {
    return;
  }
  const declaration = checker.getSymbolValueDeclaration(symbol) ??
    checker.getPrimarySymbolDeclaration(symbol) ??
    checker.getSymbolDeclarations(symbol)[0];
  if (declaration !== undefined) {
    const key = writeKind === "binding" ? rustMutatedBindingFactKey : rustMutatedReferentFactKey;
    walk.lifecycle.host.facts.set(declaration, key, { mutated: true }, [
      { message: `rust ${writeKind} write` },
    ]);
  }
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

function validateFlowMarkerAgainstMode(
  walk: RustFactWalk,
  argument: Node,
  mode: "value" | "ref" | "mut-ref",
): void {
  const flow = walk.lifecycle.host.factResolver.resolve(argument, flowStateFactKey) ??
    walk.lifecycle.host.facts.get(argument, flowStateFactKey);
  const rustFact = walk.lifecycle.host.facts.get(argument, rustTargetOperationFactKey);
  const markerState = rustFact !== undefined && rustFact.kind === "flow-marker" ? rustFact.state : flow?.state;
  if (markerState === undefined) {
    return;
  }
  const compatible =
    (markerState === "moved" && mode === "value") ||
    (markerState === "borrowed-shared" && mode === "ref") ||
    (markerState === "borrowed-mut" && mode === "mut-ref");
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
  const { ast } = walk.lifecycle.compiler;
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
    const selected = walk.lifecycle.host.facts.get(node, selectedTargetSignatureFactKey) ??
      walk.lifecycle.host.factResolver.resolve(node, selectedTargetSignatureFactKey);
    const declaration = asSourceNode(
      selected?.sourceDeclaration,
      walk.lifecycle.compiler.ast,
    );
    return declaration !== undefined && selectedDeclarationIsProjectSource(walk, declaration)
      ? declaration
      : undefined;
  };
  const operationIsFallible = (node: Node): boolean => {
    const fact = walk.lifecycle.host.facts.get(node, rustTargetOperationFactKey) ??
      walk.lifecycle.host.factResolver.resolve(node, rustTargetOperationFactKey);
    return rustOperationIsFallible(fact);
  };

  const bodyIsFallible = (declaration: Node): boolean => {
    const body = ast.body(declaration);
    if (body === undefined) {
      return false;
    }
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
        const tryBlock = TryStatement_TryBlock(node);
        const catchBlock = CatchClause_Block(TryStatement_CatchClause(node));
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
        const operand = Node_Expression(node);
        const operandFact = operand === undefined
          ? undefined
          : walk.lifecycle.host.facts.get(operand, rustTargetOperationFactKey) ??
            walk.lifecycle.host.factResolver.resolve(operand, rustTargetOperationFactKey);
        const selectedDeclaration = operand === undefined ? undefined : selectedProjectDeclaration(operand);
        const selectedAsync = selectedDeclaration !== undefined &&
          walk.lifecycle.host.facts.get(selectedDeclaration, rustAsyncFunctionFactKey) !== undefined;
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
          walk.lifecycle.host.facts.get(target, rustAsyncFunctionFactKey) === undefined) {
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
    visit(body, false);
    return found;
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
    walk.lifecycle.host.facts.set(declaration, rustFallibleFactKey, { fallible: true }, [
      { message: "rust fallible declaration" },
    ]);
  }
  for (const sourceFile of projectSourceFiles) {
    const visit = (node: Node): void => {
      const kind = ast.kindName(node);
      if (kind === KindCallExpression || kind === KindNewExpression) {
        const declaration = selectedProjectDeclaration(node);
        const operation = walk.lifecycle.host.facts.get(node, rustTargetOperationFactKey) ??
          walk.lifecycle.host.factResolver.resolve(node, rustTargetOperationFactKey);
        if (declaration !== undefined && operation?.kind === "source-call") {
          const isAsync = walk.lifecycle.host.facts.get(declaration, rustAsyncFunctionFactKey) !== undefined;
          const isFallible = fallible.has(declaration);
          walk.lifecycle.host.facts.set(node, rustSourceCallEffectsFactKey, {
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
  const { ast } = walk.lifecycle.compiler;
  const expression = Node_Expression(statement);
  if (expression === undefined || ast.kindName(expression) !== KindNewExpression) {
    return;
  }
  resolveExpressionCarrier(walk, expression, sourceFile, undefined);
  const constructor = walk.lifecycle.host.facts.get(expression, rustTargetOperationFactKey) ??
    walk.lifecycle.host.factResolver.resolve(expression, rustTargetOperationFactKey);
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
  const { ast } = walk.lifecycle.compiler;
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

function appendRegExpDiagnostic(walk: RustFactWalk, violation: string): void {
  walk.lifecycle.host.diagnostics.append({
    extensionId: rustTargetSemanticsExtensionId,
    extensionCode: "RUST_REGEXP_UNSUPPORTED",
    numericCode: 0,
    category: "error",
    message: `RegExp construct outside the oracle-proven subset: ${violation}.`,
    evidence: [{ message: "target.capability=rust.js.regexp" }],
  });
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
    appendRegExpDiagnostic(walk, violation);
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
