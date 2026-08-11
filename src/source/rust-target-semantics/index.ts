import {
  flowStateFactKey,
} from "@tsonic/tsts";
import type {
  AstReader,
  ExtensionFactSubject,
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
  CaseBlock_Clauses,
  CaseOrDefaultClause_Expression,
  CaseOrDefaultClause_Statements,
  ConditionalExpression_Condition,
  ConditionalExpression_WhenFalse,
  ConditionalExpression_WhenTrue,
  TemplateExpression_TemplateSpans,
  TemplateSpan_Expression,
  DoStatement_Statement,
  LabeledStatement_Statement,
  ForInOrOfStatement_Initializer,
  ForInOrOfStatement_Statement,
  TryStatement_CatchClause,
  TryStatement_FinallyBlock,
  TryStatement_TryBlock,
  ForStatement_Condition,
  ForStatement_Incrementor,
  ForStatement_Initializer,
  IfStatement_ElseStatement,
  IfStatement_ThenStatement,
  IterationStatement_Statement,
  SwitchStatement_CaseBlock,
  SwitchStatement_Expression,
  Node_Operand,
  KindBinaryExpression,
  KindBlock,
  KindCallExpression,
  KindCaseClause,
  KindConditionalExpression,
  KindDeleteExpression,
  KindDoStatement,
  KindLabeledStatement,
  KindElementAccessExpression,
  KindEqualsEqualsEqualsToken,
  KindEqualsToken,
  KindExclamationEqualsEqualsToken,
  KindExpressionStatement,
  KindFalseKeyword,
  KindForInStatement,
  KindForOfStatement,
  KindForStatement,
  KindFunctionDeclaration,
  KindFunctionExpression,
  KindIdentifier,
  KindIfStatement,
  KindArrayLiteralExpression,
  KindArrayBindingPattern,
  KindBigIntLiteral,
  KindBindingElement,
  KindNewExpression,
  KindNoSubstitutionTemplateLiteral,
  KindNonNullExpression,
  KindNumericLiteral,
  KindObjectBindingPattern,
  KindOmittedExpression,
  KindParameter,
  KindParenthesizedExpression,
  KindPostfixUnaryExpression,
  KindPrefixUnaryExpression,
  KindPropertyAccessExpression,
  KindQuestionQuestionToken,
  KindReturnStatement,
  KindStringLiteral,
  KindSatisfiesExpression,
  KindSwitchStatement,
  KindTemplateExpression,
  KindTrueKeyword,
  KindTypeOfExpression,
  KindVoidExpression,
  KindVariableDeclaration,
  KindVariableStatement,
  KindWhileStatement,
  Node_Expression,
  Node_Initializer,
  Node_Name,
  Node_Type,
  asSourceNode,
} from "../../common/source-ast.js";
import {
  isRustJsArrayCarrier,
  rustFutureOutputCarrier,
  getRustGeneratorProtocol,
  isRustBigIntCarrier,
  isRustBoolCarrier,
  isRustIntegerCarrier,
  isRustNumericCarrier,
  isRustNullishSourceCarrier,
  isRustOptionCarrier,
  isRustSourceStringConvertibleCarrier,
  isRustStringCarrier,
  isRustUnitCarrier,
  isRustUndefinedCarrier,
  rustOptionElementCarrier,
  isRustVecCarrier,
  rustBigIntTargetType,
  rustCallableProtocol,
  rustClosureProtocol,
  rustCallableTargetType,
  rustJsArrayTargetType,
  rustNullishSourceTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
  rustUndefinedTargetType,
  inferRustTargetTypeParameterBindings,
  substituteRustTargetTypeParameters,
  rustVecTargetType,
  rustSourceTypeCarrierValue,
} from "../rust-target-types.js";
import { parseSourceBigIntLiteral } from "../../common/source-literal-values.js";
import { rustAsyncFunctionFactKey, rustClosureCaptureFactKey, rustFallibleFactKey, rustFutureValueFactKey, rustGeneratorFactKey, rustLocationStorageFactKey, rustModuleBindingFactKey, rustMutatedBindingFactKey, rustMutatedReferentFactKey, rustOptionalChainFactKey, rustOptionWrapFactKey, rustPostCheckOperationKind, rustPostCheckUnaryMinusOperationId, rustPostCheckUnaryPlusOperationId, rustProjectUpcastFactKey, rustResourceManagementFactKey, rustSelfModeFactKey, rustSourceBindingFactKey, rustSourceCallableReturnFactKey, rustSourceCallableValueFactKey, rustSourceCallEffectsFactKey, rustSourceParameterAbiFactKey, rustTargetOperationFactKey, rustTargetOperationResultCarrier, rustUnionVariantsFactKey, rustYieldFactKey } from "../rust-facts/keys.js";
import type { RustFutureValueFact, RustTargetOperationFact } from "../rust-facts/keys.js";
import {
  rustFutureValueForOperation,
  rustFutureValueMatchesCarrier,
} from "../rust-facts/future-values.js";
import {
  rustOperationAbiAwaitIsFallible,
  rustTargetOperationIsFallible,
  rustTargetOperationSupportsAssignment,
  rustTargetOperationText,
} from "../rust-facts/target-operation.js";
import { rustArgumentPassingMode } from "../rust-facts/parameter-passing.js";
import {
  collectRustProviderSemantics,
  collectRustProviderSemanticsFromDefinitions,
  mergeRustProviderSemantics,
} from "../provider-packages/index.js";
import { rustStdProviderDefinition } from "../../providers/compiler/std-catalog.js";
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
  selectRustCheckedDelete,
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
  resolveRustContextualParameterAbi,
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
import { selectRustResourceManagement } from "./resource-management.js";
import { rustProjectMemberSlotName } from "./project-type-policy.js";
import { rustProjectCallableTargetName } from "./source-member-name.js";
import { rustProjectObjectLayout } from "./project-object-layout.js";
import { recordRustBindingPatternFacts } from "./binding-patterns.js";

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
  currentSuperCarrier?: TargetTypeRef;
  currentMethodDeclaration?: Node;
  currentCallableDeclaration?: Node;
  currentGeneratorDeclaration?: Node;
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
      optionalChain: source.optionalChain,
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
      sourceReceiverType: source.receiver.type,
      ...(source.receiver.declaration === undefined
        ? {}
        : { sourceReceiverDeclaration: source.receiver.declaration }),
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
      sourceReceiverType: source.receiver.type,
      argument: source.argument.expression,
      ...(source.selectedSymbol === undefined ? {} : { sourceSelectedSymbol: source.selectedSymbol }),
      ...(source.selectedDeclaration === undefined ? {} : { sourceSelectedDeclaration: source.selectedDeclaration }),
      ...(source.selectedElementIndex === undefined ? {} : { sourceSelectedElementIndex: source.selectedElementIndex }),
      sourceResultType: source.sourceReadType ?? source.sourceWriteType,
      optionalChain: source.optionalChain,
    }, context, walk.operationOptions));
    return;
  }
  if (kind === KindDeleteExpression) {
    const operand = Node_Expression(ast, expression);
    const source = operand === undefined || ast.kindName(operand) !== KindElementAccessExpression
      ? undefined
      : semantics.getResolvedElementAccessInfo(operand);
    if (operand === undefined || source === undefined || source.callCallee) {
      appendRustDiagnostic(
        walk,
        "RUST_DELETE_SELECTION_UNSUPPORTED",
        "delete requires one exact checked element-access selection.",
        expression,
        ["target.capability=rust.syntax.delete"],
      );
      return;
    }
    recordPolicySelection(walk, expression, selectRustCheckedDelete({
      target: "rust",
      expression,
      operand,
      receiver: source.receiver.expression,
      index: source.argument.expression,
      ...(source.selectedSymbol === undefined ? {} : { sourceSelectedSymbol: source.selectedSymbol }),
      ...(source.selectedDeclaration === undefined ? {} : { sourceSelectedDeclaration: source.selectedDeclaration }),
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
  const staticProviderSemantics = mergeRustProviderSemantics(
    collectRustProviderSemanticsFromDefinitions([rustStdProviderDefinition()]),
    collectRustProviderSemantics(context.backend),
  );
  const providerSemantics = context.compilerProviderSemantics === undefined
    ? staticProviderSemantics
    : mergeRustProviderSemantics(staticProviderSemantics, context.compilerProviderSemantics);
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
    projectTypes: context.projectTypes,
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
  }
  const projectTypes = context.projectTypes.initialize({
    ast,
    navigation: context.source.navigation,
    sourceFiles: projectSourceFiles,
    resolveSelectedType(authoredTypeNode, selectedType, heritage) {
      return resolveRustTargetTypeRef(
        authoredTypeNode ?? selectedType,
        rustResolutionContext(walk, heritage),
        operationOptions,
      );
    },
  });
  for (const issue of projectTypes.issues) {
    appendRustDiagnostic(
      walk,
      issue.code,
      issue.message,
      issue.node,
      ["target.capability=rust.project-types.heritage"],
    );
  }
  if (projectTypes.issues.length > 0) {
    return;
  }
  for (const sourceFile of projectSourceFiles) {
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
    recordNestedCallableTypeSignatureFacts(walk, sourceFile);
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
      } else if (kind !== "KindImportDeclaration" &&
        kind !== "KindExportDeclaration" &&
        kind !== "KindInterfaceDeclaration" &&
        kind !== "KindTypeAliasDeclaration" &&
        kind !== "KindEnumDeclaration" &&
        kind !== "KindEndOfFile") {
        recordStatementFacts(walk, statement, sourceFile, undefined);
      }
    }
  }
  // Fallibility depends on finalized operation facts produced while walking
  // bodies. Compute the declaration fixpoint only after those facts exist.
  recordFallibilityFacts(walk, projectSourceFiles);
  recordResourceManagementFacts(walk, projectSourceFiles);
  recordFutureValueFacts(walk, projectSourceFiles);
}

function promiseInnerCarrier(
  walk: RustFactWalk,
  declaration: Node,
  subject: ExtensionFactSubject | undefined,
): TargetTypeRef | undefined {
  return rustFutureOutputCarrier(resolveRustTargetTypeRef(
    subject,
    rustResolutionContext(walk, declaration),
    walk.operationOptions,
  ));
}

function recordFunctionSignatureFacts(walk: RustFactWalk, declaration: Node): void {
  recordCallableSuspensionFacts(walk, declaration);
  recordCallableTypeSignatureFacts(walk, declaration);
}

function recordCallableTypeSignatureFacts(walk: RustFactWalk, declaration: Node): void {
  recordCallableReturnFact(walk, declaration);
  const parameters = requireDenseSourceNodes(walk, walk.context.ast.parameters(declaration), "Function declaration contains an undefined or non-data parameter slot.");
  if (parameters === undefined) {
    return;
  }
  for (const parameter of parameters) {
    recordParameterAbiFacts(walk, parameter);
  }
}

function recordNestedCallableTypeSignatureFacts(walk: RustFactWalk, sourceFile: SourceFile): void {
  const { ast } = walk.context;
  const visit = (node: Node | undefined): void => {
    if (node === undefined) {
      return;
    }
    const kind = ast.kindName(node);
    if (kind === "KindFunctionType" || kind === "KindCallSignature") {
      recordCallableTypeSignatureFacts(walk, node);
    }
    ast.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function recordCallableSuspensionFacts(walk: RustFactWalk, declaration: Node): void {
  const { ast } = walk.context;
  const sourceReturn = selectedSourceCallableReturn(walk, declaration);
  const sourceGenerator = walk.context.semanticsFor(declaration).getResolvedGeneratorInfo(declaration);
  if (sourceGenerator !== undefined) {
    const carrier = resolveRustTargetTypeRef(
      Node_Type(ast, declaration) ?? sourceGenerator.sourceReturnType ?? sourceReturn,
      rustResolutionContext(walk, declaration),
      walk.operationOptions,
    );
    const protocol = getRustGeneratorProtocol(carrier);
    if (carrier === undefined || protocol?.kind !== sourceGenerator.generatorKind) {
      appendRustDiagnostic(
        walk,
        "RUST_GENERATOR_PROTOCOL_NOT_CLOSED",
        "The checked generator declaration has no closed Rust yield, return, and next protocol.",
        declaration,
        ["target.capability=rust.generator.protocol"],
      );
    } else {
      walk.context.facts.set(declaration, rustGeneratorFactKey, {
        kind: protocol.kind,
        carrier,
        yieldType: protocol.yieldType,
        returnType: protocol.returnType,
        nextType: protocol.nextType,
      }, [{ message: "rust generator protocol" }]);
      const typeNode = Node_Type(ast, declaration);
      if (typeNode !== undefined) {
        setCarrierFact(walk, typeNode, carrier);
      }
    }
  } else if (ast.hasModifierKind(declaration, "async")) {
    const inner = promiseInnerCarrier(
      walk,
      declaration,
      Node_Type(walk.context.ast, declaration) ?? sourceReturn,
    );
    if (inner !== undefined) {
      walk.context.facts.set(declaration, rustAsyncFunctionFactKey, { isAsync: true, outputCarrier: inner }, [
        { message: "rust async function" },
      ]);
    }
  }
}

function selectedSourceCallableReturn(walk: RustFactWalk, declaration: Node) {
  const semantics = walk.context.semanticsFor(declaration);
  const callableType = semantics.getDeclaredValueType(declaration);
  if (callableType === undefined) {
    return undefined;
  }
  const signatures = semantics.getCallSignaturesOfType(callableType).filter((signature) =>
    semantics.getSignatureDeclaration(signature) === declaration);
  return signatures.length === 1
    ? semantics.getReturnTypeOfSignature(signatures[0]!)
    : undefined;
}

function recordCallableReturnFact(walk: RustFactWalk, declaration: Node): void {
  const generator = walk.context.facts.get(declaration, rustGeneratorFactKey);
  const asynchronous = walk.context.facts.get(declaration, rustAsyncFunctionFactKey);
  const sourceReturn = selectedSourceCallableReturn(walk, declaration);
  const carrier = generator?.carrier ?? asynchronous?.outputCarrier ??
    resolveRustTargetTypeRef(
      Node_Type(walk.context.ast, declaration) ?? sourceReturn,
      rustResolutionContext(walk, declaration),
      walk.operationOptions,
    );
  if (carrier !== undefined) {
    walk.context.facts.set(declaration, rustSourceCallableReturnFactKey, {
      returnCarrier: carrier,
    }, [{ message: "rust finalized source callable return carrier" }]);
  }
}

function recordFunctionBodyFacts(walk: RustFactWalk, declaration: Node, sourceFile: SourceFile): void {
  const { ast } = walk.context;
  const asyncFact = walk.context.facts.get(declaration, rustAsyncFunctionFactKey);
  const generatorFact = walk.context.facts.get(declaration, rustGeneratorFactKey);
  const returnCarrier = generatorFact?.returnType ?? asyncFact?.outputCarrier ??
    walk.context.facts.get(declaration, rustSourceCallableReturnFactKey)?.returnCarrier;
  const body = ast.body(declaration);
  const previousCallable = walk.currentCallableDeclaration;
  const previousGenerator = walk.currentGeneratorDeclaration;
  walk.currentCallableDeclaration = declaration;
  walk.currentGeneratorDeclaration = generatorFact === undefined ? undefined : declaration;
  if (body !== undefined) {
    const statements = requireDenseSourceNodes(walk, ast.statements(body), "Function body contains an undefined or non-data statement slot.");
    if (statements === undefined) {
      walk.currentCallableDeclaration = previousCallable;
      walk.currentGeneratorDeclaration = previousGenerator;
      return;
    }
    for (const statement of statements) {
      recordStatementFacts(walk, statement, sourceFile, returnCarrier);
    }
  }
  walk.currentCallableDeclaration = previousCallable;
  walk.currentGeneratorDeclaration = previousGenerator;
}

function recordVariableStatementFacts(walk: RustFactWalk, statement: Node, sourceFile: SourceFile): void {
  const moduleLevel = walk.context.ast.kindName(walk.context.ast.parent(statement)) === "KindSourceFile";
  for (const declaration of collectDescendantsOfKind(walk, statement, KindVariableDeclaration)) {
    const annotated = resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, declaration));
    const initializer = Node_Initializer(walk.context.ast, declaration);
    const initializerCarrier = initializer === undefined
      ? undefined
      : resolveExpressionCarrier(walk, initializer, sourceFile, annotated);
    const effective = annotated ?? initializerCarrier;
    if (effective !== undefined) {
      setCarrierFact(walk, declaration, effective);
      const name = Node_Name(walk.context.ast, declaration);
      const nameKind = name === undefined ? "" : walk.context.ast.kindName(name);
      if (name !== undefined && (nameKind === KindArrayBindingPattern || nameKind === KindObjectBindingPattern) &&
        !recordBindingPatternFacts(walk, name, effective)) {
        appendRustDiagnostic(
          walk,
          "RUST_BINDING_PATTERN_NOT_CLOSED",
          "Binding pattern has no total Rust projection from its exact finalized source carrier.",
          name,
          ["target.capability=rust.binding-pattern"],
        );
      }
      const declarationKind = walk.context.ast.variableDeclarationKind(declaration);
      if (moduleLevel && (declarationKind === "const" || declarationKind === "let" || declarationKind === "var")) {
        const initializerKind = initializer === undefined
          ? undefined
          : walk.context.ast.kindName(initializer);
        const nativeConst = declarationKind === "const" && (
          initializerKind === KindNumericLiteral ||
          initializerKind === KindTrueKeyword ||
          initializerKind === KindFalseKeyword
        );
        walk.context.facts.set(declaration, rustModuleBindingFactKey, {
          declarationKind,
          storage: nativeConst ? "native-const" : "module-cell",
          valueCarrier: effective,
        }, [{ message: "rust finalized project module binding storage" }]);
      }
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
  if (kind === KindLabeledStatement) {
    const body = LabeledStatement_Statement(walk.context.ast, statement);
    if (body !== undefined) {
      recordStatementFacts(walk, body, sourceFile, returnCarrier);
    }
    return;
  }
  if (kind === KindSwitchStatement) {
    recordSwitchFacts(walk, statement, sourceFile, returnCarrier);
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
    const finallyBlock = TryStatement_FinallyBlock(walk.context.ast, statement);
    if (finallyBlock !== undefined) {
      recordStatementFacts(walk, finallyBlock, sourceFile, returnCarrier);
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
  if (kind === KindWhileStatement || kind === KindDoStatement) {
    const condition = Node_Expression(walk.context.ast, statement);
    if (condition !== undefined) {
      resolveExpressionCarrier(walk, condition, sourceFile, boolCarrier);
    }
    const body = kind === KindDoStatement
      ? DoStatement_Statement(walk.context.ast, statement)
      : IterationStatement_Statement(walk.context.ast, statement);
    if (body !== undefined) {
      recordStatementFacts(walk, body, sourceFile, returnCarrier);
    }
    return;
  }
  if (kind === KindForOfStatement || kind === KindForInStatement) {
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

function recordSwitchFacts(
  walk: RustFactWalk,
  statement: Node,
  sourceFile: SourceFile,
  returnCarrier: TargetTypeRef | undefined,
): void {
  const { ast } = walk.context;
  const discriminant = SwitchStatement_Expression(ast, statement);
  const clauses = CaseBlock_Clauses(ast, SwitchStatement_CaseBlock(ast, statement));
  if (discriminant === undefined || clauses === undefined || clauses.some((clause) => clause === undefined)) {
    return;
  }
  const discriminantCarrier = resolveExpressionCarrier(walk, discriminant, sourceFile, undefined);
  if (discriminantCarrier === undefined || !rustSwitchCarrierSupportsEquality(discriminantCarrier)) {
    appendRustDiagnostic(
      walk,
      "RUST_SWITCH_DISCRIMINANT_NOT_CLOSED",
      "Switch discrimination requires an exact closed Rust equality carrier.",
      statement,
      ["target.capability=rust.switch"],
    );
    return;
  }
  const finalizedClauses: Extract<RustTargetOperationFact, { readonly kind: "switch" }>["clauses"][number][] = [];
  let failed = false;
  for (const clause of clauses as readonly Node[]) {
    const expression = CaseOrDefaultClause_Expression(ast, clause);
    if (ast.kindName(clause) === KindCaseClause) {
      const carrier = expression === undefined
        ? undefined
        : resolveExpressionCarrier(walk, expression, sourceFile, discriminantCarrier);
      if (expression === undefined || carrier === undefined ||
        !rustTargetTypeRefEquals(carrier, discriminantCarrier)) {
        appendRustDiagnostic(
          walk,
          "RUST_SWITCH_CASE_NOT_CLOSED",
          "Switch case selection requires the exact discriminant carrier.",
          clause,
          ["target.capability=rust.switch"],
        );
        failed = true;
      } else {
        finalizedClauses.push({ clause, expression, carrier });
      }
    } else {
      finalizedClauses.push({ clause });
    }
    const statements = CaseOrDefaultClause_Statements(ast, clause);
    if (statements === undefined || statements.some((child) => child === undefined)) {
      failed = true;
      continue;
    }
    for (const child of statements as readonly Node[]) {
      recordStatementFacts(walk, child, sourceFile, returnCarrier);
    }
  }
  if (!failed && finalizedClauses.length === clauses.length) {
    setRustOperationFact(walk, statement, {
      kind: "switch",
      operationId: "tsonic.rust.control.switch.strict-equality",
      discriminantCarrier,
      clauses: finalizedClauses,
    });
  }
}

function rustSwitchCarrierSupportsEquality(carrier: TargetTypeRef): boolean {
  const sourceType = rustSourceTypeCarrierValue(carrier);
  return isRustNumericCarrier(carrier) || isRustBoolCarrier(carrier) ||
    isRustStringCarrier(carrier) || sourceType?.shape === "enum";
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
  const contextualExpected = rustOptionElementCarrier(expected) ?? expected;
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
    resolveExpressionOperationDependencies(walk, expression, sourceFile, contextualExpected);
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
      const optionalChain = facts.get(expression, rustOptionalChainFactKey) ??
        walk.context.facts.resolve(expression, rustOptionalChainFactKey);
      if (optionalChain !== undefined && selectedOperation.resultType !== undefined &&
        !rustTargetTypeRefEquals(optionalChain.resultCarrier, selectedOperation.resultType)) {
        appendRustDiagnostic(
          walk,
          "RUST_OPTIONAL_CHAIN_RESULT_CONFLICT",
          "The finalized optional-chain result conflicts with the selected Rust operation result.",
          expression,
          ["target.capability=rust.optional-chain.exact-result"],
        );
        return undefined;
      }
      const finalizedResult = optionalChain?.resultCarrier ?? (rustOperation === undefined
        ? selectedOperation.resultType
        : rustTargetOperationResultCarrier(rustOperation) ?? selectedOperation.resultType);
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
    const resolved = resolveExpressionCarrierUncached(
      walk,
      expression,
      sourceFile,
      contextualExpected,
    );
    return applyOptionLane(walk, expression, resolved, expected);
  } finally {
    recordExpressionBindingEffects(walk, expression);
    walk.resolving.delete(expression);
  }
}

function recordExpressionBindingEffects(walk: RustFactWalk, expression: Node): void {
  const { ast } = walk.context;
  const kind = ast.kindName(expression);
  if (kind === KindBinaryExpression) {
    const operatorToken = BinaryExpression_OperatorToken(ast, expression);
    const operatorKind = operatorToken === undefined ? "" : ast.kindName(operatorToken);
    if (isRustAssignmentOperator(operatorKind)) {
      recordAssignmentWrite(walk, expression, BinaryExpression_Left(ast, expression));
    }
    return;
  }
  if (kind === KindPrefixUnaryExpression || kind === KindPostfixUnaryExpression) {
    const fact = walk.context.facts.get(expression, rustTargetOperationFactKey);
    if (fact?.kind === "operator-token" && (fact.operator === "+=" || fact.operator === "-=")) {
      recordBindingWrite(walk, Node_Operand(ast, expression));
    }
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
  if (kind === KindConditionalExpression) {
    const condition = ConditionalExpression_Condition(ast, expression);
    const whenTrue = ConditionalExpression_WhenTrue(ast, expression);
    const whenFalse = ConditionalExpression_WhenFalse(ast, expression);
    if (condition !== undefined) {
      resolveExpressionCarrier(walk, condition, sourceFile, boolCarrier);
    }
    if (whenTrue !== undefined) {
      resolveExpressionCarrier(walk, whenTrue, sourceFile, expected);
    }
    if (whenFalse !== undefined) {
      resolveExpressionCarrier(walk, whenFalse, sourceFile, expected);
    }
    return;
  }
  if (kind === KindPrefixUnaryExpression || kind === KindPostfixUnaryExpression) {
    const operand = Node_Operand(ast, expression);
    if (operand !== undefined) {
      resolveExpressionCarrier(walk, operand, sourceFile, expected);
    }
    return;
  }
  if (kind === KindVoidExpression) {
    const operand = Node_Expression(ast, expression);
    if (operand !== undefined) {
      resolveExpressionCarrier(walk, operand, sourceFile, undefined);
    }
    return;
  }
  if (kind === KindDeleteExpression) {
    const operand = Node_Expression(ast, expression);
    const receiver = operand === undefined ? undefined : Node_Expression(ast, operand);
    const index = operand === undefined
      ? undefined
      : ElementAccessExpression_ArgumentExpression(ast, operand);
    if (receiver !== undefined) {
      resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
    }
    if (index !== undefined) {
      resolveExpressionCarrier(
        walk,
        index,
        sourceFile,
        rustSourcePrimitiveTargetType("int32"),
      );
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
      resolveCallArgumentOperationPrerequisite(
        walk,
        argument.expression,
        sourceFile,
      );
    }
  }
}

function resolveCallArgumentOperationPrerequisite(
  walk: RustFactWalk,
  argument: Node,
  sourceFile: SourceFile,
): void {
  const kind = walk.context.ast.kindName(argument);
  if (kind === KindCallExpression || kind === KindNewExpression ||
    kind === KindPropertyAccessExpression || kind === KindElementAccessExpression ||
    kind === KindBinaryExpression || kind === KindPrefixUnaryExpression ||
    kind === KindPostfixUnaryExpression) {
    resolveExpressionCarrier(walk, argument, sourceFile, undefined);
    return;
  }
  if (kind === KindParenthesizedExpression || kind === KindNonNullExpression ||
    kind === KindSatisfiesExpression || kind === "KindAsExpression" ||
    kind === "KindTypeAssertionExpression") {
    const inner = Node_Expression(walk.context.ast, argument);
    if (inner !== undefined) {
      resolveCallArgumentOperationPrerequisite(walk, inner, sourceFile);
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
  const target = expected === undefined
    ? undefined
    : rustOptionElementCarrier(expected) ?? expected;
  let projected = resolved;
  if (resolved !== undefined && target !== undefined &&
    !rustTargetTypeRefEquals(resolved, target)) {
    const targetDefinition = walk.context.projectTypes.definitionForCarrier(target);
    const relation = targetDefinition === undefined
      ? { kind: "unrelated" as const }
      : walk.context.projectTypes.relationship(resolved, targetDefinition);
    if (relation.kind === "ambiguous") {
      appendRustDiagnostic(
        walk,
        "RUST_PROJECT_UPCAST_AMBIGUOUS",
        "The selected project value has more than one exact target heritage instantiation.",
        expression,
        ["target.capability=rust.project-types.upcast"],
      );
      return undefined;
    }
    if (relation.kind === "related" && rustTargetTypeRefEquals(relation.targetType, target)) {
      walk.context.facts.set(expression, rustProjectUpcastFactKey, {
        sourceCarrier: resolved,
        targetCarrier: target,
      }, [{ message: "rust exact project-type upcast" }]);
      projected = target;
      if (!isRustOptionCarrier(expected)) {
        walk.context.facts.set(expression, rustConversionKey, { convertedType: target }, [
          { message: "rust project-type upcast conversion" },
        ]);
      }
    }
  }
  if (expected === undefined || !isRustOptionCarrier(expected)) {
    return projected;
  }
  const inner = rustOptionElementCarrier(expected);
  if (inner === undefined) {
    return resolved;
  }
  if (projected !== undefined && isRustOptionCarrier(projected)) {
    return projected;
  }
  if (walk.context.ast.kindName(expression) === "KindNullKeyword" || isRustNullishSourceCarrier(projected)) {
    const existing = walk.context.facts.get(expression, rustTargetOperationFactKey);
    if (existing === undefined) {
      setRustOperationFact(walk, expression, { kind: "option-none", operationId: "tsonic.rust.option.none" });
    }
    walk.context.facts.set(expression, rustConversionKey, { convertedType: expected }, [
      { message: "rust option none conversion" },
    ]);
    return expected;
  }
  if (projected !== undefined && rustTargetTypeRefEquals(projected, inner)) {
    walk.context.facts.set(expression, rustOptionWrapFactKey, { wrap: true }, [{ message: "rust option wrap" }]);
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
      if (effectiveExpected !== undefined && isRustNumericCarrier(effectiveExpected) &&
        (!isRustIntegerCarrier(effectiveExpected) ||
          selectedSourceLiteralIsRepresentable(
            expression,
            effectiveExpected.name,
            walk.context.ast,
          ))) {
        return setCarrierFact(walk, expression, effectiveExpected);
      }
      if (effectiveExpected !== undefined && isRustIntegerCarrier(effectiveExpected)) {
        appendRustDiagnostic(
          walk,
          "RUST_INTEGER_LITERAL_NOT_EXACT",
          "Integer literal cannot be proven exact for the finalized Rust fixed-width carrier.",
          expression,
          [`target.carrier=${effectiveExpected.name}`],
        );
      }
      return undefined;
    }
    case KindBigIntLiteral: {
      const value = parseSourceBigIntLiteral(walk.context.ast.text(expression));
      if (value === undefined) {
        appendRustDiagnostic(
          walk,
          "RUST_BIGINT_LITERAL_INVALID",
          "BigInt literal text is not one exact TypeScript integer literal.",
          expression,
          ["target.capability=rust.syntax.bigint"],
        );
        return undefined;
      }
      const effectiveExpected = expected !== undefined && isRustOptionCarrier(expected)
        ? rustOptionElementCarrier(expected)
        : expected;
      const carrier = effectiveExpected ?? rustBigIntTargetType();
      if (!isRustBigIntCarrier(carrier)) {
        appendRustDiagnostic(
          walk,
          "RUST_BIGINT_CARRIER_UNSUPPORTED",
          "BigInt literal requires the exact arbitrary-precision Rust BigInt carrier.",
          expression,
          ["target.capability=rust.syntax.bigint"],
        );
        return undefined;
      }
      return setCarrierFact(walk, expression, carrier);
    }
    case KindStringLiteral:
    case KindNoSubstitutionTemplateLiteral: {
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
    case KindTemplateExpression: {
      return resolveTemplateExpressionCarrier(walk, expression, sourceFile);
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
    case "KindSuperKeyword": {
      const superCarrier = walk.currentSuperCarrier;
      return superCarrier === undefined ? undefined : setCarrierFact(walk, expression, superCarrier);
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
    case "KindArrowFunction":
    case KindFunctionExpression: {
      return resolveFunctionExpressionCarrier(walk, expression, sourceFile, expected);
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
    case "KindYieldExpression": {
      const generatorDeclaration = walk.currentGeneratorDeclaration;
      const source = walk.context.semantics(sourceFile).getResolvedYieldInfo(expression);
      if (generatorDeclaration === undefined || source === undefined ||
        source.generator.declaration !== generatorDeclaration) {
        appendRustDiagnostic(
          walk,
          "RUST_GENERATOR_YIELD_EVIDENCE_NOT_PROVEN",
          "Yield lowering requires exact TSTS evidence owned by the active generator declaration.",
          expression,
          ["target.capability=rust.generator.yield"],
        );
        return undefined;
      }
      const generator = walk.context.facts.get(generatorDeclaration, rustGeneratorFactKey);
      if (generator === undefined) {
        appendRustDiagnostic(
          walk,
          "RUST_GENERATOR_YIELD_PROTOCOL_CONFLICT",
          "The exact checked yield evidence conflicts with the active Rust generator protocol.",
          expression,
          ["target.capability=rust.generator.yield"],
        );
        return undefined;
      }
      const yieldType = generator.yieldType;
      const operand = source.operand?.expression;
      const delegatedCarrier = source.yieldKind === "delegate" && operand !== undefined
        ? resolveExpressionCarrier(walk, operand, sourceFile, undefined)
        : undefined;
      const delegatedProtocol = getRustGeneratorProtocol(delegatedCarrier);
      if (source.yieldKind === "delegate" &&
        (delegatedProtocol === undefined ||
          !rustTargetTypeRefEquals(delegatedProtocol.yieldType, generator.yieldType) ||
          !rustTargetTypeRefEquals(delegatedProtocol.nextType, generator.nextType) ||
          !rustTargetTypeRefEquals(delegatedProtocol.returnType, generator.returnType) ||
          (generator.kind === "sync" && delegatedProtocol.kind !== "sync"))) {
        appendRustDiagnostic(
          walk,
          "RUST_GENERATOR_DELEGATION_PROTOCOL_NOT_CLOSED",
          "The checked delegated yield has no compatible closed Rust generator protocol.",
          expression,
          ["target.capability=rust.generator.delegation"],
        );
        return undefined;
      }
      const resultType = source.yieldKind === "value"
        ? generator.nextType
        : delegatedProtocol?.returnType;
      if (resultType === undefined) {
        return undefined;
      }
      if (operand !== undefined) {
        resolveExpressionCarrier(
          walk,
          operand,
          sourceFile,
          source.yieldKind === "value" ? generator.yieldType : delegatedCarrier,
        );
      }
      walk.context.facts.set(expression, rustYieldFactKey, {
        generatorDeclaration,
        kind: source.yieldKind,
        yieldType,
        resultType,
        ...(delegatedCarrier === undefined ? {} : { delegatedCarrier }),
      }, [{ message: "rust checked yield" }]);
      return setCarrierFact(walk, expression, resultType);
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
    case KindSatisfiesExpression:
    case KindNonNullExpression: {
      const inner = Node_Expression(walk.context.ast, expression);
      const carrier = inner === undefined
        ? undefined
        : resolveExpressionCarrier(walk, inner, sourceFile, expected);
      if (carrier === undefined || (kind === KindNonNullExpression && isRustOptionCarrier(carrier))) {
        return undefined;
      }
      const resultCarrier = expected ?? carrier;
      if (!rustTargetTypeRefEquals(carrier, resultCarrier)) {
        return undefined;
      }
      setRustOperationFact(walk, expression, {
        kind: "identity-expression",
        operationId: kind === KindSatisfiesExpression
          ? "tsonic.rust.syntax.satisfies"
          : "tsonic.rust.syntax.non-null-identity",
        resultCarrier,
      });
      return setCarrierFact(walk, expression, resultCarrier);
    }
    case KindConditionalExpression: {
      const condition = ConditionalExpression_Condition(walk.context.ast, expression);
      const whenTrue = ConditionalExpression_WhenTrue(walk.context.ast, expression);
      const whenFalse = ConditionalExpression_WhenFalse(walk.context.ast, expression);
      if (condition === undefined || whenTrue === undefined || whenFalse === undefined) {
        return undefined;
      }
      const conditionCarrier = resolveExpressionCarrier(walk, condition, sourceFile, boolCarrier);
      const semanticCarrier = expected ?? resolveRustTargetTypeRef(
        expression,
        rustResolutionContext(walk, expression),
        walk.operationOptions,
      );
      const trueCarrier = resolveExpressionCarrier(walk, whenTrue, sourceFile, semanticCarrier);
      const falseCarrier = resolveExpressionCarrier(walk, whenFalse, sourceFile, semanticCarrier ?? trueCarrier);
      const resultCarrier = semanticCarrier ?? trueCarrier;
      if (!isRustBoolCarrier(conditionCarrier) || resultCarrier === undefined ||
        trueCarrier === undefined || falseCarrier === undefined ||
        !rustTargetTypeRefEquals(trueCarrier, resultCarrier) ||
        !rustTargetTypeRefEquals(falseCarrier, resultCarrier)) {
        return undefined;
      }
      setRustOperationFact(walk, expression, {
        kind: "conditional",
        operationId: "tsonic.rust.syntax.conditional",
        resultCarrier,
      });
      return setCarrierFact(walk, expression, resultCarrier);
    }
    case KindTypeOfExpression: {
      const operand = Node_Expression(walk.context.ast, expression);
      const operandCarrier = operand === undefined
        ? undefined
        : resolveExpressionCarrier(walk, operand, sourceFile, undefined);
      const result = operand === undefined || operandCarrier === undefined
        ? undefined
        : rustTypeofResult(walk.context.ast, operand, operandCarrier);
      if (result === undefined) {
        appendRustDiagnostic(
          walk,
          "RUST_TYPEOF_CARRIER_UNSUPPORTED",
          "typeof requires one exact closed Rust carrier with preserved TypeScript runtime category.",
          expression,
          ["target.capability=rust.syntax.typeof"],
        );
        return undefined;
      }
      const resultCarrier = rustStringTargetType();
      setRustOperationFact(walk, expression, {
        kind: "typeof",
        operationId: `tsonic.rust.syntax.typeof.${result}`,
        resultCarrier,
        result,
      });
      return setCarrierFact(walk, expression, resultCarrier);
    }
    case KindVoidExpression: {
      const operand = Node_Expression(walk.context.ast, expression);
      const operandCarrier = operand === undefined
        ? undefined
        : resolveExpressionCarrier(walk, operand, sourceFile, undefined);
      if (operand === undefined || operandCarrier === undefined) {
        appendRustDiagnostic(
          walk,
          "RUST_VOID_OPERAND_UNSUPPORTED",
          "void requires one exact operand with a finalized Rust runtime carrier.",
          expression,
          ["target.capability=rust.syntax.void"],
        );
        return undefined;
      }
      const resultCarrier = rustUndefinedTargetType();
      const operationId = "tsonic.rust.syntax.void";
      setRustOperationFact(walk, expression, {
        kind: "void-expression",
        operationId,
        resultCarrier,
      });
      recordTargetOperation(
        walk,
        expression,
        operationId,
        "operator",
        "void",
        resultCarrier,
      );
      return setCarrierFact(walk, expression, resultCarrier);
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

function resolveTemplateExpressionCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
): TargetTypeRef | undefined {
  const spans = TemplateExpression_TemplateSpans(walk.context.ast, expression);
  if (spans === undefined || !isDenseDataArray(spans) || spans.some((span) => span === undefined)) {
    appendRustDiagnostic(
      walk,
      "RUST_TEMPLATE_STRUCTURE_INVALID",
      "Template expression requires a dense checked template-span sequence.",
      expression,
      ["target.capability=rust.syntax.template"],
    );
    return undefined;
  }
  const substitutions: { expression: Node; carrier: TargetTypeRef }[] = [];
  for (const span of spans as readonly Node[]) {
    const substitution = TemplateSpan_Expression(walk.context.ast, span);
    const carrier = substitution === undefined
      ? undefined
      : resolveExpressionCarrier(walk, substitution, sourceFile, undefined);
    if (substitution === undefined || carrier === undefined ||
      !isRustSourceStringConvertibleCarrier(carrier)) {
      appendRustDiagnostic(
        walk,
        "RUST_TEMPLATE_SUBSTITUTION_UNSUPPORTED",
        "Template substitution requires an exact closed primitive, string, or undefined carrier.",
        span,
        ["target.capability=rust.syntax.template"],
      );
      return undefined;
    }
    substitutions.push({ expression: substitution, carrier });
  }
  const resultCarrier = rustStringTargetType();
  setRustOperationFact(walk, expression, {
    kind: "template-string",
    operationId: "tsonic.rust.syntax.template-string",
    resultCarrier,
    substitutions,
  });
  return setCarrierFact(walk, expression, resultCarrier);
}

function rustTypeofResult(
  ast: AstReader,
  operand: Node,
  carrier: TargetTypeRef,
): Extract<RustTargetOperationFact, { readonly kind: "typeof" }>["result"] | undefined {
  if (ast.kindName(operand) === "KindNullKeyword") {
    return "object";
  }
  if (carrier.kind === "source-primitive") {
    if (carrier.name === "bool") {
      return "boolean";
    }
    if (carrier.name === "int64" || carrier.name === "uint64") {
      return "bigint";
    }
    return isRustNumericCarrier(carrier) ? "number" : undefined;
  }
  if (isRustStringCarrier(carrier)) {
    return "string";
  }
  if (isRustBigIntCarrier(carrier)) {
    return "bigint";
  }
  if (isRustUnitCarrier(carrier) || isRustUndefinedCarrier(carrier)) {
    return "undefined";
  }
  if (carrier.kind === "function-pointer") {
    return "function";
  }
  const sourceType = rustSourceTypeCarrierValue(carrier);
  if (sourceType?.shape === "enum" || isRustNullishSourceCarrier(carrier) ||
    carrier.kind === "type-parameter" || carrier.kind === "associated-type") {
    return undefined;
  }
  return "object";
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
    const rightSemanticCarrier = resolveRustTargetTypeRef(
      rightNode,
      rustResolutionContext(walk, rightNode),
      walk.operationOptions,
    );
    const right = resolveExpressionCarrier(
      walk,
      rightNode,
      sourceFile,
      isRustNullishSourceCarrier(rightSemanticCarrier)
        ? undefined
        : operandExpected ?? rightSemanticCarrier,
    );
    const left = resolveExpressionCarrier(
      walk,
      leftNode,
      sourceFile,
      isRustNullishSourceCarrier(rightSemanticCarrier) ? undefined : right ?? operandExpected,
    );
    return { left, right, leftNode, rightNode, operatorKind };
  }
  const leftSemanticCarrier = resolveRustTargetTypeRef(
    leftNode,
    rustResolutionContext(walk, leftNode),
    walk.operationOptions,
  );
  let left = resolveExpressionCarrier(
    walk,
    leftNode,
    sourceFile,
    operandExpected ?? leftSemanticCarrier,
  );
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
  return kind === KindNumericLiteral || kind === KindBigIntLiteral || kind === KindStringLiteral;
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
  const leftOptionElement = rustOptionElementCarrier(left);
  const rightOptionElement = rustOptionElementCarrier(right);
  const optionValueOperand = leftOptionElement !== undefined && right !== undefined &&
      rustTargetTypeRefEquals(leftOptionElement, right)
    ? "left" as const
    : rightOptionElement !== undefined && left !== undefined &&
        rustTargetTypeRefEquals(rightOptionElement, left)
      ? "right" as const
      : undefined;
  let fact: RustTargetOperationFact | undefined;
  if (operatorKind === KindQuestionQuestionToken) {
    const inner = rustOptionElementCarrier(left);
    if (inner !== undefined && right !== undefined &&
      rustTargetTypeRefEquals(inner, right)) {
      fact = {
        kind: "option-coalesce",
        operationId: "tsonic.rust.option.coalesce",
      };
    } else if (inner !== undefined && isRustNullishSourceCarrier(right) && left !== undefined) {
      fact = {
        kind: "nullish-identity",
        operationId: "tsonic.rust.option.coalesce-nullish-identity",
        resultCarrier: left,
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
  } else if ((operatorKind === KindEqualsEqualsEqualsToken ||
      operatorKind === KindExclamationEqualsEqualsToken) &&
    isRustOptionCarrier(left) && isRustOptionCarrier(right) &&
    rustTargetTypeRefEquals(left, right)) {
    fact = {
      kind: "operator-token",
      operationId: operatorKind === KindExclamationEqualsEqualsToken
        ? "tsonic.rust.option.not-equal"
        : "tsonic.rust.option.equal",
      operator: operatorKind === KindExclamationEqualsEqualsToken ? "!=" : "==",
      resultCarrier: rustSourcePrimitiveTargetType("bool"),
    };
  } else if ((operatorKind === KindEqualsEqualsEqualsToken ||
      operatorKind === KindExclamationEqualsEqualsToken) && optionValueOperand !== undefined) {
    fact = {
      kind: "option-value-equality",
      operationId: operatorKind === KindExclamationEqualsEqualsToken
        ? "tsonic.rust.option.value-not-equal"
        : "tsonic.rust.option.value-equal",
      negated: operatorKind === KindExclamationEqualsEqualsToken,
      optionOperand: optionValueOperand,
    };
  } else if (operatorKind === KindEqualsToken &&
    (selectedLeftOperation === undefined || rustTargetOperationSupportsAssignment(selectedLeftFact)) &&
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
              leftConversion: binary.leftConversion,
              rightConversion: binary.rightConversion,
            };
      }
    }
  }
  if (fact === undefined) {
    walk.postCheckOperations.delete(expression);
    if (operatorKind === KindEqualsToken && selectedLeftOperation !== undefined &&
      !rustTargetOperationSupportsAssignment(selectedLeftFact)) {
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
  _sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const pendingKind = walk.postCheckOperations.get(expression);
  const operand = Node_Operand(walk.context.ast, expression);
  const fixedWidthLiteral = expected?.kind === "source-primitive" &&
    isRustNumericCarrier(expected) &&
    selectedSourceLiteralIsRepresentable(expression, expected.name, walk.context.ast);
  const bigintLiteral = isRustBigIntCarrier(expected) && operand !== undefined &&
    walk.context.ast.kindName(operand) === KindBigIntLiteral &&
    parseSourceBigIntLiteral(walk.context.ast.text(operand)) !== undefined;
  if ((pendingKind !== "unary-minus" && pendingKind !== "unary-plus") ||
    expected === undefined || (!fixedWidthLiteral && !bigintLiteral)) {
    return undefined;
  }
  if (operand === undefined) {
    return undefined;
  }
  setCarrierFact(walk, operand, expected);
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
    if (declarationKind === KindParameter) {
      const parameterAbi = walk.context.facts.get(declaration, rustSourceParameterAbiFactKey) ??
        walk.context.facts.resolve(declaration, rustSourceParameterAbiFactKey);
      if (parameterAbi !== undefined) {
        walk.context.facts.set(identifier, rustSourceParameterAbiFactKey, parameterAbi, [
          { message: "rust project-source parameter ABI use" },
        ]);
      }
    }
    const declarationCarrier = walk.context.facts.get(declaration, rustRuntimeCarrierKey);
    if (declarationCarrier !== undefined) {
      return setCarrierFact(walk, identifier, declarationCarrier.carrier);
    }
    if (declarationKind === KindParameter || declarationKind === KindVariableDeclaration ||
      declarationKind === KindBindingElement) {
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
    if (declarationKind === KindFunctionDeclaration) {
      const parameters = ast.parameters(declaration);
      const parameterAbis = parameters.map((parameter) => parameter === undefined
        ? undefined
        : walk.context.facts.get(parameter, rustSourceParameterAbiFactKey) ??
          walk.context.facts.resolve(parameter, rustSourceParameterAbiFactKey));
      const returnCarrier = walk.context.facts.get(declaration, rustSourceCallableReturnFactKey)?.returnCarrier ??
        walk.context.facts.resolve(declaration, rustSourceCallableReturnFactKey)?.returnCarrier;
      const name = ast.name(declaration);
      if (name !== undefined && parameterAbis.every((abi) => abi !== undefined) &&
        returnCarrier !== undefined) {
        const closedParameterAbis = parameterAbis as import("../rust-facts/keys.js").RustSourceParameterAbiFact[];
        const callableCarrier = rustCallableTargetType(
          closedParameterAbis.map((abi) => abi.parameterCarrier.kind === "pointer"
            ? abi.parameterCarrier.pointee
            : abi.parameterCarrier),
          returnCarrier,
        );
        walk.context.facts.set(identifier, rustSourceCallableValueFactKey, {
          form: "function",
          fileName: ast.getFileName(ast.getSourceFile(declaration)),
          name: ast.text(name),
          carrier: callableCarrier,
          parameterCarriers: closedParameterAbis.map((abi) => abi.parameterCarrier),
          argumentModes: closedParameterAbis.map((abi) => abi.mode),
          resultCarrier: returnCarrier,
        }, [{ message: "rust exact project-source callable value" }]);
        return setCarrierFact(walk, identifier, callableCarrier);
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
  const declarationParameters = ast.kindName(selectedDeclaration) === "KindClassDeclaration"
    ? []
    : ast.parameters(selectedDeclaration);
  const parameters: import("../rust-facts/keys.js").RustSourceCallParameterPlan[] = [];
  for (const [index, targetParameter] of selectedMember.parameters.entries()) {
    const selectedParameter = selectedParameters[index];
    const parameterDeclaration = asSourceNode(
      selectedParameter?.parameterDeclaration,
      ast,
    ) ?? declarationParameters[index];
    const parameterAbi = parameterDeclaration === undefined
      ? undefined
      : walk.context.facts.get(parameterDeclaration, rustSourceParameterAbiFactKey) ??
        walk.context.facts.resolve(parameterDeclaration, rustSourceParameterAbiFactKey);
    if (selectedParameter === undefined || selectedParameter.parameterIndex !== index ||
      parameterAbi === undefined) {
      appendRustDiagnostic(
        walk,
        "RUST_SOURCE_CALL_PARAMETER_MISSING",
        `Project-source call selects unavailable parameter ${index}.`,
        expression,
        ["target.capability=rust.source-call.argument-bindings"],
      );
      return undefined;
    }
    if ((parameterAbi.form === "rest") !== selectedParameter.rest ||
      ((parameterAbi.form !== "required") !==
        selectedParameter.acceptsOmission)) {
      appendRustDiagnostic(
        walk,
        "RUST_SOURCE_CALL_PARAMETER_FORM_CONFLICT",
        `Project-source parameter ${index} conflicts with its exact checker-selected omission or rest evidence.`,
        parameterDeclaration ?? expression,
        ["target.capability=rust.source-call.parameter-form"],
      );
      return undefined;
    }
    const parameterCarrier = substituteRustTargetTypeParameters(targetParameter.type, substitutions);
    const valueCarrier = substituteRustTargetTypeParameters(parameterAbi.valueCarrier, substitutions);
    const mode = targetParameter.passingMode === "borrow-mut"
      ? "mut-ref" as const
      : targetParameter.passingMode === "borrow-shared"
        ? "ref" as const
        : "value" as const;
    const parameterInputs = bindings.filter((binding) => binding.sourceParameterIndex === index);
    const inputs = parameterInputs.map((binding) => {
      const carrier = parameterAbi.form === "rest" &&
          binding.sourceParameterForm === "rest-element"
        ? valueCarrier.kind === "array" ? valueCarrier.element : undefined
        : parameterAbi.form === "optional" || parameterAbi.form === "default"
          ? parameterCarrier
          : valueCarrier;
      return carrier === undefined
        ? undefined
        : {
            sourceArgumentIndex: binding.sourceArgumentIndex,
            sourceForm: binding.sourceForm,
            sourceParameterForm: binding.sourceParameterForm,
            carrier,
            ...(binding.spreadElementIndex === undefined
              ? {}
              : { spreadElementIndex: binding.spreadElementIndex }),
          };
    });
    if (inputs.some((input) => input === undefined) ||
      (parameterAbi.form !== "rest" && inputs.length > 1) ||
      (parameterAbi.form === "required" && inputs.length !== 1)) {
      appendRustDiagnostic(
        walk,
        "RUST_SOURCE_CALL_PARAMETER_BINDING_CONFLICT",
        `Project-source parameter ${index} has no total exact effective-argument plan.`,
        parameterDeclaration ?? expression,
        ["target.capability=rust.source-call.parameter-bindings"],
      );
      return undefined;
    }
    parameters.push({
      form: parameterAbi.form,
      valueCarrier,
      parameterCarrier,
      mode,
      inputs: inputs as NonNullable<(typeof inputs)[number]>[],
    });
  }
  for (const [index, argument] of (callArguments as readonly Node[]).entries()) {
    const argumentBindings = bindings.filter((binding) => binding.sourceArgumentIndex === index);
    if (argumentBindings.length === 0) {
      appendRustDiagnostic(
        walk,
        "RUST_SOURCE_CALL_BINDING_MISSING",
        `Project-source argument ${index} has no exact selected parameter binding.`,
        argument,
        ["target.capability=rust.source-call.argument-bindings"],
      );
      return undefined;
    }
    const bindingCarriers = parameters.flatMap((parameter) =>
      parameter.inputs.filter((input) => input.sourceArgumentIndex === index).map((input) => input.carrier));
    const expected = bindingCarriers.length > 0 && bindingCarriers.every((carrier) =>
      rustTargetTypeRefEquals(carrier, bindingCarriers[0]))
      ? bindingCarriers[0]
      : undefined;
    resolveExpressionCarrier(walk, argument, sourceFile, expected);
    const parameterIndexes = [...new Set(argumentBindings.map((binding) => binding.sourceParameterIndex))];
    const modes = parameterIndexes.map((parameterIndex) => parameters[parameterIndex]?.mode);
    if (modes.some((mode) => mode === undefined) || modes.some((mode) => mode !== modes[0])) {
      appendRustDiagnostic(
        walk,
        "RUST_SOURCE_CALL_ARGUMENT_MODE_CONFLICT",
        `Project-source argument ${index} spans incompatible target parameter modes.`,
        argument,
        ["target.capability=rust.source-call.argument-modes"],
      );
      return undefined;
    }
    const mode = modes[0]!;
    const passingMode = rustArgumentPassingMode(mode);
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
  const calleeReferenceDeclaration = walk.context.source.navigation.sourceReferenceFor(callee)?.declaration;
  const callableCalleeCarrier = expressionKind === KindNewExpression
    ? undefined
    : resolveExpressionCarrier(walk, callee, sourceFile, undefined);
  const optionalCall = walk.context.facts.get(expression, rustOptionalChainFactKey) ??
    walk.context.facts.resolve(expression, rustOptionalChainFactKey);
  const selectedCallableCarrier = optionalCall?.selectedGuardCarrier ?? callableCalleeCarrier;
  const indirectCallable = selectedCallableCarrier !== undefined &&
    (selectedCallableCarrier.kind === "function-pointer" ||
      rustCallableProtocol(selectedCallableCarrier) !== undefined) &&
    (calleeReferenceDeclaration !== selectedDeclaration ||
      ast.kindName(callee) === "KindArrowFunction" || ast.kindName(callee) === KindFunctionExpression);
  if (indirectCallable) {
    target = { form: "callable", carrier: selectedCallableCarrier };
  } else if (expressionKind === KindNewExpression || declarationKind === "KindConstructor") {
    target = {
      form: "constructor",
      name: selectedMember.targetName,
      typeCarrier: resultCarrier,
    };
    operationKind = "constructor";
  } else if (declarationKind === "KindMethodDeclaration" ||
    declarationKind === "KindMethodSignature") {
    const methodName = rustProjectCallableTargetName(selectedDeclaration, walk.context);
    if (methodName === undefined) {
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
      const receiverCarrier = resolveExpressionCarrier(
        walk,
        receiver,
        sourceFile,
        undefined,
      );
      const selfMode = walk.context.facts.get(selectedDeclaration, rustSelfModeFactKey) ??
        walk.context.facts.resolve(selectedDeclaration, rustSelfModeFactKey);
      if (selfMode === undefined) {
        return undefined;
      }
      const mutatesSelf = selfMode.mode === "mut-ref";
      if (mutatesSelf) {
        recordBindingWrite(walk, receiver, "referent");
      }
      const owner = walk.context.projectTypes.definitionContainingDeclaration(selectedDeclaration);
      const ownerRelationship = owner === undefined || receiverCarrier === undefined
        ? undefined
        : walk.context.projectTypes.relationship(receiverCarrier, owner);
      const ownerCarrier = ownerRelationship?.kind === "related"
        ? ownerRelationship.targetType
        : undefined;
      const virtualSlot = owner !== undefined && walk.context.projectTypes.isPolymorphic(owner)
        ? rustProjectMemberSlotName(ast, selectedDeclaration, "virtual")
        : undefined;
      const exactSlot = virtualSlot === undefined
        ? undefined
        : rustProjectMemberSlotName(ast, selectedDeclaration, "exact");
      if (owner !== undefined && walk.context.projectTypes.isPolymorphic(owner) &&
        (virtualSlot === undefined || exactSlot === undefined || ownerCarrier === undefined)) {
        return undefined;
      }
      const receiverKind = ast.kindName(receiver);
      target = {
        form: "method",
        name: methodName,
        mutatesSelf,
        ...(virtualSlot === undefined || exactSlot === undefined
          ? {}
          : {
              dispatch: {
                virtualSlot,
                exactSlot,
                selected: receiverKind === "KindSuperKeyword" ? "exact" : "virtual",
                ownerCarrier: ownerCarrier!,
              },
            }),
      };
    }
  } else if (declarationKind === KindFunctionDeclaration) {
    const name = ast.text(ast.name(selectedDeclaration));
    const fileName = ast.getFileName(ast.getSourceFile(selectedDeclaration));
    if (name.length === 0 || fileName.length === 0) {
      return undefined;
    }
    target = { form: "function", fileName, name };
  } else if (declarationKind === "KindFunctionType" ||
    declarationKind === "KindCallSignature" ||
    declarationKind === "KindArrowFunction" ||
    declarationKind === KindFunctionExpression) {
    const calleeCarrier = selectedCallableCarrier;
    if (calleeCarrier === undefined ||
      (calleeCarrier.kind !== "function-pointer" && rustCallableProtocol(calleeCarrier) === undefined)) {
      return undefined;
    }
    target = { form: "callable", carrier: calleeCarrier };
  }
  if (target === undefined) {
    return undefined;
  }
  if (optionalCall !== undefined &&
    (!rustTargetTypeRefEquals(optionalCall.innerResultCarrier, resultCarrier) ||
      optionalCall.operationKind !== "method")) {
    appendRustDiagnostic(
      walk,
      "RUST_OPTIONAL_CALL_RESULT_CONFLICT",
      "The finalized optional call conflicts with the exact selected project-source result carrier.",
      expression,
      ["target.capability=rust.optional-call.exact-result"],
    );
    return undefined;
  }
  const finalResultCarrier = optionalCall?.resultCarrier ?? resultCarrier;
  recordTargetOperation(
    walk,
    expression,
    operationId,
    operationKind,
    target.form,
    finalResultCarrier,
  );
  setRustOperationFact(walk, expression, {
    kind: "source-call",
    operationId,
    target,
    parameters,
    ...(targetTypeArguments.length === 0 ? {} : { targetTypeArguments }),
    resultCarrier,
  });
  return setCarrierFact(walk, expression, finalResultCarrier);
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
    const argumentTarget = inferred.get(source.typeParameterName);
    if (argumentTarget !== undefined && !rustTargetTypeRefEquals(argumentTarget, contextualTarget)) {
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
    const actual = walk.context.facts.getRuntimeCarrierFact(argument)?.carrier ??
      resolveProjectSourceInferenceCarrier(walk, argument);
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

function resolveProjectSourceInferenceCarrier(
  walk: RustFactWalk,
  argument: Node,
): TargetTypeRef | undefined {
  const kind = walk.context.ast.kindName(argument);
  if (kind !== KindIdentifier && kind !== KindCallExpression &&
    kind !== KindNewExpression && kind !== KindPropertyAccessExpression &&
    kind !== KindElementAccessExpression && kind !== KindBinaryExpression &&
    kind !== KindPrefixUnaryExpression && kind !== KindPostfixUnaryExpression &&
    kind !== KindParenthesizedExpression && kind !== KindNonNullExpression &&
    kind !== KindSatisfiesExpression && kind !== "KindAsExpression" &&
    kind !== "KindTypeAssertionExpression") {
    return undefined;
  }
  return resolveRustTargetTypeRef(
    argument,
    rustOperationContext(walk, argument),
    walk.operationOptions,
  );
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
  resultType: TargetTypeRef,
): void {
  walk.context.facts.set(
    expression,
    rustSelectedOperationKey,
    { operationId, operationKind, targetOperation, resultType },
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
    }
    return;
  }
  if (kind === KindVoidExpression) {
    const operand = Node_Expression(ast, expression);
    if (operand !== undefined) {
      resolveExpressionCarrier(walk, operand, sourceFile, undefined);
    }
    return;
  }
  if (kind === KindDeleteExpression) {
    const operand = Node_Expression(ast, expression);
    const receiver = operand === undefined ? undefined : Node_Expression(ast, operand);
    const index = operand === undefined
      ? undefined
      : ElementAccessExpression_ArgumentExpression(ast, operand);
    if (receiver !== undefined) {
      resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
      if (fact?.kind === "provider-operation" &&
        fact.abi.targetReceiver.kind === "input" &&
        fact.abi.targetReceiver.input.mode === "mut-ref") {
        recordBindingWrite(walk, receiver, "referent");
      }
    }
    if (index !== undefined) {
      resolveExpressionCarrier(
        walk,
        index,
        sourceFile,
        fact?.kind === "provider-operation"
          ? fact.abi.sourceArguments[0]?.carrier
          : undefined,
      );
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
      const finalizedProviderArgument = fact?.kind === "provider-operation"
        ? fact.abi.sourceArguments.find((candidate) => candidate.sourceIndex === index)
        : undefined;
      const sourceCallCarriers = fact?.kind === "source-call"
        ? fact.parameters.flatMap((parameter) =>
            parameter.inputs.filter((input) => input.sourceArgumentIndex === index).map((input) => input.carrier))
        : [];
      const finalizedArgumentCarrier = fact?.kind === "source-call"
        ? sourceCallCarriers.length > 0 && sourceCallCarriers.every((carrier) =>
            rustTargetTypeRefEquals(carrier, sourceCallCarriers[0]))
          ? sourceCallCarriers[0]
          : undefined
        : fact?.kind === "provider-operation"
          ? finalizedProviderArgument?.carrier
          : selectedCall?.member.parameters[index]?.type;
      resolveExpressionCarrier(
        walk,
        argument,
        sourceFile,
        finalizedArgumentCarrier,
      );
      if (fact?.kind !== "provider-operation") {
        continue;
      }
      const mode = finalizedProviderArgument?.mode;
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
  const lane: "native" | "js" = walk.jsEnabled ? "js" : "native";
  if (expected !== undefined && isRustVecCarrier(expected)) {
    expectedElement = expected.element;
  } else if (expected?.kind === "target-named" && isRustJsArrayCarrier(expected)) {
    expectedElement = expected.typeArguments?.[0];
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
  if (hasHoles && lane === "native") {
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
  const resultCarrier = lane === "js"
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
      source,
    }, rustOperationContext(walk, statement), walk.operationOptions));
  }
  const selected = walk.context.facts.get(statement, rustTargetOperationFactKey);
  if (selected?.kind === "iteration") {
    const initializer = ForInOrOfStatement_Initializer(walk.context.ast, statement);
    if (initializer !== undefined) {
      if (walk.context.ast.kindName(initializer) === KindIdentifier) {
        const declaration = walk.context.source.navigation.sourceReferenceFor(initializer)?.declaration;
        if (declaration !== undefined) {
          walk.context.facts.set(declaration, rustMutatedBindingFactKey, { mutated: true }, [
            { message: "rust selected iteration assignment writes the existing binding" },
          ]);
        }
      }
      for (const declaration of collectDescendantsOfKind(walk, initializer, KindVariableDeclaration)) {
        setCarrierFact(walk, declaration, selected.elementCarrier);
        const name = Node_Name(walk.context.ast, declaration);
        const nameKind = name === undefined ? "" : walk.context.ast.kindName(name);
        if (name !== undefined && (nameKind === KindArrayBindingPattern || nameKind === KindObjectBindingPattern) &&
          !recordBindingPatternFacts(walk, name, selected.elementCarrier)) {
          appendRustDiagnostic(
            walk,
            "RUST_BINDING_PATTERN_NOT_CLOSED",
            "Iteration binding pattern has no total Rust projection from its exact finalized element carrier.",
            name,
            ["target.capability=rust.binding-pattern.iteration"],
          );
        }
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
  const definition = walk.context.projectTypes.definitionForDeclaration(declaration);
  return definition === undefined
    ? walk.sourceTypes.carrierForDeclaration(declaration, walk.context.ast)
    : walk.context.projectTypes.openCarrier(definition);
}

function recordMethodSelfModeFacts(walk: RustFactWalk, sourceFiles: readonly SourceFile[]): void {
  const { ast } = walk.context;
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
          walk.context.facts.set(member, rustSelfModeFactKey, { mode: "ref" }, [
            { message: "rust reference-backed project object method self mode" },
          ]);
        }
      }
    }
  }
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
      if (memberKind === "KindMethodDeclaration") {
        recordCallableSuspensionFacts(walk, member);
        recordCallableReturnFact(walk, member);
      }
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
  const previousSuper = walk.currentSuperCarrier;
  walk.currentThisCarrier = classCarrier;
  const definition = walk.context.projectTypes.definitionForDeclaration(declaration);
  walk.currentSuperCarrier = definition === undefined
    ? undefined
    : walk.context.projectTypes.heritageForDefinition(definition).find((edge) =>
        edge.kind === "extends" && edge.target.kind === "class")?.targetType;
  const members = requireDenseSourceNodes(walk, ast.members(declaration), "Class declaration contains an undefined or non-data member slot.");
  if (members === undefined) {
    walk.currentThisCarrier = previousThis;
    walk.currentSuperCarrier = previousSuper;
    return;
  }
  for (const member of members) {
    const memberKind = ast.kindName(member);
    if (memberKind === "KindPropertyDeclaration") {
      const initializer = Node_Initializer(ast, member);
      const fieldCarrier = walk.context.facts.get(member, rustRuntimeCarrierKey)?.carrier ??
        resolveTypeNodeCarrier(walk, Node_Type(ast, member));
      if (initializer !== undefined && fieldCarrier !== undefined) {
        resolveExpressionCarrier(walk, initializer, sourceFile, fieldCarrier);
      }
      continue;
    }
    if (memberKind === "KindConstructor" || memberKind === "KindMethodDeclaration") {
      const asyncFact = walk.context.facts.get(member, rustAsyncFunctionFactKey);
      const generatorFact = walk.context.facts.get(member, rustGeneratorFactKey);
      const returnCarrier = memberKind === "KindMethodDeclaration"
        ? generatorFact?.returnType ?? asyncFact?.outputCarrier ??
          walk.context.facts.get(member, rustSourceCallableReturnFactKey)?.returnCarrier
        : undefined;
      const previousMethod = walk.currentMethodDeclaration;
      const previousCallable = walk.currentCallableDeclaration;
      const previousGenerator = walk.currentGeneratorDeclaration;
      walk.currentMethodDeclaration = memberKind === "KindMethodDeclaration" ? member : undefined;
      walk.currentCallableDeclaration = member;
      walk.currentGeneratorDeclaration = generatorFact === undefined ? undefined : member;
      const body = ast.body(member);
      if (body !== undefined) {
        const statements = requireDenseSourceNodes(walk, ast.statements(body), "Class callable body contains an undefined or non-data statement slot.");
        if (statements === undefined) {
          walk.currentMethodDeclaration = previousMethod;
          walk.currentCallableDeclaration = previousCallable;
          walk.currentGeneratorDeclaration = previousGenerator;
          walk.currentThisCarrier = previousThis;
          walk.currentSuperCarrier = previousSuper;
          return;
        }
        for (const statement of statements) {
          recordStatementFacts(walk, statement, sourceFile, returnCarrier);
        }
      }
      walk.currentMethodDeclaration = previousMethod;
      walk.currentCallableDeclaration = previousCallable;
      walk.currentGeneratorDeclaration = previousGenerator;
    }
  }
  walk.currentThisCarrier = previousThis;
  walk.currentSuperCarrier = previousSuper;
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
    const memberKind = ast.kindName(member);
    if (memberKind === "KindPropertySignature") {
      const fieldCarrier = resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, member));
      if (fieldCarrier !== undefined) {
        setCarrierFact(walk, member, fieldCarrier);
      }
    } else if (memberKind === "KindMethodSignature") {
      walk.context.facts.set(member, rustSelfModeFactKey, { mode: "ref" }, [
        { message: "rust reference-backed project interface method self mode" },
      ]);
      recordCallableReturnFact(walk, member);
      const parameters = requireDenseSourceNodes(
        walk,
        ast.parameters(member),
        "Interface method contains an undefined or non-data parameter slot.",
      );
      if (parameters === undefined) {
        return;
      }
      for (const parameter of parameters) {
        recordParameterAbiFacts(walk, parameter);
      }
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
  if (value === undefined || value.shape !== "object" || expected === undefined) {
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
  const layout = rustProjectObjectLayout(shapeDeclaration, ast);
  if (layout?.kind !== "interface") {
    return undefined;
  }
  const fields: { sourceName: string; storageIndex: number }[] = [];
  for (const field of layout.fields) {
    const property = propertiesByName.get(field.sourceName);
    if (property === undefined) {
      return undefined;
    }
    const expectedField = walk.context.facts.get(field.declaration, rustRuntimeCarrierKey)?.carrier ??
      resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, field.declaration));
    const initializer = Node_Initializer(walk.context.ast, property);
    if (expectedField === undefined || initializer === undefined ||
      resolveExpressionCarrier(walk, initializer, sourceFile, expectedField) === undefined) {
      return undefined;
    }
    fields.push({ sourceName: field.sourceName, storageIndex: field.storageIndex });
  }
  if (fields.length !== propertiesByName.size) {
    return undefined;
  }
  setRustOperationFact(walk, expression, {
    kind: "record-literal",
    operationId: "tsonic.rust.record.literal",
    resultCarrier: expected,
    fields,
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
  setParameterAbiFact(walk, parameter, parameterAbi);
  if (!recordDefaultParameterInitializerFacts(walk, parameter, parameterAbi)) {
    return;
  }
  const name = Node_Name(walk.context.ast, parameter);
  const nameKind = name === undefined ? "" : walk.context.ast.kindName(name);
  if (name !== undefined && (nameKind === KindArrayBindingPattern || nameKind === KindObjectBindingPattern) &&
    !recordBindingPatternFacts(walk, name, parameterAbi.valueCarrier)) {
    appendRustDiagnostic(
      walk,
      "RUST_BINDING_PATTERN_NOT_CLOSED",
      "Parameter binding pattern has no total Rust projection from its exact finalized source carrier.",
      name,
      ["target.capability=rust.binding-pattern.parameter"],
    );
  }
}

function recordBindingPatternFacts(
  walk: RustFactWalk,
  pattern: Node,
  sourceCarrier: TargetTypeRef,
): boolean {
  return recordRustBindingPatternFacts(pattern, sourceCarrier, {
    ast: walk.context.ast,
    facts: walk.context.facts,
    sourceTypes: walk.sourceTypes,
    resolveCarrier: (subject) => resolveRustTargetTypeRef(
      subject,
      rustResolutionContext(walk, subject),
      walk.operationOptions,
    ),
    resolveExpressionCarrier: (expression, expected) => resolveExpressionCarrier(
      walk,
      expression,
      walk.context.semanticsFor(expression).sourceFile,
      expected,
    ),
    setCarrier: (subject, carrier) => {
      setCarrierFact(walk, subject, carrier);
    },
  });
}

function setParameterAbiFact(
  walk: RustFactWalk,
  parameter: Node,
  abi: import("./source-callable-abi.js").RustSourceParameterAbi,
): void {
  walk.context.facts.set(parameter, rustSourceParameterAbiFactKey, {
    form: abi.form,
    valueCarrier: abi.valueCarrier,
    parameterCarrier: abi.parameterCarrier,
    mode: abi.mode,
  }, [
    { message: "rust finalized source parameter ABI" },
  ]);
}

function recordDefaultParameterInitializerFacts(
  walk: RustFactWalk,
  parameter: Node,
  abi: import("./source-callable-abi.js").RustSourceParameterAbi,
): boolean {
  if (abi.form !== "default") {
    return true;
  }
  const initializer = Node_Initializer(walk.context.ast, parameter);
  const resolved = initializer === undefined
    ? undefined
    : resolveExpressionCarrier(
        walk,
        initializer,
        walk.context.semanticsFor(initializer).sourceFile,
        abi.valueCarrier,
      );
  if (initializer !== undefined && resolved !== undefined &&
    rustTargetTypeRefEquals(resolved, abi.valueCarrier)) {
    return true;
  }
  appendRustDiagnostic(
    walk,
    "RUST_DEFAULT_PARAMETER_INITIALIZER_CARRIER_UNSUPPORTED",
    "Default parameter initializer does not have the exact finalized Rust value carrier.",
    initializer ?? parameter,
    ["target.capability=rust.callable.default-parameter"],
  );
  return false;
}

function recordBindingWrite(walk: RustFactWalk, target: Node | undefined, writeKind: "binding" | "referent" = "binding"): void {
  if (target === undefined) {
    return;
  }
  const { ast } = walk.context;
  const kind = ast.kindName(target);
  if (kind === KindPropertyAccessExpression || kind === KindElementAccessExpression) {
    const operation = walk.context.facts.get(target, rustTargetOperationFactKey) ??
      walk.context.facts.resolve(target, rustTargetOperationFactKey);
    if (operation?.kind === "source-field") {
      return;
    }
    const receiver = Node_Expression(walk.context.ast, target);
    const receiverKind = receiver === undefined ? "" : ast.kindName(receiver);
    if (receiverKind === "KindThisExpression" || receiverKind === "KindThisKeyword") {
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

function recordAssignmentWrite(
  walk: RustFactWalk,
  expression: Node,
  target: Node | undefined,
): void {
  const targetKind = target === undefined ? "" : walk.context.ast.kindName(target);
  const operation = walk.context.facts.get(expression, rustTargetOperationFactKey);
  if ((targetKind === KindPropertyAccessExpression || targetKind === KindElementAccessExpression) &&
    operation?.kind === "runtime-set" && operation.abi.targetReceiver.kind === "input" &&
    operation.abi.targetReceiver.input.mode === "ref") {
    return;
  }
  recordBindingWrite(walk, target);
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
interface RustFutureOperationOrigin {
  readonly expression: Node;
  readonly operation: RustTargetOperationFact;
}

function resolveFutureOperationOrigin(
  walk: RustFactWalk,
  node: Node,
  resolving = new Set<Node>(),
): RustFutureOperationOrigin | undefined {
  if (resolving.has(node)) {
    return undefined;
  }
  resolving.add(node);
  try {
    const operation = walk.context.facts.get(node, rustTargetOperationFactKey) ??
      walk.context.facts.resolve(node, rustTargetOperationFactKey);
    if ((operation?.kind === "provider-operation" && operation.abi.result.kind === "async") ||
      (operation?.kind === "source-call" && rustFutureOutputCarrier(operation.resultCarrier) !== undefined)) {
      return { expression: node, operation };
    }
    const kind = walk.context.ast.kindName(node);
    if (kind === KindParenthesizedExpression || kind === "KindAsExpression" ||
      kind === "KindTypeAssertionExpression") {
      const operand = Node_Expression(walk.context.ast, node);
      return operand === undefined
        ? undefined
        : resolveFutureOperationOrigin(walk, operand, resolving);
    }
    if (kind === KindVariableDeclaration) {
      if (walk.context.facts.get(node, rustMutatedBindingFactKey) !== undefined) {
        return undefined;
      }
      const initializer = Node_Initializer(walk.context.ast, node);
      return initializer === undefined
        ? undefined
        : resolveFutureOperationOrigin(walk, initializer, resolving);
    }
    if (kind === KindIdentifier) {
      const declaration = walk.context.source.navigation.sourceReferenceFor(node)?.declaration;
      return declaration === undefined
        ? undefined
        : resolveFutureOperationOrigin(walk, declaration, resolving);
    }
    return undefined;
  } finally {
    resolving.delete(node);
  }
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
    return rustTargetOperationIsFallible(fact);
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
      if (kind === "KindArrowFunction" || kind === KindFunctionExpression) {
        // Closures are fallibility boundaries: errors cannot propagate out.
        return;
      }
      if (kind === "KindRegularExpressionLiteral" && !insideTry) {
        // Constant RegExp construction is fallible at runtime.
        found = true;
        return;
      }
      if (kind === KindVariableDeclaration &&
        (ast.variableDeclarationKind(node) === "using" ||
          ast.variableDeclarationKind(node) === "await using")) {
        const selected = selectRustResourceManagement(
          node,
          rustOperationContext(walk, node),
          walk.operationOptions,
          (declaration) => {
            const selfMode = walk.context.facts.get(declaration, rustSelfModeFactKey);
            if (selfMode === undefined) {
              return undefined;
            }
            return {
              selfMode,
              async: walk.context.facts.get(declaration, rustAsyncFunctionFactKey) !== undefined,
              fallible: fallible.has(declaration),
            };
          },
        );
        if (!insideTry && selected.kind === "selected" && selected.fact.disposal.fallible) {
          found = true;
          return;
        }
      }
      if (kind === "KindTryStatement") {
        const tryBlock = TryStatement_TryBlock(walk.context.ast, node);
        const catchBlock = CatchClause_Block(walk.context.ast, TryStatement_CatchClause(walk.context.ast, node));
        const finallyBlock = TryStatement_FinallyBlock(walk.context.ast, node);
        if (tryBlock !== undefined) {
          visit(tryBlock, catchBlock === undefined ? insideTry : true);
        }
        if (catchBlock !== undefined) {
          visit(catchBlock, insideTry);
        }
        if (finallyBlock !== undefined) {
          visit(finallyBlock, insideTry);
        }
        return;
      }
      if (!insideTry && operationIsFallible(node)) {
        found = true;
        return;
      }
      if (!insideTry && kind === "KindAwaitExpression") {
        const operand = Node_Expression(walk.context.ast, node);
        const origin = operand === undefined ? undefined : resolveFutureOperationOrigin(walk, operand);
        const operandFact = origin?.operation;
        const selectedDeclaration = origin === undefined
          ? undefined
          : selectedProjectDeclaration(origin.expression);
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
    const runtimeStatements = (ast.statements(sourceFile) as readonly Node[]).filter((statement) => {
      const kind = ast.kindName(statement);
      return kind !== KindFunctionDeclaration &&
        kind !== "KindClassDeclaration" &&
        kind !== "KindInterfaceDeclaration" &&
        kind !== "KindTypeAliasDeclaration" &&
        kind !== "KindEnumDeclaration" &&
        kind !== "KindImportDeclaration" &&
        kind !== "KindExportDeclaration" &&
        kind !== "KindEndOfFile";
    });
    if (runtimeStatements.some(expressionRegionIsFallible)) {
      walk.context.facts.set(sourceFile, rustFallibleFactKey, { fallible: true }, [
        { message: "rust fallible project module initialization" },
      ]);
    }
  }
  for (const sourceFile of projectSourceFiles) {
    const visit = (node: Node): void => {
      const kind = ast.kindName(node);
      if (kind === "KindArrowFunction" || kind === KindFunctionExpression) {
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

function recordResourceManagementFacts(
  walk: RustFactWalk,
  sourceFiles: readonly SourceFile[],
): void {
  const { ast } = walk.context;
  for (const sourceFile of sourceFiles) {
    for (const declaration of collectDescendantsOfKind(walk, sourceFile, KindVariableDeclaration)) {
      const declarationKind = ast.variableDeclarationKind(declaration);
      if (declarationKind !== "using" && declarationKind !== "await using") {
        continue;
      }
      const selected = selectRustResourceManagement(
        declaration,
        rustOperationContext(walk, declaration),
        walk.operationOptions,
        (method) => {
          const selfMode = walk.context.facts.get(method, rustSelfModeFactKey);
          if (selfMode === undefined) {
            return undefined;
          }
          return {
            selfMode,
            async: walk.context.facts.get(method, rustAsyncFunctionFactKey) !== undefined,
            fallible: walk.context.facts.get(method, rustFallibleFactKey) !== undefined,
          };
        },
      );
      if (selected.kind === "rejected") {
        appendRustDiagnostic(
          walk,
          "RUST_RESOURCE_MANAGEMENT_NOT_PROVEN",
          selected.reason,
          declaration,
          ["target.capability=rust.resource-management.selected-disposer"],
        );
        continue;
      }
      walk.context.facts.set(
        declaration,
        rustResourceManagementFactKey,
        selected.fact,
        [{ message: "rust finalized exact resource-management operation" }],
      );
    }
  }
}

function recordFutureValueFacts(walk: RustFactWalk, sourceFiles: readonly SourceFile[]): void {
  const resolving = new Set<Node>();
  const resolve = (node: Node): RustFutureValueFact | undefined => {
    const existing = walk.context.facts.get(node, rustFutureValueFactKey) ??
      walk.context.facts.resolve(node, rustFutureValueFactKey);
    if (existing !== undefined || resolving.has(node)) {
      return existing;
    }
    resolving.add(node);
    try {
      const operation = walk.context.facts.get(node, rustTargetOperationFactKey) ??
        walk.context.facts.resolve(node, rustTargetOperationFactKey);
      const effects = operation?.kind === "source-call"
        ? walk.context.facts.get(node, rustSourceCallEffectsFactKey) ??
          walk.context.facts.resolve(node, rustSourceCallEffectsFactKey)
        : undefined;
      let fact = rustFutureValueForOperation(operation, effects);
      if (fact === undefined) {
        const kind = walk.context.ast.kindName(node);
        if (kind === KindParenthesizedExpression || kind === "KindAsExpression" ||
          kind === "KindTypeAssertionExpression") {
          const operand = Node_Expression(walk.context.ast, node);
          fact = operand === undefined ? undefined : resolve(operand);
        } else if (kind === KindVariableDeclaration) {
          const initializer = Node_Initializer(walk.context.ast, node);
          fact = walk.context.facts.get(node, rustMutatedBindingFactKey) !== undefined || initializer === undefined
            ? undefined
            : resolve(initializer);
        } else if (kind === KindIdentifier) {
          const declaration = walk.context.source.navigation.sourceReferenceFor(node)?.declaration;
          fact = declaration === undefined ? undefined : resolve(declaration);
        }
      }
      if (fact === undefined) {
        return undefined;
      }
      let carrier = walk.context.facts.get(node, rustRuntimeCarrierKey)?.carrier ??
        walk.context.facts.resolve(node, rustRuntimeCarrierKey)?.carrier;
      if (carrier === undefined && walk.context.ast.kindName(node) === KindIdentifier) {
        const declaration = walk.context.source.navigation.sourceReferenceFor(node)?.declaration;
        const declarationCarrier = declaration === undefined
          ? undefined
          : walk.context.facts.get(declaration, rustRuntimeCarrierKey)?.carrier ??
            walk.context.facts.resolve(declaration, rustRuntimeCarrierKey)?.carrier;
        if (declarationCarrier !== undefined) {
          carrier = setCarrierFact(walk, node, declarationCarrier);
        }
      }
      if (!rustFutureValueMatchesCarrier(fact, carrier)) {
        appendRustDiagnostic(
          walk,
          "RUST_FUTURE_VALUE_CARRIER_CONFLICT",
          "First-class future evidence conflicts with the exact runtime carrier of this value.",
          node,
          ["target.capability=rust.async.future-value"],
        );
        return undefined;
      }
      walk.context.facts.set(node, rustFutureValueFactKey, fact, [
        { message: "rust exact future value" },
      ]);
      return fact;
    } finally {
      resolving.delete(node);
    }
  };
  for (const sourceFile of sourceFiles) {
    const visit = (node: Node): void => {
      resolve(node);
      walk.context.ast.forEachChild(node, (child) => {
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

// Callable expressions lower to Rust closures only when the selected target
// callback supplies one finalized function-pointer carrier.
function resolveFunctionExpressionCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const { ast } = walk.context;
  const selectedExpected = expected ?? resolveRustTargetTypeRef(
    expression,
    rustResolutionContext(walk, expression),
    walk.operationOptions,
  );
  if (selectedExpected === undefined || (selectedExpected.kind !== "function-pointer" &&
    rustClosureProtocol(selectedExpected) === undefined &&
    rustCallableProtocol(selectedExpected) === undefined)) {
    return undefined;
  }
  if (ast.hasModifierKind(expression, "async") ||
    walk.context.semanticsFor(expression).getResolvedGeneratorInfo(expression) !== undefined) {
    return undefined;
  }
  const callable = rustCallableProtocol(selectedExpected);
  const closure = rustClosureProtocol(selectedExpected);
  const selectedParameters = selectedExpected.kind === "function-pointer"
    ? selectedExpected.args
    : closure?.parameters ?? callable?.parameters;
  const selectedResult = selectedExpected.kind === "function-pointer"
    ? selectedExpected.result
    : closure?.result ?? callable?.result;
  if (selectedParameters === undefined || selectedResult === undefined) {
    return undefined;
  }
  const expressionName = Node_Name(ast, expression);
  if (ast.kindName(expression) === KindFunctionExpression && expressionName !== undefined) {
    setCarrierFact(walk, expression, selectedExpected);
    setCarrierFact(walk, expressionName, selectedExpected);
  }
  const parameters = ast.parameters(expression);
  if (parameters.length !== selectedParameters.length) {
    return undefined;
  }
  const byRefCopyParams: boolean[] = [];
  for (const [index, parameter] of parameters.entries()) {
    if (parameter === undefined) {
      return undefined;
    }
    const argCarrier = selectedParameters[index];
    if (argCarrier === undefined || (argCarrier.kind === "opaque" && argCarrier.id === "tsonic.rust.infer")) {
      return undefined;
    }
    const parameterAbi = resolveRustContextualParameterAbi(
      parameter,
      argCarrier,
      rustResolutionContext(walk, parameter),
      walk.operationOptions,
    );
    if (parameterAbi === undefined ||
      !rustTargetTypeRefEquals(parameterAbi.parameterCarrier, argCarrier)) {
      return undefined;
    }
    setCarrierFact(walk, parameter, parameterAbi.valueCarrier);
    setParameterAbiFact(walk, parameter, parameterAbi);
    if (!recordDefaultParameterInitializerFacts(walk, parameter, parameterAbi)) {
      return undefined;
    }
    const name = Node_Name(ast, parameter);
    const nameKind = name === undefined ? "" : ast.kindName(name);
    if (name !== undefined && (nameKind === KindArrayBindingPattern || nameKind === KindObjectBindingPattern) &&
      !recordBindingPatternFacts(walk, name, parameterAbi.valueCarrier)) {
      return undefined;
    }
    byRefCopyParams.push(false);
  }
  const body = ast.body(expression);
  if (body === undefined) {
    return undefined;
  }
  const resultExpectation = selectedResult.kind === "opaque" && selectedResult.id === "tsonic.rust.infer"
    ? resolveTypeNodeCarrier(walk, Node_Type(ast, expression))
    : selectedResult;
  let bodyCarrier = resultExpectation;
  if (ast.kindName(body) === KindBlock) {
    if (bodyCarrier === undefined) {
      return undefined;
    }
    const statements = requireDenseSourceNodes(walk, ast.statements(body), "Callable-expression body contains an undefined or non-data statement slot.");
    if (statements === undefined) {
      return undefined;
    }
    const previousCallable = walk.currentCallableDeclaration;
    const previousGenerator = walk.currentGeneratorDeclaration;
    walk.currentCallableDeclaration = expression;
    walk.currentGeneratorDeclaration = undefined;
    for (const statement of statements) {
      recordStatementFacts(walk, statement, sourceFile, bodyCarrier);
    }
    walk.currentCallableDeclaration = previousCallable;
    walk.currentGeneratorDeclaration = previousGenerator;
  } else {
    bodyCarrier = resolveExpressionCarrier(walk, body, sourceFile, resultExpectation);
    if (bodyCarrier === undefined) {
      return undefined;
    }
  }
  const closureCarrier: TargetTypeRef = selectedExpected.kind === "function-pointer" || selectedExpected.kind === "closure"
    ? { ...selectedExpected, result: bodyCarrier }
    : rustCallableTargetType(selectedParameters, bodyCarrier);
  const captures = collectRustClosureCaptures(walk, expression, body);
  if (captures === undefined) {
    return undefined;
  }
  walk.context.facts.set(expression, rustClosureCaptureFactKey, captures, [
    { message: "rust exact callable-expression captures" },
  ]);
  setRustOperationFact(walk, expression, {
    kind: "closure",
    operationId: "tsonic.rust.closure",
    byRefCopyParams,
    resultCarrier: closureCarrier,
  });
  return setCarrierFact(walk, expression, closureCarrier);
}

function collectRustClosureCaptures(
  walk: RustFactWalk,
  expression: Node,
  body: Node,
): import("../rust-facts/keys.js").RustClosureCaptureFact | undefined {
  const { ast } = walk.context;
  const captures = new Map<Node, {
    readonly declaration: Node;
    readonly reference: Node;
    readonly carrier: TargetTypeRef;
    readonly storage: "value" | "location";
  }>();
  let recursiveDeclaration: Node | undefined;
  let valid = true;
  const visit = (node: Node): void => {
    if (!valid) {
      return;
    }
    if (ast.kindName(node) === KindIdentifier) {
      const reference = walk.context.source.navigation.sourceReferenceFor(node);
      const declaration = reference?.project === true ? reference.declaration : undefined;
      if (declaration === expression) {
        recursiveDeclaration = expression;
      } else if (declaration !== undefined && !nodeIsWithin(declaration, expression, ast) &&
        !declarationIsModuleScoped(declaration, ast)) {
        const declarationKind = ast.kindName(declaration);
        if (declarationKind === KindParameter || declarationKind === KindVariableDeclaration ||
          declarationKind === KindBindingElement) {
          const carrier = walk.context.facts.get(node, rustRuntimeCarrierKey)?.carrier ??
            walk.context.facts.resolve(node, rustRuntimeCarrierKey)?.carrier ??
            walk.context.facts.get(declaration, rustRuntimeCarrierKey)?.carrier ??
            walk.context.facts.resolve(declaration, rustRuntimeCarrierKey)?.carrier;
          if (carrier === undefined) {
            valid = false;
            return;
          }
          const location = walk.context.facts.get(declaration, rustMutatedBindingFactKey) !== undefined;
          if (location) {
            walk.context.facts.set(declaration, rustLocationStorageFactKey, {
              valueCarrier: carrier,
            }, [{ message: "rust captured mutable binding storage" }]);
          }
          captures.set(declaration, {
            declaration,
            reference: node,
            carrier,
            storage: location ? "location" : "value",
          });
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
  return valid
    ? {
        captures: [...captures.values()],
        ...(recursiveDeclaration === undefined ? {} : { recursiveDeclaration }),
      }
    : undefined;
}

function nodeIsWithin(node: Node, ancestor: Node, ast: RustFactWalk["context"]["ast"]): boolean {
  let current: Node | undefined = node;
  while (current !== undefined) {
    if (current === ancestor) {
      return true;
    }
    current = ast.parent(current);
  }
  return false;
}

function declarationIsModuleScoped(
  declaration: Node,
  ast: RustFactWalk["context"]["ast"],
): boolean {
  let current: Node | undefined = declaration;
  while (current !== undefined) {
    const kind = ast.kindName(current);
    if (kind === "KindSourceFile") {
      return true;
    }
    if (kind === KindFunctionDeclaration || kind === KindFunctionExpression ||
      kind === "KindArrowFunction" || kind === "KindMethodDeclaration" ||
      kind === "KindConstructor") {
      return false;
    }
    current = ast.parent(current);
  }
  return false;
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
