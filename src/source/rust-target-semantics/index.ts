import {
  flowStateFactKey,
} from "@tsonic/tsts";
import type {
  AstReader,
  ExtensionFactSubject,
  Node,
  ResolvedSourcePropertyAccessInfo,
  SourceFile,
  Type,
} from "@tsonic/tsts";
import {
  selectSourceObjectLiteralAccessors,
} from "@tsonic/target-api";
import type { RustAssignmentOperator } from "../../common/rust-syntax.js";
import { isDenseDataArray } from "../../common/closed-metadata.js";
import { rustTargetTypeRefEquals } from "../../policy/equality.js";
import {
  ClassStaticBlock_Body,
  ElementAccessExpression_ArgumentExpression,
  BinaryExpression_Left,
  BinaryExpression_OperatorToken,
  BinaryExpression_Right,
  CatchClause_Block,
  CatchClause_VariableDeclaration,
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
  KindClassStaticBlockDeclaration,
  KindConditionalExpression,
  KindDeleteExpression,
  KindDoStatement,
  KindLabeledStatement,
  KindElementAccessExpression,
  KindEqualsEqualsEqualsToken,
  KindEqualsToken,
  KindExclamationEqualsEqualsToken,
  KindExpressionStatement,
  KindExportAssignment,
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
  KindSpreadElement,
  KindSpreadAssignment,
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
  ObjectLiteralProperty_Value,
  SpreadAssignment_Expression,
  VariableDeclarationList_Declarations,
  VariableStatement_DeclarationList,
  asSourceNode,
} from "../../common/source-ast.js";
import {
  isRustJsArrayCarrier,
  rustFutureOutputCarrier,
  getRustGeneratorProtocol,
  isRustBigIntCarrier,
  isRustBoolCarrier,
  isRustDefinitelyNullishCarrier,
  isRustIntegerCarrier,
  isRustNullCarrier,
  isRustProgramErrorCarrier,
  isRustNumericCarrier,
  isRustNullishSourceCarrier,
  isRustOptionCarrier,
  isRustSourceStringConvertibleCarrier,
  isRustStringCarrier,
  isRustUnitCarrier,
  isRustUndefinedCarrier,
  rustOptionElementCarrier,
  rustOptionTargetType,
  isRustVecCarrier,
  rustBigIntTargetType,
  rustCallableProtocol,
  rustStructuralMethodCallableCarrier,
  rustClosureProtocol,
  rustCallableTargetType,
  rustStructuralPropertyValueCarrier,
  rustClosureTargetType,
  rustJsArrayTargetType,
  rustProgramErrorTargetType,
  rustNullTargetType,
  rustNullishSourceTargetType,
  rustSourcePrimitiveTargetType,
  rustStringTargetType,
  rustUnitTargetType,
  rustUndefinedTargetType,
  inferRustTargetTypeParameterBindings,
  substituteRustTargetTypeParameters,
  rustVecTargetType,
  rustSourceTypeCarrierValue,
  rustSourceUnionCarrierValue,
  rustSourceUnionTargetType,
  rustStructuralObjectCarrierValue,
  rustCarrierSupportsClone,
} from "../rust-target-types.js";
import {
  parseSourceBigIntLiteral,
  sourceCharCodeUnit,
} from "../../common/source-literal-values.js";
import { rustAsyncFunctionFactKey, rustBindingProjectionFactKey, rustClosureCaptureFactKey, rustContextualValueConversionFactKey, rustFallibleFactKey, rustFlowReadProjectionFactKey, rustFutureValueFactKey, rustGeneratorFactKey, rustLocationStorageFactKey, rustModuleBindingFactKey, rustMutatedBindingFactKey, rustMutatedReferentFactKey, rustObjectLiteralMethodAdapterFactKey, rustOptionalChainFactKey, rustOptionProjectionFactKey, rustPostCheckOperationKind, rustPostCheckUnaryMinusOperationId, rustPostCheckUnaryPlusOperationId, rustPreparedOperationResultFactKey, rustResourceManagementFactKey, rustSelfModeFactKey, rustSourceAccessorEffectsFactKey, rustSourceBindingFactKey, rustSourceCallableReturnFactKey, rustSourceCallableValueFactKey, rustSourceCallEffectsFactKey, rustSourceParameterAbiFactKey, rustTargetOperationFactKey, rustTargetOperationResultCarrier, rustTypeAliasDeclarationFactKey, rustYieldFactKey } from "../rust-facts/keys.js";
import type {
  RustFutureValueFact,
  RustSourceBindingFact,
  RustTargetOperationFact,
} from "../rust-facts/keys.js";
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
import { rustValueConversionIsFallible } from "../rust-facts/value-conversions.js";
import type { RustProviderOperationRow } from "../provider-packages/index.js";
import {
  isRustAssignmentOperator,
  rustBinaryResultCarrierIsIndependentOfOperands,
  rustBinaryRightCarrierIsIndependentOfLeft,
  rustOperatorCarrierKey,
  selectRustBinaryOperator,
  selectRustCompoundAssignment,
  selectRustEquivalentAssignment,
} from "./operator-rules.js";
import { readRustTypescriptCompatibilityMode } from "../../options/rust-target-options.js";
import {
  finalizeRustPreparedCheckedCall,
  prepareRustDeferredCheckedCall,
  selectRustCheckedCall,
  selectRustCheckedConversion,
  selectRustCheckedDelete,
  selectRustCheckedElementAccess,
  selectRustCheckedIteration,
  selectRustCheckedOperator,
  selectRustCheckedPropertyAccess,
  selectRustCheckedValue,
} from "./operations-provider.js";
import type {
  RustOperationsProviderOptions,
  RustPreparedDeferredCheckedCall,
} from "./operations-provider.js";
import {
  resolveRustExactNullishValueCarrier,
  resolveRustTargetTypeRef,
} from "./target-type-resolution.js";
import type { RustTargetTypeResolutionContext } from "./target-type-resolution.js";
import { createRustSourceTypeRegistry } from "./source-type-registry.js";
import type {
  RustSourceTypeRegistry,
  RustSourceUnion,
  RustSourceUnionVariant,
} from "./source-type-registry.js";
import { createRustSourceProfileRegistry } from "./source-profile-registry.js";
import type { RustSourceProfileRegistry } from "./source-profile-registry.js";
import { resolveRustExternalProjectBase } from "./external-project-types.js";
import type { RustProjectTypePolicy } from "./project-type-policy.js";
import {
  selectedSourceLiteralIsRepresentable,
  selectedSourceLiteralOperandIsRepresentable,
} from "./selected-numeric-literal.js";
import {
  createRustSourceCallableAbiResolver,
  resolveRustContextualParameterAbi,
  rustSourceParameterContractCarrier,
} from "./source-callable-abi.js";
import type { RustSourceCallableAbiResolver } from "./source-callable-abi.js";
import {
  createRustModuleBindingPolicy,
} from "./module-binding-policy.js";
import type { RustModuleBindingPolicy } from "./module-binding-policy.js";
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
import {
  rustProjectInterfaceContracts,
  rustInheritedProjectConstructor,
} from "./project-type-policy.js";
import { rustProjectCallableTargetName } from "./source-member-name.js";
import { rustProjectObjectLayout } from "./project-object-layout.js";
import {
  recordRustFlowReadProjection,
  recordRustValueCarrierReconciliation,
  selectRustFlowReadProjection,
  selectRustValueCarrierReconciliation,
} from "./value-carrier-reconciliation.js";
import { recordRustBindingPatternFacts } from "./binding-patterns.js";
import { recordRustObjectLiteralMethodAdapterFacts } from "./object-literal-method-adapters.js";
import {
  readRustSourceNativePointerOperation,
  readRustSourceSafetyBuilder,
  readRustSourceUnsafeContext,
} from "./source-explicit-safety.js";

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
  readonly preparedCallbackCalls: Map<Node, {
    readonly request: import("../../policy/operations/contracts.js").RustCheckedCallSelectionInput;
    readonly prepared: RustPreparedDeferredCheckedCall;
  }>;
  readonly capturedBindingStorage: Map<Node, "value" | "location">;
  readonly objectLiteralMethodExpressions: Node[];
  readonly objectLiteralMethodSpreadExpressions: Node[];
  readonly moduleBindings: RustModuleBindingPolicy;
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
    if (isSharedSourceMarkerOperation(walk, expression)) {
      return;
    }
    const source = semantics.getResolvedCallInfo(expression);
    if (source === undefined) {
      return;
    }
    const sourceSelectedDeclaration = semantics.getSignatureDeclaration(source.selectedSignature);
    const request: import("../../policy/operations/contracts.js").RustCheckedCallSelectionInput = {
      target: "rust",
      source,
      ...(sourceSelectedDeclaration === undefined ? {} : { sourceSelectedDeclaration }),
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
    recordPolicySelection(walk, expression, selectRustCheckedPropertyAccess(
      checkedPropertySelectionInput(walk, expression, source),
      context,
      walk.operationOptions,
    ));
    return;
  }
  if (kind === KindElementAccessExpression) {
    const source = semantics.getResolvedElementAccessInfo(expression);
    if (source === undefined || source.callCallee) {
      return;
    }
    const receiverReference = walk.context.source.navigation.sourceReferenceFor(
      source.receiver.expression,
    );
    recordPolicySelection(walk, expression, selectRustCheckedElementAccess({
      target: "rust",
      expression,
      receiver: source.receiver.expression,
      sourceReceiverType: source.receiver.type,
      ...(receiverReference?.declaration === undefined
        ? {}
        : { sourceReceiverValueDeclaration: receiverReference.declaration }),
      accessMode: source.accessMode,
      argument: source.argument.expression,
      sourceArgumentType: source.argument.type,
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
  const rightReference = right === undefined
    ? undefined
    : walk.context.source.navigation.sourceReferenceFor(right);
  recordPolicySelection(walk, expression, selectRustCheckedOperator({
    target: "rust",
    expression,
    operator,
    ...(left === undefined ? {} : { left }),
    ...(right === undefined ? {} : { right }),
    ...(rightReference?.declaration === undefined
      ? {}
      : { sourceRightDeclaration: rightReference.declaration }),
  }, context, walk.operationOptions));
}

function checkedPropertySelectionInput(
  walk: RustFactWalk,
  expression: Node,
  source: ResolvedSourcePropertyAccessInfo,
): import("../../policy/operations/contracts.js").RustCheckedPropertySelectionInput {
  const receiverReference = walk.context.source.navigation.sourceReferenceFor(
    source.receiver.expression,
  );
  return {
    target: "rust",
    expression,
    receiver: source.receiver.expression,
    sourceReceiverType: source.receiver.type,
    ...(source.receiver.declaration === undefined
      ? {}
      : { sourceReceiverDeclaration: source.receiver.declaration }),
    ...(receiverReference?.declaration === undefined
      ? {}
      : { sourceReceiverValueDeclaration: receiverReference.declaration }),
    accessMode: source.accessMode,
    ...(source.selectedSymbol === undefined ? {} : { sourceSelectedSymbol: source.selectedSymbol }),
    ...(source.selectedDeclaration === undefined ? {} : { sourceSelectedDeclaration: source.selectedDeclaration }),
    ...(source.selectedReadDeclaration === undefined
      ? {}
      : { sourceSelectedReadDeclaration: source.selectedReadDeclaration }),
    ...(source.selectedWriteDeclaration === undefined
      ? {}
      : { sourceSelectedWriteDeclaration: source.selectedWriteDeclaration }),
    ...(source.sourceReadType === undefined ? {} : { sourceReadType: source.sourceReadType }),
    ...(source.sourceWriteType === undefined ? {} : { sourceWriteType: source.sourceWriteType }),
    sourceResultType: source.sourceReadType ?? source.sourceWriteType,
    optionalChain: source.optionalChain,
  };
}

function rustOperatorText(kind: string | undefined): string | undefined {
  const operators: Readonly<Record<string, string>> = {
    KindEqualsToken: "=",
    KindPlusToken: "+",
    KindMinusToken: "-",
    KindAsteriskToken: "*",
    KindSlashToken: "/",
    KindPercentToken: "%",
    KindAmpersandToken: "&",
    KindBarToken: "|",
    KindCaretToken: "^",
    KindLessThanLessThanToken: "<<",
    KindGreaterThanGreaterThanToken: ">>",
    KindGreaterThanGreaterThanGreaterThanToken: ">>>",
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
    KindInstanceOfKeyword: "instanceof",
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
  const providerSemantics = context.providerSemantics;
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
  const moduleBindings = createRustModuleBindingPolicy(context);
  for (const sourceFile of projectSourceFiles) {
    const statements = ast.statements(sourceFile);
    if (!isDenseDataArray(statements) || statements.some((statement) => statement === undefined)) {
      appendMalformedSourceAstDiagnostic(context, "Project source file contains an undefined or non-data top-level statement slot.");
      return;
    }
  }
  let finalizedProjectTypes: RustProjectTypePolicy | undefined;
  const operationOptions: RustOperationsProviderOptions = {
    providerExports: providerSemantics.exports,
    providerRows,
    providerTypes: providerSemantics.types,
    providerCarrierPaths: providerSemantics.carrierPaths,
    jsEnabled,
    regExpSubsetViolation: rustRegExpSubsetViolation,
    sourceProfiles,
    sourceTypes,
    resolveProjectUnionCarrier(memberCarriers) {
      return finalizedProjectTypes?.commonSupertype(memberCarriers);
    },
    sourceCallableAbi,
    projectTypes: context.projectTypes,
    projectMethodProperties: context.projectMethodProperties,
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
    capturedBindingStorage: new Map<Node, "value" | "location">(),
    objectLiteralMethodExpressions: [],
    objectLiteralMethodSpreadExpressions: [],
    moduleBindings,
    deferredCallbackCalls: new WeakMap(),
    preparedCallbackCalls: new Map(),
  };
  // Pass 0: register every project type declaration so contextual record
  // binding works regardless of file order.
  for (const sourceFile of projectSourceFiles) {
    sourceTypes.registerSourceFile(sourceFile, ast);
  }
  const projectTypes = context.projectTypes.initialize({
    ast,
    names: context.names,
    navigation: context.source.navigation,
    sourceFiles: projectSourceFiles,
    resolveSelectedType(authoredTypeNode, selectedType, heritage) {
      return resolveRustTargetTypeRef(
        authoredTypeNode ?? selectedType,
        rustResolutionContext(walk, heritage),
        operationOptions,
      );
    },
    resolveExternalHeritage(edge) {
      return resolveRustExternalProjectBase(edge, ast, sourceProfiles);
    },
  });
  finalizedProjectTypes = projectTypes;
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
        registerTypeAlias(walk, statement);
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
    recordTopLevelCallableValueSignatureFacts(walk, sourceFile);
  }
  if (context.diagnostics.length !== signatureDiagnosticCount) {
    return;
  }
  for (const sourceFile of projectSourceFiles) {
    recordPredeclaredNativeFunctionBindingFacts(walk, sourceFile);
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
      } else if (kind === KindExportAssignment) {
        recordExportAssignmentFacts(walk, statement);
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
  const callableSpecializations = context.sourceCallableSpecializations.initialize({
    ast,
    names: context.names,
    projectTypes,
  });
  for (const issue of callableSpecializations.issues) {
    appendRustDiagnostic(
      walk,
      "RUST_SOURCE_CALLABLE_SPECIALIZATION_NOT_CLOSED",
      issue.message,
      issue.subject,
      ["target.capability=rust.source-callable.finite-specialization"],
    );
  }
  for (const request of callableSpecializations.projectMethodRequests) {
    const registration = context.projectMethodDispatch.record(
      request.declaration,
      request.targetTypeArguments,
      ast,
      projectTypes,
    );
    if (registration.kind === "rejected") {
      appendRustDiagnostic(
        walk,
        "RUST_PROJECT_METHOD_SPECIALIZATION_UNAVAILABLE",
        registration.reason,
        request.declaration,
        ["target.capability=rust.project-dispatch.finite-generic-specialization"],
      );
    }
  }
  context.projectMethodDispatch.initialize({
    ast,
    names: context.names,
    projectTypes,
  });
  context.projectMethodProperties.initialize({
    ast,
    navigation: context.source.navigation,
    projectTypes,
  });
  for (const issue of recordRustObjectLiteralMethodAdapterFacts({
    ast: walk.context.ast,
    facts: walk.context.facts,
    projectTypes: walk.context.projectTypes,
    projectMethodDispatch: walk.context.projectMethodDispatch,
    expressions: walk.objectLiteralMethodExpressions,
  })) {
    appendRustDiagnostic(
      walk,
      "RUST_OBJECT_LITERAL_METHOD_ADAPTER_NOT_PROVEN",
      issue.message,
      issue.subject,
      ["target.capability=rust.object-literal-method.exact-adapter"],
    );
  }
  context.structuralShapes.initialize(
    sourceTypes.structuralObjects(),
    sourceTypes.structuralFieldImplementations(),
  );
  context.projectFieldDispatch.initialize({
    ast,
    projectTypes,
    semanticsFor: context.semanticsFor,
  });
  // Fallibility depends on finalized operation facts and the one whole-program
  // structural storage plan produced while walking bodies.
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

function recordTopLevelCallableValueSignatureFacts(
  walk: RustFactWalk,
  sourceFile: SourceFile,
): void {
  recordCallableValueSignaturesForStatements(
    walk,
    walk.context.ast.statements(sourceFile) as readonly Node[],
  );
}

function recordPredeclaredNativeFunctionBindingFacts(
  walk: RustFactWalk,
  sourceFile: SourceFile,
): void {
  const { ast } = walk.context;
  for (const statement of ast.statements(sourceFile)) {
    if (statement === undefined || ast.kindName(statement) !== KindVariableStatement) {
      continue;
    }
    const declarations = VariableDeclarationList_Declarations(
      ast,
      VariableStatement_DeclarationList(ast, statement),
    );
    if (declarations === undefined) {
      continue;
    }
    for (const declaration of declarations) {
      if (declaration === undefined || ast.kindName(declaration) !== KindVariableDeclaration ||
        ast.variableDeclarationKind(declaration) !== "const") {
        continue;
      }
      const candidate = walk.moduleBindings.nativeFunction(declaration);
      if (candidate === undefined || !nativeModuleFunctionAbiIsFinalized(
        walk,
        candidate.callableDeclaration,
      )) {
        continue;
      }
      walk.context.facts.set(declaration, rustModuleBindingFactKey, {
        declarationKind: "const",
        storage: "native-function",
        callableDeclaration: candidate.callableDeclaration,
        name: candidate.name,
      }, [
        { message: "rust finalized native module function storage" },
      ]);
    }
  }
}

function nativeModuleFunctionAbiIsFinalized(
  walk: RustFactWalk,
  callableDeclaration: Node,
): boolean {
  const parameters = walk.context.ast.parameters(callableDeclaration);
  return isDenseDataArray(parameters) &&
    parameters.every((parameter) =>
      parameter !== undefined &&
      (walk.context.facts.get(parameter, rustSourceParameterAbiFactKey) ??
        walk.context.facts.resolve(parameter, rustSourceParameterAbiFactKey)) !== undefined) &&
    (walk.context.facts.get(callableDeclaration, rustSourceCallableReturnFactKey) ??
      walk.context.facts.resolve(callableDeclaration, rustSourceCallableReturnFactKey)) !== undefined;
}

function recordCallableValueSignaturesForStatements(
  walk: RustFactWalk,
  statements: readonly Node[],
): void {
  for (const statement of statements) {
    if (walk.context.ast.kindName(statement) === KindVariableStatement) {
      recordCallableValueSignaturesForVariableStatement(walk, statement);
    }
  }
}

function recordCallableValueSignaturesForVariableStatement(
  walk: RustFactWalk,
  statement: Node,
): void {
  const { ast } = walk.context;
  const declarations = VariableDeclarationList_Declarations(
    ast,
    VariableStatement_DeclarationList(ast, statement),
  );
  if (declarations === undefined || !isDenseDataArray(declarations)) {
    return;
  }
  for (const declaration of declarations) {
    if (declaration === undefined || ast.kindName(declaration) !== KindVariableDeclaration) {
      return;
    }
    recordCallableValueSignatureForDeclaration(walk, declaration);
  }
}

function recordCallableValueSignatureForDeclaration(
  walk: RustFactWalk,
  declaration: Node,
): void {
  const { ast } = walk.context;
  let initializer = Node_Initializer(ast, declaration);
  while (initializer !== undefined) {
    const kind = ast.kindName(initializer);
    if (kind === KindParenthesizedExpression || kind === KindNonNullExpression ||
      kind === KindSatisfiesExpression || kind === "KindAsExpression" ||
      kind === "KindTypeAssertionExpression") {
      initializer = Node_Expression(ast, initializer);
      continue;
    }
    if (kind === "KindArrowFunction" || kind === KindFunctionExpression) {
      recordCallableValueSignatureFacts(walk, declaration, initializer);
    }
    break;
  }
}

function recordCallableValueSignatureFacts(
  walk: RustFactWalk,
  declaration: Node,
  expression: Node,
): void {
  const { ast } = walk.context;
  const nativeFunction = walk.moduleBindings.nativeFunction(declaration);
  if (nativeFunction?.callableDeclaration === expression) {
    const nativeSignature = resolveAuthoredCallableValueSignature(walk, expression);
    if (nativeSignature !== undefined) {
      recordCallableValueSignaturePlan(walk, expression, nativeSignature);
      return;
    }
  }
  const selectedCarrier = walk.context.facts.get(declaration, rustRuntimeCarrierKey)?.carrier ??
    walk.context.facts.resolve(declaration, rustRuntimeCarrierKey)?.carrier ??
    resolveRustTargetTypeRef(
      Node_Type(ast, declaration) ?? expression,
      rustResolutionContext(walk, declaration),
      walk.operationOptions,
    );
  const callable = rustCallableProtocol(selectedCarrier);
  const closure = rustClosureProtocol(selectedCarrier);
  const parameterCarriers = selectedCarrier?.kind === "function-pointer"
    ? selectedCarrier.args
    : closure?.parameters ?? callable?.parameters;
  const returnCarrier = selectedCarrier?.kind === "function-pointer"
    ? selectedCarrier.result
    : closure?.result ?? callable?.result;
  const parameters = ast.parameters(expression);
  if (selectedCarrier === undefined || parameterCarriers === undefined ||
    returnCarrier === undefined || parameters.length !== parameterCarriers.length) {
    return;
  }
  const parameterAbis: import("./source-callable-abi.js").RustSourceParameterAbi[] = [];
  for (const [index, parameter] of parameters.entries()) {
    const sourceParameterCarrier = parameterCarriers[index];
    if (parameter === undefined || sourceParameterCarrier === undefined) {
      return;
    }
    const parameterCarrier = Node_Initializer(ast, parameter) === undefined
      ? sourceParameterCarrier
      : rustOptionTargetType(sourceParameterCarrier);
    const parameterAbi = resolveRustContextualParameterAbi(
      parameter,
      parameterCarrier,
      rustResolutionContext(walk, parameter),
      walk.operationOptions,
    );
    if (parameterAbi === undefined) {
      return;
    }
    setCarrierFact(walk, parameter, parameterAbi.valueCarrier);
    setParameterAbiFact(walk, parameter, parameterAbi);
    if (!recordDefaultParameterInitializerFacts(walk, parameter, parameterAbi)) {
      return;
    }
    const name = Node_Name(ast, parameter);
    const nameKind = name === undefined ? "" : ast.kindName(name);
    if (name !== undefined && (nameKind === KindArrayBindingPattern || nameKind === KindObjectBindingPattern) &&
      !recordBindingPatternFacts(walk, name, parameterAbi.valueCarrier)) {
      return;
    }
    parameterAbis.push(parameterAbi);
  }
  walk.context.facts.set(expression, rustSourceCallableReturnFactKey, {
    returnCarrier,
  }, [{ message: "rust finalized callable-value return carrier" }]);
  const runtimeParameterCarriers = parameterAbis.map((abi) => abi.parameterCarrier);
  const runtimeCarrier = selectedCarrier.kind === "function-pointer" || selectedCarrier.kind === "closure"
    ? { ...selectedCarrier, args: runtimeParameterCarriers, result: returnCarrier }
    : rustCallableTargetType(runtimeParameterCarriers, returnCarrier);
  setCarrierFact(walk, declaration, runtimeCarrier);
}

interface RustCallableValueSignaturePlan {
  readonly parameters: readonly {
    readonly declaration: Node;
    readonly abi: import("./source-callable-abi.js").RustSourceParameterAbi;
  }[];
  readonly returnCarrier: TargetTypeRef;
}

function resolveAuthoredCallableValueSignature(
  walk: RustFactWalk,
  expression: Node,
): RustCallableValueSignaturePlan | undefined {
  const { ast } = walk.context;
  if (ast.hasModifierKind(expression, "async") ||
    walk.context.semanticsFor(expression).getResolvedGeneratorInfo(expression) !== undefined) {
    return undefined;
  }
  const parameters = ast.parameters(expression);
  if (!isDenseDataArray(parameters) || parameters.some((parameter) => parameter === undefined)) {
    return undefined;
  }
  const parameterAbis = (parameters as readonly Node[]).map((parameter) =>
    resolveParameterAbi(walk, parameter));
  const sourceReturn = selectedSourceCallableReturn(walk, expression);
  const returnCarrier = resolveRustTargetTypeRef(
    Node_Type(ast, expression) ?? sourceReturn,
    rustResolutionContext(walk, expression),
    walk.operationOptions,
  );
  if (returnCarrier === undefined || parameterAbis.some((abi) => abi === undefined)) {
    return undefined;
  }
  return {
    parameters: (parameters as readonly Node[]).map((declaration, index) => ({
      declaration,
      abi: parameterAbis[index]!,
    })),
    returnCarrier,
  };
}

function recordCallableValueSignaturePlan(
  walk: RustFactWalk,
  expression: Node,
  signature: RustCallableValueSignaturePlan,
): void {
  for (const { declaration: parameter, abi } of signature.parameters) {
    setCarrierFact(walk, parameter, abi.valueCarrier);
    setParameterAbiFact(walk, parameter, abi);
    if (!recordDefaultParameterInitializerFacts(walk, parameter, abi)) {
      return;
    }
  }
  walk.context.facts.set(expression, rustSourceCallableReturnFactKey, {
    returnCarrier: signature.returnCarrier,
  }, [{ message: "rust finalized authored callable-value return carrier" }]);
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
  const declarationList = VariableStatement_DeclarationList(walk.context.ast, statement);
  const declarationSlots = VariableDeclarationList_Declarations(
    walk.context.ast,
    declarationList,
  );
  if (declarationSlots === undefined || !isDenseDataArray(declarationSlots) ||
    declarationSlots.some((declaration) =>
      declaration === undefined || walk.context.ast.kindName(declaration) !== KindVariableDeclaration)) {
    appendRustDiagnostic(
      walk,
      "RUST_VARIABLE_DECLARATIONS_NOT_CLOSED",
      "Variable statement has no exact dense declaration list.",
      statement,
      ["target.capability=rust.source.variable-declarations"],
    );
    return;
  }
  for (const declaration of declarationSlots as readonly Node[]) {
    recordCallableValueSignatureForDeclaration(walk, declaration);
    const nativeFunction = moduleLevel
      ? walk.context.facts.get(declaration, rustModuleBindingFactKey) ??
        walk.context.facts.resolve(declaration, rustModuleBindingFactKey)
      : undefined;
    if (nativeFunction?.storage === "native-function") {
      recordNativeModuleFunctionBodyFacts(
        walk,
        nativeFunction.callableDeclaration,
        sourceFile,
      );
      continue;
    }
    const annotated = resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, declaration));
    const predeclared = walk.context.facts.get(declaration, rustRuntimeCarrierKey)?.carrier ??
      walk.context.facts.resolve(declaration, rustRuntimeCarrierKey)?.carrier;
    const initializer = Node_Initializer(walk.context.ast, declaration);
    const initializerCarrier = initializer === undefined
      ? undefined
      : resolveExpressionCarrier(walk, initializer, sourceFile, annotated ?? predeclared);
    const effective = annotated ?? initializerCarrier ?? predeclared;
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
        walk.context.facts.set(
          declaration,
          rustModuleBindingFactKey,
          walk.moduleBindings.classifyValue(declaration, declarationKind, effective),
          [{ message: "rust finalized project module binding storage" }],
        );
      }
    }
  }
}

function recordExportAssignmentFacts(
  walk: RustFactWalk,
  declaration: Node,
): TargetTypeRef | undefined {
  const { ast } = walk.context;
  const assignment = ast.as.AsExportAssignment(declaration);
  const sourceFile = ast.getSourceFile(declaration);
  if (assignment === undefined || assignment.IsExportEquals === true ||
    assignment.Expression === undefined || sourceFile === undefined) {
    appendRustDiagnostic(
      walk,
      "RUST_EXPORT_ASSIGNMENT_NOT_CLOSED",
      "Default exports require one exact ESM export expression in project source.",
      declaration,
      ["target.capability=rust.source.default-export"],
    );
    return undefined;
  }
  const existing = walk.context.facts.get(declaration, rustRuntimeCarrierKey) ??
    walk.context.facts.resolve(declaration, rustRuntimeCarrierKey);
  const carrier = existing?.carrier ?? resolveExpressionCarrier(
    walk,
    assignment.Expression,
    sourceFile,
    undefined,
  );
  if (carrier === undefined) {
    return undefined;
  }
  const finalized = setCarrierFact(walk, declaration, carrier);
  if (finalized === undefined) {
    return undefined;
  }
  walk.context.facts.set(declaration, rustModuleBindingFactKey, {
    declarationKind: "const",
    storage: "module-cell",
    valueCarrier: finalized,
  }, [{ message: "rust finalized default export snapshot storage" }]);
  return finalized;
}

function recordNativeModuleFunctionBodyFacts(
  walk: RustFactWalk,
  declaration: Node,
  sourceFile: SourceFile,
): void {
  const body = walk.context.ast.body(declaration);
  const returnCarrier = walk.context.facts.get(declaration, rustSourceCallableReturnFactKey)?.returnCarrier ??
    walk.context.facts.resolve(declaration, rustSourceCallableReturnFactKey)?.returnCarrier;
  if (body === undefined || returnCarrier === undefined) {
    return;
  }
  const previousCallable = walk.currentCallableDeclaration;
  const previousGenerator = walk.currentGeneratorDeclaration;
  walk.currentCallableDeclaration = declaration;
  walk.currentGeneratorDeclaration = undefined;
  if (walk.context.ast.kindName(body) === KindBlock) {
    const statements = requireDenseSourceNodes(
      walk,
      walk.context.ast.statements(body),
      "Native module function body contains an undefined or non-data statement slot.",
    );
    if (statements !== undefined) {
      for (const statement of statements) {
        recordStatementFacts(walk, statement, sourceFile, returnCarrier);
      }
    }
  } else {
    resolveExpressionCarrier(walk, body, sourceFile, returnCarrier);
  }
  walk.currentCallableDeclaration = previousCallable;
  walk.currentGeneratorDeclaration = previousGenerator;
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
      const resolved = resolveExpressionCarrier(
        walk,
        expression,
        sourceFile,
        returnCarrier,
      );
      if (returnCarrier !== undefined && resolved !== undefined &&
        !reconcileRequiredCarrier(walk, expression, resolved, returnCarrier)) {
        appendRustDiagnostic(
          walk,
          "RUST_RETURN_CARRIER_MISMATCH",
          "The returned source value cannot be represented by the callable's exact Rust return carrier.",
          expression,
          ["target.capability=rust.return-carrier"],
        );
      }
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
    const catchClause = TryStatement_CatchClause(walk.context.ast, statement);
    const catchVariable = CatchClause_VariableDeclaration(walk.context.ast, catchClause);
    if (catchVariable !== undefined) {
      setCarrierFact(walk, catchVariable, rustProgramErrorTargetType());
      const catchName = Node_Name(walk.context.ast, catchVariable);
      if (catchName !== undefined) {
        setCarrierFact(walk, catchName, rustProgramErrorTargetType());
      }
    }
    const catchBlock = CatchClause_Block(walk.context.ast, catchClause);
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
  const contextualExpected = rustExpressionResolutionExpectation(
    walk.context.ast,
    expression,
    expected,
  );
  const finalize = (carrier: TargetTypeRef | undefined): TargetTypeRef | undefined => {
    const selectedOperation = facts.get(expression, rustSelectedOperationKey) ??
      facts.resolve(expression, rustSelectedOperationKey);
    const targetOperation = facts.get(expression, rustTargetOperationFactKey) ??
      facts.resolve(expression, rustTargetOperationFactKey);
    const optionalChain = facts.get(expression, rustOptionalChainFactKey) ??
      facts.resolve(expression, rustOptionalChainFactKey);
    const selectedOperationOwnsResult = selectedOperation !== undefined || targetOperation !== undefined;
    const flowCarrier = selectedOperationOwnsResult &&
        (optionalChain !== undefined || rustOptionElementCarrier(carrier) === undefined)
      ? carrier
      : applyFlowReadLane(walk, expression, carrier);
    return applyOptionLane(walk, expression, flowCarrier, expected);
  };
  const existing = facts.get(expression, rustRuntimeCarrierKey) ??
    walk.context.facts.resolve(expression, rustRuntimeCarrierKey);
  if (walk.resolving.has(expression)) {
    return existing === undefined
      ? undefined
      : finalize(existing.carrier);
  }
  walk.resolving.add(expression);
  try {
    if (existing !== undefined) {
      const operation = facts.get(expression, rustTargetOperationFactKey) ??
        walk.context.facts.resolve(expression, rustTargetOperationFactKey);
      recordSelectedOperationInputs(walk, expression, sourceFile, operation);
      return finalize(existing.carrier);
    }
    const expressionKind = walk.context.ast.kindName(expression);
    if (expressionIsPlainAssignment(walk.context.ast, expression)) {
      const target = BinaryExpression_Left(walk.context.ast, expression);
      if (target !== undefined) {
        resolveExpressionCarrier(walk, target, sourceFile, undefined);
      }
      selectExpressionOperation(walk, expression, sourceFile);
      resolveExpressionOperationDependencies(walk, expression, sourceFile, contextualExpected);
    } else if (expressionKind === KindCallExpression || expressionKind === KindNewExpression) {
      resolveCallSelectionPrerequisites(walk, expression, sourceFile);
      selectExpressionOperation(walk, expression, sourceFile);
      resolveExpressionOperationDependencies(walk, expression, sourceFile, contextualExpected);
    } else {
      resolveExpressionOperationDependencies(walk, expression, sourceFile, contextualExpected);
      selectExpressionOperation(walk, expression, sourceFile);
    }
    const selectedCarrier = facts.get(expression, rustRuntimeCarrierKey) ??
      walk.context.facts.resolve(expression, rustRuntimeCarrierKey);
    if (selectedCarrier !== undefined) {
      const operation = facts.get(expression, rustTargetOperationFactKey) ??
        walk.context.facts.resolve(expression, rustTargetOperationFactKey);
      recordSelectedOperationInputs(
        walk,
        expression,
        sourceFile,
        operation,
      );
      return finalize(selectedCarrier.carrier);
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
          : finalize(setCarrierFact(walk, expression, finalizedResult));
      }
    }
    const resolved = resolveExpressionCarrierUncached(
      walk,
      expression,
      sourceFile,
      contextualExpected,
    );
    return finalize(resolved);
  } finally {
    recordExpressionBindingEffects(walk, expression);
    walk.resolving.delete(expression);
  }
}

function rustExpressionResolutionExpectation(
  ast: AstReader,
  expression: Node,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  if (!isRustOptionCarrier(expected)) {
    return expected;
  }
  const kind = ast.kindName(expression);
  if (kind === KindConditionalExpression || kind === KindParenthesizedExpression ||
    kind === KindSatisfiesExpression || kind === "KindAsExpression" ||
    kind === "KindTypeAssertionExpression") {
    return expected;
  }
  return rustOptionElementCarrier(expected);
}

function expressionIsPlainAssignment(ast: AstReader, expression: Node): boolean {
  if (ast.kindName(expression) !== KindBinaryExpression) {
    return false;
  }
  const operator = BinaryExpression_OperatorToken(ast, expression);
  return operator !== undefined && ast.kindName(operator) === KindEqualsToken;
}

function applyFlowReadLane(
  walk: RustFactWalk,
  expression: Node,
  sourceCarrier: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  if (sourceCarrier === undefined) {
    return undefined;
  }
  const existing = walk.context.facts.get(expression, rustFlowReadProjectionFactKey) ??
    walk.context.facts.resolve(expression, rustFlowReadProjectionFactKey);
  if (existing !== undefined) {
    if (!rustTargetTypeRefEquals(existing.sourceCarrier, sourceCarrier)) {
      appendRustDiagnostic(
        walk,
        "RUST_FLOW_READ_SOURCE_CONFLICT",
        "The finalized Rust flow-read projection conflicts with the expression's raw runtime carrier.",
        expression,
        ["target.capability=rust.flow-read.exact-source"],
      );
      return undefined;
    }
    return existing.selectedCarrier;
  }
  const selectedSource = selectedFlowReadSource(walk, expression);
  if (selectedSource === undefined) {
    return sourceCarrier;
  }
  const selectedCarrier = resolveSelectedFlowReadCarrier(
    walk,
    expression,
    selectedSource.declaration,
    selectedSource.type,
    sourceCarrier,
  );
  if (selectedCarrier === undefined) {
    appendRustDiagnostic(
      walk,
      "RUST_FLOW_READ_SELECTED_CARRIER_MISSING",
      "The exact checker-selected source value has no closed Rust flow-read carrier.",
      expression,
      ["target.capability=rust.flow-read.exact-result"],
    );
    return undefined;
  }
  const selection = selectRustFlowReadProjection(
    sourceCarrier,
    selectedCarrier,
    walk.context.projectTypes,
  );
  if (selection.kind === "identity") {
    return sourceCarrier;
  }
  if (selection.kind === "incompatible") {
    appendRustDiagnostic(
      walk,
      "RUST_FLOW_READ_PROJECTION_UNSUPPORTED",
      "The raw Rust value cannot be projected to the exact checker-selected flow carrier.",
      expression,
      [
        "target.capability=rust.flow-read.closed-projection",
        `source=${JSON.stringify(sourceCarrier)}`,
        `selected=${JSON.stringify(selectedCarrier)}`,
      ],
    );
    return undefined;
  }
  recordRustFlowReadProjection(
    walk.context.facts,
    expression,
    selection.fact,
  );
  return selection.fact.selectedCarrier;
}

function selectedFlowReadSource(
  walk: RustFactWalk,
  expression: Node,
): { readonly declaration?: Node; readonly type: Type } | undefined {
  const sourceFile = walk.context.ast.getSourceFile(expression);
  if (sourceFile === undefined || !walk.context.source.semantics.includes(sourceFile)) {
    return undefined;
  }
  const semantics = walk.context.source.semantics.forNode(expression);
  const kind = walk.context.ast.kindName(expression);
  if (kind === KindPropertyAccessExpression) {
    const selected = semantics.getResolvedPropertyAccessInfo(expression);
    return selected?.callCallee === true || selected?.sourceReadType === undefined
      ? undefined
      : {
          ...(selected.selectedDeclaration === undefined
            ? {}
            : { declaration: selected.selectedDeclaration }),
          type: selected.sourceReadType,
        };
  }
  if (kind === KindElementAccessExpression) {
    const selected = semantics.getResolvedElementAccessInfo(expression);
    return selected?.callCallee === true || selected?.sourceReadType === undefined
      ? undefined
      : {
          ...(selected.selectedDeclaration === undefined
            ? {}
            : { declaration: selected.selectedDeclaration }),
          type: selected.sourceReadType,
        };
  }
  const refinement = walk.context.source.semantics.selectValueTypeRefinement(expression);
  return refinement.kind === "resolved" && refinement.refinement.kind === "members"
    ? { declaration: refinement.reference.declaration, type: refinement.selectedType }
    : undefined;
}

function resolveSelectedFlowReadCarrier(
  walk: RustFactWalk,
  expression: Node,
  declaration: Node | undefined,
  selectedType: Type,
  sourceCarrier: TargetTypeRef,
): TargetTypeRef | undefined {
  if (rustOptionElementCarrier(sourceCarrier) !== undefined &&
    walk.context.semanticsFor(expression).isNullish(selectedType)) {
    return sourceCarrier;
  }
  const operation = walk.context.facts.get(expression, rustTargetOperationFactKey) ??
    walk.context.facts.resolve(expression, rustTargetOperationFactKey);
  if (operation?.kind === "provider-operation" &&
    operation.sourceResultCarrier !== undefined) {
    return operation.sourceResultCarrier;
  }
  const typeNode = Node_Type(walk.context.ast, declaration);
  const typeSourceFile = typeNode === undefined
    ? undefined
    : walk.context.ast.getSourceFile(typeNode);
  if (typeNode !== undefined && typeSourceFile !== undefined &&
    walk.context.source.semantics.includes(typeSourceFile)) {
    const semantics = walk.context.source.semantics.forNode(typeNode);
    const authored = semantics.selectAuthoredType(typeNode, selectedType);
    if (authored.kind === "ambiguous") {
      return undefined;
    }
    if (authored.kind === "authored-members") {
      if (authored.nodes.length === 1 && authored.nodes[0] === typeNode &&
        authored.selectedNullishTypes.length === 0) {
        return sourceCarrier;
      }
      const selectedMembers = authored.nodes.map((node) =>
        resolveRustTargetTypeRef(
          node,
          rustResolutionContext(walk, node),
          walk.operationOptions,
        ));
      const optionalElement = rustOptionElementCarrier(sourceCarrier);
      if (selectedMembers.length === 1 &&
        selectedMembers[0]?.kind === "type-parameter" &&
        optionalElement !== undefined &&
        authored.selectedNullishTypes.length === 0) {
        return optionalElement;
      }
      if (selectedMembers.some((member) => member === undefined)) {
        return undefined;
      }
      return combineSelectedFlowReadCarriers(
        selectedMembers as readonly TargetTypeRef[],
        authored.selectedNullishTypes.length > 0,
        walk,
      );
    }
    return sourceCarrier;
  }
  const semanticCarrier = resolveRustTargetTypeRef(
    selectedType,
    rustResolutionContext(walk, expression),
    walk.operationOptions,
  );
  const optionalElement = rustOptionElementCarrier(sourceCarrier);
  if (optionalElement === undefined) {
    return semanticCarrier !== undefined &&
        walk.context.projectTypes.definitionForCarrier(sourceCarrier) !== undefined &&
        walk.context.projectTypes.definitionForCarrier(semanticCarrier) !== undefined
      ? semanticCarrier
      : sourceCarrier;
  }
  const selectedMembers = walk.context.semanticsFor(expression).isUnion(selectedType)
    ? walk.context.semanticsFor(expression).getUnionOrIntersectionTypes(selectedType)
    : [selectedType];
  if (selectedMembers.some((member) => member === undefined)) {
    return undefined;
  }
  const includesNullish = selectedMembers.some((member) =>
    member !== undefined && walk.context.semanticsFor(expression).isNullish(member));
  if (includesNullish) {
    return sourceCarrier;
  }
  return semanticCarrier !== undefined &&
      walk.context.projectTypes.definitionForCarrier(semanticCarrier) !== undefined
    ? semanticCarrier
    : optionalElement;
}

function combineSelectedFlowReadCarriers(
  members: readonly TargetTypeRef[],
  includesNullish: boolean,
  walk: RustFactWalk,
): TargetTypeRef | undefined {
  const distinct = members.filter((member, index) =>
    members.findIndex((candidate) => rustTargetTypeRefEquals(candidate, member)) === index);
  const valueCarrier = distinct.length === 1
    ? distinct[0]
    : walk.context.projectTypes.commonSupertype(distinct);
  if (valueCarrier === undefined) {
    return includesNullish && distinct.length === 0
      ? rustNullishSourceTargetType()
      : undefined;
  }
  return includesNullish ? rustOptionTargetType(valueCarrier) : valueCarrier;
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
    resolveBinaryOperandCarriers(walk, expression, sourceFile, expected, true);
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
        resolveCallArgumentOperationPrerequisite(walk, argument, sourceFile);
      }
    }
    return;
  }
  if (kind === "KindAsExpression" || kind === "KindTypeAssertionExpression") {
    const operand = Node_Expression(ast, expression);
    if (operand !== undefined) {
      resolveExpressionCarrier(walk, operand, sourceFile, undefined);
    }
    return;
  }
  if (kind === KindCallExpression || kind === KindNewExpression) {
    return;
  }
}

function resolveCallArgumentOperationPrerequisite(
  walk: RustFactWalk,
  argument: Node,
  sourceFile: SourceFile,
): void {
  const kind = walk.context.ast.kindName(argument);
  const refinement = walk.context.source.semantics.selectValueTypeRefinement(argument);
  if (refinement.kind === "resolved") {
    resolveExpressionCarrier(walk, argument, sourceFile, undefined);
    return;
  }
  if (kind === KindCallExpression || kind === KindNewExpression ||
    kind === "KindRegularExpressionLiteral" ||
    kind === KindPropertyAccessExpression || kind === KindElementAccessExpression ||
    kind === KindBinaryExpression || kind === KindPrefixUnaryExpression ||
    kind === KindPostfixUnaryExpression) {
    resolveExpressionCarrier(walk, argument, sourceFile, undefined);
    return;
  }
  if (kind === KindNonNullExpression) {
    resolveExpressionCarrier(walk, argument, sourceFile, undefined);
    return;
  }
  if (kind === "KindAsExpression" || kind === "KindTypeAssertionExpression") {
    resolveExpressionCarrier(walk, argument, sourceFile, undefined);
    return;
  }
  if (kind === KindParenthesizedExpression || kind === KindSatisfiesExpression) {
    const inner = Node_Expression(walk.context.ast, argument);
    if (inner !== undefined) {
      resolveCallArgumentOperationPrerequisite(walk, inner, sourceFile);
    }
  }
}

function resolveCallSelectionPrerequisites(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
): void {
  const source = walk.context.semantics(sourceFile).getResolvedCallInfo(expression);
  const receiver = source?.sourceReceiver?.expression;
  if (receiver !== undefined) {
    resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
  }
  for (const argument of source?.sourceArguments ?? []) {
    resolveIndependentCallArgumentOperation(
      walk,
      argument.expression,
      sourceFile,
    );
  }
}

function resolveIndependentCallArgumentOperation(
  walk: RustFactWalk,
  argument: Node,
  sourceFile: SourceFile,
): void {
  const { ast } = walk.context;
  const kind = ast.kindName(argument);
  if (kind === KindCallExpression || kind === KindNewExpression ||
    kind === "KindRegularExpressionLiteral" ||
    kind === KindPropertyAccessExpression || kind === KindElementAccessExpression ||
    kind === KindNonNullExpression || kind === "KindAsExpression" ||
    kind === "KindTypeAssertionExpression") {
    resolveExpressionCarrier(walk, argument, sourceFile, undefined);
    return;
  }
  if (kind === KindParenthesizedExpression || kind === KindSatisfiesExpression ||
    kind === KindSpreadElement) {
    const inner = Node_Expression(ast, argument);
    if (inner !== undefined) {
      resolveIndependentCallArgumentOperation(walk, inner, sourceFile);
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
  const expectedOptionElement = rustOptionElementCarrier(expected);
  const target = expectedOptionElement !== undefined && isRustOptionCarrier(resolved)
    ? expected
    : expectedOptionElement ?? expected;
  let projected = resolved;
  if (resolved !== undefined && target !== undefined &&
    !rustTargetTypeRefEquals(resolved, target)) {
    const reconciliation = selectRustValueCarrierReconciliation(
      resolved,
      target,
      walk.context.projectTypes,
    );
    if (reconciliation.kind === "incompatible" && reconciliation.reason === "ambiguous") {
      appendRustDiagnostic(
        walk,
        "RUST_PROJECT_UPCAST_AMBIGUOUS",
        "The selected project value has more than one exact target heritage instantiation.",
        expression,
        ["target.capability=rust.project-types.upcast"],
      );
      return undefined;
    }
    if (reconciliation.kind === "conversion" || reconciliation.kind === "project-upcast") {
      recordRustValueCarrierReconciliation(walk.context.facts, expression, reconciliation);
      projected = target;
      if (reconciliation.kind === "project-upcast" && !isRustOptionCarrier(expected)) {
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
  if (isRustDefinitelyNullishCarrier(projected)) {
    const existing = walk.context.facts.get(expression, rustTargetOperationFactKey);
    if (existing === undefined) {
      setRustOperationFact(walk, expression, { kind: "option-none", operationId: "tsonic.rust.option.none" });
    }
    if (projected !== undefined) {
      walk.context.facts.set(expression, rustOptionProjectionFactKey, {
        kind: "none",
        sourceCarrier: projected,
        resultCarrier: expected,
      }, [{ message: "rust exact option-none projection" }]);
    }
    return expected;
  }
  if (projected !== undefined && rustTargetTypeRefEquals(projected, inner)) {
    walk.context.facts.set(expression, rustOptionProjectionFactKey, {
      kind: "some",
      sourceCarrier: projected,
      elementCarrier: inner,
      resultCarrier: expected,
    }, [{ message: "rust exact option-some projection" }]);
    return expected;
  }
  return resolved;
}

function reconcileRequiredCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceCarrier: TargetTypeRef,
  targetCarrier: TargetTypeRef,
): boolean {
  const reconciliation = selectRustValueCarrierReconciliation(
    sourceCarrier,
    targetCarrier,
    walk.context.projectTypes,
  );
  if (reconciliation.kind === "incompatible") {
    return false;
  }
  if (reconciliation.kind === "conversion" || reconciliation.kind === "project-upcast") {
    recordRustValueCarrierReconciliation(
      walk.context.facts,
      expression,
      reconciliation,
    );
  }
  return true;
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
      const contextualExpected = expected !== undefined && isRustOptionCarrier(expected)
        ? rustOptionElementCarrier(expected)
        : expected;
      const effectiveExpected = contextualExpected ??
        rustSourcePrimitiveTargetType("float64");
      if (effectiveExpected !== undefined && isRustNumericCarrier(effectiveExpected) &&
        (!isRustIntegerCarrier(effectiveExpected) ||
          (selectedSourceLiteralIsRepresentable(
            expression,
            effectiveExpected.name,
            walk.context.ast,
          ) || selectedSourceLiteralOperandIsRepresentable(
            expression,
            effectiveExpected.name,
            walk.context.ast,
          )))) {
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
      if (effectiveExpected !== undefined && isRustIntegerCarrier(effectiveExpected)) {
        if (selectedSourceLiteralIsRepresentable(
          expression,
          effectiveExpected.name,
          walk.context.ast,
        ) || selectedSourceLiteralOperandIsRepresentable(
          expression,
          effectiveExpected.name,
          walk.context.ast,
        )) {
          return setCarrierFact(walk, expression, effectiveExpected);
        }
        appendRustDiagnostic(
          walk,
          "RUST_INTEGER_LITERAL_NOT_EXACT",
          "BigInt literal cannot be proven exact for the finalized Rust fixed-width carrier.",
          expression,
          [`target.carrier=${effectiveExpected.name}`],
        );
        return undefined;
      }
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
        if (expected.kind === "source-primitive" && expected.name === "char") {
          if (sourceCharCodeUnit(walk.context.ast.text(expression)) === undefined) {
            appendRustDiagnostic(
              walk,
              "RUST_CHAR_LITERAL_NOT_EXACT",
              "A neutral char literal must contain exactly one UTF-16 code unit.",
              expression,
              ["target.carrier=char"],
            );
            return undefined;
          }
          return setCarrierFact(walk, expression, expected);
        }
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
      return setCarrierFact(walk, expression, rustNullTargetType());
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
    case KindSatisfiesExpression: {
      const inner = Node_Expression(walk.context.ast, expression);
      const carrier = inner === undefined
        ? undefined
        : resolveExpressionCarrier(walk, inner, sourceFile, expected);
      if (carrier === undefined) {
        return undefined;
      }
      const resultCarrier = expected ?? carrier;
      if (!rustTargetTypeRefEquals(carrier, resultCarrier)) {
        return undefined;
      }
      setRustOperationFact(walk, expression, {
        kind: "identity-expression",
        operationId: "tsonic.rust.syntax.satisfies",
        resultCarrier,
      });
      return setCarrierFact(walk, expression, resultCarrier);
    }
    case KindNonNullExpression: {
      const inner = Node_Expression(walk.context.ast, expression);
      const sourceCarrier = inner === undefined
        ? undefined
        : resolveExpressionCarrier(walk, inner, sourceFile, undefined);
      if (sourceCarrier === undefined) {
        return undefined;
      }
      const resultCarrier = rustOptionElementCarrier(sourceCarrier) ?? sourceCarrier;
      setRustOperationFact(walk, expression, {
        kind: "non-null-expression",
        operationId: rustTargetTypeRefEquals(sourceCarrier, resultCarrier)
          ? "tsonic.rust.syntax.non-null.identity"
          : "tsonic.rust.syntax.non-null.option-value",
        sourceCarrier,
        resultCarrier,
      });
      return setCarrierFact(walk, expression, resultCarrier);
    }
    case KindSpreadElement: {
      const inner = Node_Expression(walk.context.ast, expression);
      const carrier = inner === undefined
        ? undefined
        : resolveExpressionCarrier(walk, inner, sourceFile, expected);
      return carrier === undefined
        ? undefined
        : setCarrierFact(walk, expression, carrier);
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
        : rustTypeofResult(operandCarrier);
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
      const semantics = walk.context.semanticsFor(expression);
      const source = semantics.getResolvedPropertyAccessInfo(expression);
      if (source === undefined || source.callCallee) {
        return undefined;
      }
      const receiverCarrier = resolveExpressionCarrier(
        walk,
        source.receiver.expression,
        sourceFile,
        undefined,
      );
      if (receiverCarrier === undefined) {
        return undefined;
      }
      let operation = walk.context.facts.get(expression, rustTargetOperationFactKey) ??
        walk.context.facts.resolve(expression, rustTargetOperationFactKey);
      if (operation === undefined) {
        recordPolicySelection(walk, expression, selectRustCheckedPropertyAccess(
          checkedPropertySelectionInput(walk, expression, source),
          rustOperationContext(walk, expression),
          walk.operationOptions,
        ));
        operation = walk.context.facts.get(expression, rustTargetOperationFactKey) ??
          walk.context.facts.resolve(expression, rustTargetOperationFactKey);
      }
      const resultCarrier = operation === undefined
        ? undefined
        : rustTargetOperationResultCarrier(operation);
      return resultCarrier === undefined
        ? undefined
        : setCarrierFact(walk, expression, resultCarrier);
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
        [
          "target.capability=rust.syntax.template",
          `substitution.carrier=${JSON.stringify(carrier)}`,
        ],
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
  carrier: TargetTypeRef,
): Extract<RustTargetOperationFact, { readonly kind: "typeof" }>["result"] | undefined {
  if (isRustNullCarrier(carrier)) {
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
  const selectedAssignmentValueCarrier = operatorKind === KindEqualsToken
    ? rustSelectedAssignmentValueCarrier(
        walk.context.facts.get(expression, rustTargetOperationFactKey) ??
          walk.context.facts.resolve(expression, rustTargetOperationFactKey),
      )
    : undefined;
  if (rustBinaryResultCarrierIsIndependentOfOperands(operatorKind)) {
    const strictEquality = operatorKind === KindEqualsEqualsEqualsToken ||
      operatorKind === KindExclamationEqualsEqualsToken;
    let { left, right } = resolveContextualBinaryOperandCarriers(
      walk,
      leftNode,
      rightNode,
      sourceFile,
      undefined,
    );
    if (strictEquality && left !== undefined && right !== undefined &&
      selectRustBinaryOperator(operatorKind, left, right) === undefined) {
      const rightAsLeft = resolveExpressionCarrier(walk, rightNode, sourceFile, left);
      if (rightAsLeft !== undefined &&
        selectRustBinaryOperator(operatorKind, left, rightAsLeft) !== undefined) {
        right = rightAsLeft;
      } else {
        const leftAsRight = resolveExpressionCarrier(walk, leftNode, sourceFile, right);
        if (leftAsRight !== undefined &&
          selectRustBinaryOperator(operatorKind, leftAsRight, right) !== undefined) {
          left = leftAsRight;
        }
      }
    }
    return { left, right, leftNode, rightNode, operatorKind };
  }
  if (operatorKind !== KindQuestionQuestionToken &&
    !isRustAssignmentOperator(operatorKind) &&
    !rustBinaryRightCarrierIsIndependentOfLeft(operatorKind)) {
    const { left, right } = resolveContextualBinaryOperandCarriers(
      walk,
      leftNode,
      rightNode,
      sourceFile,
      expected,
    );
    return { left, right, leftNode, rightNode, operatorKind };
  }
  let left = resolveExpressionCarrier(
    walk,
    leftNode,
    sourceFile,
    undefined,
  );
  if (left === undefined) {
    const leftSemanticCarrier = resolveRustTargetTypeRef(
      leftNode,
      rustResolutionContext(walk, leftNode),
      walk.operationOptions,
    );
    left = resolveExpressionCarrier(
      walk,
      leftNode,
      sourceFile,
      leftSemanticCarrier,
    );
  }
  const initialRightExpectation = operatorKind === KindQuestionQuestionToken
    ? rustOptionElementCarrier(left) ?? expected
    : operatorKind === KindEqualsToken
      ? selectedAssignmentValueCarrier ??
        (useAssignmentReadCarrier ? left : undefined)
      : rustBinaryRightCarrierIsIndependentOfLeft(operatorKind)
        ? undefined
        : left;
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

function resolveContextualBinaryOperandCarriers(
  walk: RustFactWalk,
  leftNode: Node,
  rightNode: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): {
  readonly left: TargetTypeRef | undefined;
  readonly right: TargetTypeRef | undefined;
} {
  const leftUsesContext = expressionUsesContextualLiteralCarrier(walk.context.ast, leftNode);
  const rightUsesContext = expressionUsesContextualLiteralCarrier(walk.context.ast, rightNode);
  if (leftUsesContext && rightUsesContext && expected !== undefined) {
    return {
      left: resolveExpressionCarrier(walk, leftNode, sourceFile, expected),
      right: resolveExpressionCarrier(walk, rightNode, sourceFile, expected),
    };
  }
  if (leftUsesContext && !rightUsesContext) {
    const right = resolveExpressionCarrier(walk, rightNode, sourceFile, undefined);
    return {
      left: resolveExpressionCarrier(
        walk,
        leftNode,
        sourceFile,
        isRustNullishSourceCarrier(right) ? undefined : right,
      ),
      right,
    };
  }
  if (rightUsesContext && !leftUsesContext) {
    const left = resolveExpressionCarrier(walk, leftNode, sourceFile, undefined);
    return {
      left,
      right: resolveExpressionCarrier(
        walk,
        rightNode,
        sourceFile,
        isRustNullishSourceCarrier(left) ? undefined : left,
      ),
    };
  }
  return {
    left: resolveExpressionCarrier(walk, leftNode, sourceFile, undefined),
    right: resolveExpressionCarrier(walk, rightNode, sourceFile, undefined),
  };
}

function rustSelectedAssignmentValueCarrier(
  fact: RustTargetOperationFact | undefined,
): TargetTypeRef | undefined {
  if (fact?.kind !== "runtime-set") {
    return undefined;
  }
  const values = fact.abi.sourceArguments.filter((argument) =>
    argument.role === "parameter" && argument.disposition === "runtime");
  return values.length === 1 ? values[0]!.carrier : undefined;
}

function expressionUsesContextualLiteralCarrier(ast: AstReader, expression: Node): boolean {
  const kind = ast.kindName(expression);
  if (kind === KindNumericLiteral || kind === KindBigIntLiteral || kind === KindStringLiteral) {
    return true;
  }
  if (kind === KindPrefixUnaryExpression || kind === KindParenthesizedExpression) {
    const operand = kind === KindPrefixUnaryExpression
      ? Node_Operand(ast, expression)
      : Node_Expression(ast, expression);
    return operand !== undefined && expressionUsesContextualLiteralCarrier(ast, operand);
  }
  return false;
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
  const strictEquality = operatorKind === KindEqualsEqualsEqualsToken ||
    operatorKind === KindExclamationEqualsEqualsToken;
  const leftComparisonCarrier = strictEquality
    ? strictEqualityOperandCarrier(walk, operands.leftNode, left)
    : left;
  const rightComparisonCarrier = strictEquality
    ? strictEqualityOperandCarrier(walk, operands.rightNode, right)
    : right;
  const leftOptionElement = rustOptionElementCarrier(leftComparisonCarrier);
  const rightOptionElement = rustOptionElementCarrier(rightComparisonCarrier);
  const optionNullishRelationship = selectedOptionNullishRelationship(
    walk,
    operands.leftNode,
    operands.rightNode,
    leftComparisonCarrier,
    rightComparisonCarrier,
  );
  const optionNullishOperand = isRustOptionCarrier(leftComparisonCarrier)
    ? "left" as const
    : isRustOptionCarrier(rightComparisonCarrier)
      ? "right" as const
      : undefined;
  const optionNullishCarrier = optionNullishOperand === "left"
    ? leftComparisonCarrier
    : optionNullishOperand === "right"
      ? rightComparisonCarrier
      : undefined;
  const comparedNullishCarrier = optionNullishOperand === "left"
    ? rightComparisonCarrier
    : optionNullishOperand === "right"
      ? leftComparisonCarrier
      : undefined;
  const optionValueOperand = leftOptionElement !== undefined && rightComparisonCarrier !== undefined &&
      rustTargetTypeRefEquals(leftOptionElement, rightComparisonCarrier)
    ? "left" as const
    : rightOptionElement !== undefined && leftComparisonCarrier !== undefined &&
        rustTargetTypeRefEquals(rightOptionElement, leftComparisonCarrier)
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
        rightOperand: "value",
        resultCarrier: inner,
      };
    } else if (inner !== undefined && left !== undefined && right !== undefined &&
      rustTargetTypeRefEquals(left, right)) {
      fact = {
        kind: "option-coalesce",
        operationId: "tsonic.rust.option.coalesce-option",
        rightOperand: "option",
        resultCarrier: left,
      };
    } else if (inner !== undefined && isRustDefinitelyNullishCarrier(right) && left !== undefined) {
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
    optionNullishRelationship === "member" &&
    optionNullishOperand !== undefined && optionNullishCarrier !== undefined &&
    comparedNullishCarrier !== undefined) {
    fact = {
      kind: "option-check",
      operationId: operatorKind === KindExclamationEqualsEqualsToken
        ? "tsonic.rust.option.is-some"
        : "tsonic.rust.option.is-none",
      negated: operatorKind === KindExclamationEqualsEqualsToken,
      optionOperand: optionNullishOperand,
      optionCarrier: optionNullishCarrier,
      nullishCarrier: comparedNullishCarrier,
    };
  } else if ((operatorKind === KindEqualsEqualsEqualsToken ||
      operatorKind === KindExclamationEqualsEqualsToken) &&
    optionNullishRelationship === "disjoint") {
    fact = {
      kind: "disjoint-equality",
      operationId: operatorKind === KindExclamationEqualsEqualsToken
        ? "tsonic.rust.equality.option-nullish-disjoint.not-equal"
        : "tsonic.rust.equality.option-nullish-disjoint.equal",
      resultCarrier: rustSourcePrimitiveTargetType("bool"),
      value: operatorKind === KindExclamationEqualsEqualsToken,
    };
  } else if ((operatorKind === KindEqualsEqualsEqualsToken ||
      operatorKind === KindExclamationEqualsEqualsToken) &&
    isRustDefinitelyNullishCarrier(left) && isRustDefinitelyNullishCarrier(right) &&
    !rustTargetTypeRefEquals(left, right)) {
    fact = {
      kind: "disjoint-equality",
      operationId: operatorKind === KindExclamationEqualsEqualsToken
        ? "tsonic.rust.equality.nullish-disjoint.not-equal"
        : "tsonic.rust.equality.nullish-disjoint.equal",
      resultCarrier: rustSourcePrimitiveTargetType("bool"),
      value: operatorKind === KindExclamationEqualsEqualsToken,
    };
  } else if ((operatorKind === KindEqualsEqualsEqualsToken ||
      operatorKind === KindExclamationEqualsEqualsToken) &&
    ((isRustDefinitelyNullishCarrier(left) && right !== undefined &&
        !isRustDefinitelyNullishCarrier(right) && !isRustOptionCarrier(right)) ||
      (isRustDefinitelyNullishCarrier(right) && left !== undefined &&
        !isRustDefinitelyNullishCarrier(left) && !isRustOptionCarrier(left)))) {
    fact = {
      kind: "disjoint-equality",
      operationId: operatorKind === KindExclamationEqualsEqualsToken
        ? "tsonic.rust.equality.disjoint.not-equal"
        : "tsonic.rust.equality.disjoint.equal",
      resultCarrier: rustSourcePrimitiveTargetType("bool"),
      value: operatorKind === KindExclamationEqualsEqualsToken,
    };
  } else if ((operatorKind === KindEqualsEqualsEqualsToken ||
      operatorKind === KindExclamationEqualsEqualsToken) &&
    isRustOptionCarrier(leftComparisonCarrier) && isRustOptionCarrier(rightComparisonCarrier) &&
    leftComparisonCarrier !== undefined && rightComparisonCarrier !== undefined &&
    rustTargetTypeRefEquals(leftComparisonCarrier, rightComparisonCarrier)) {
    fact = {
      kind: "option-equality",
      operationId: operatorKind === KindExclamationEqualsEqualsToken
        ? "tsonic.rust.option.not-equal"
        : "tsonic.rust.option.equal",
      negated: operatorKind === KindExclamationEqualsEqualsToken,
      optionCarrier: leftComparisonCarrier,
    };
  } else if ((operatorKind === KindEqualsEqualsEqualsToken ||
      operatorKind === KindExclamationEqualsEqualsToken) && optionValueOperand !== undefined) {
    const optionCarrier = optionValueOperand === "left" ? leftComparisonCarrier : rightComparisonCarrier;
    const valueCarrier = optionValueOperand === "left" ? rightComparisonCarrier : leftComparisonCarrier;
    if (optionCarrier === undefined || valueCarrier === undefined) {
      return undefined;
    }
    fact = {
      kind: "option-value-equality",
      operationId: operatorKind === KindExclamationEqualsEqualsToken
        ? "tsonic.rust.option.value-not-equal"
        : "tsonic.rust.option.value-equal",
      negated: operatorKind === KindExclamationEqualsEqualsToken,
      optionOperand: optionValueOperand,
      optionCarrier,
      valueCarrier,
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
      fact = compound.kind === "operator-call"
        ? {
            kind: "operator-call",
            operationId: `tsonic.rust.operator.${compound.operator}.${rustOperatorCarrierKey(left)}`,
            operator: compound.operator,
            path: compound.path,
            resultCarrier: compound.resultCarrier,
            fallible: compound.fallible,
            operandModes: compound.operandModes,
          }
        : {
            kind: "operator-token",
            operationId: `tsonic.rust.operator.${compound.operator}.${rustOperatorCarrierKey(left)}`,
            operator: compound.operator,
            resultCarrier: compound.resultCarrier,
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
          : binary.kind === "operator-call"
            ? {
                kind: "operator-call",
                operationId: `tsonic.rust.operator.${binary.rustOperator}.${rustOperatorCarrierKey(binary.resultCarrier)}`,
                operator: binary.rustOperator,
                path: binary.path,
                resultCarrier: binary.resultCarrier,
                fallible: binary.fallible,
                operandModes: binary.operandModes,
                ...(binary.leftConversion === undefined
                  ? {}
                  : { leftConversion: binary.leftConversion }),
                ...(binary.rightConversion === undefined
                  ? {}
                  : { rightConversion: binary.rightConversion }),
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
          `left=${JSON.stringify(left)}`,
          `right=${JSON.stringify(right)}`,
        ],
      );
    }
    return undefined;
  }
  const resultCarrier = rustTargetOperationResultCarrier(fact);
  if (resultCarrier === undefined) {
    return undefined;
  }
  setRustOperationFact(walk, expression, fact);
  recordFinalizedOperatorSelection(walk, expression, fact, resultCarrier);
  return setCarrierFact(walk, expression, resultCarrier);
}

function selectedOptionNullishRelationship(
  walk: RustFactWalk,
  leftNode: Node,
  rightNode: Node,
  leftCarrier: TargetTypeRef | undefined,
  rightCarrier: TargetTypeRef | undefined,
): "member" | "disjoint" | undefined {
  const leftIsOption = isRustOptionCarrier(leftCarrier);
  const rightIsOption = isRustOptionCarrier(rightCarrier);
  const optionNode = leftIsOption && isRustDefinitelyNullishCarrier(rightCarrier)
    ? leftNode
    : rightIsOption && isRustDefinitelyNullishCarrier(leftCarrier)
      ? rightNode
      : undefined;
  const nullishNode = optionNode === leftNode
    ? rightNode
    : optionNode === rightNode
      ? leftNode
      : undefined;
  if (optionNode === undefined || nullishNode === undefined) {
    return undefined;
  }
  const optionFact = walk.context.facts.get(optionNode, rustTargetOperationFactKey) ??
    walk.context.facts.resolve(optionNode, rustTargetOperationFactKey);
  if (optionFact?.kind === "provider-operation" &&
    optionFact.sourceAbsenceCarrier !== undefined) {
    const comparedNullishCarrier = optionNode === leftNode ? rightCarrier : leftCarrier;
    if (comparedNullishCarrier === undefined) {
      return undefined;
    }
    return rustTargetTypeRefEquals(optionFact.sourceAbsenceCarrier, comparedNullishCarrier)
      ? "member"
      : "disjoint";
  }
  const optionSemantics = walk.context.semanticsFor(optionNode);
  const nullishSemantics = walk.context.semanticsFor(nullishNode);
  const optionType = optionSemantics.getTypeAtLocation(optionNode);
  const nullishType = nullishSemantics.getTypeAtLocation(nullishNode);
  if (optionType === undefined || nullishType === undefined ||
    !nullishSemantics.isNullish(nullishType)) {
    return undefined;
  }
  const members = optionSemantics.isUnion(optionType)
    ? optionSemantics.getUnionOrIntersectionTypes(optionType)
    : [optionType];
  const nullishMembers = members.filter((member) => optionSemantics.isNullish(member));
  if (nullishMembers.length !== 1) {
    return undefined;
  }
  return optionSemantics.getTypeRelationship(nullishMembers[0]!, nullishType) === "identical"
    ? "member"
    : "disjoint";
}

function strictEqualityOperandCarrier(
  walk: RustFactWalk,
  operand: Node,
  effectiveCarrier: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const runtimeCarrier = walk.context.facts.getRuntimeCarrierFact(operand)?.carrier;
  if (isRustOptionCarrier(runtimeCarrier)) {
    return runtimeCarrier;
  }
  const optionProjection = walk.context.facts.getFact(operand, rustOptionProjectionFactKey);
  return optionProjection !== undefined && isRustOptionCarrier(optionProjection.resultCarrier)
    ? optionProjection.sourceCarrier
    : effectiveCarrier;
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
    recordProjectSourceBinding(walk, identifier);
    if (declarationKind === KindExportAssignment) {
      const exportCarrier = recordExportAssignmentFacts(walk, declaration);
      if (exportCarrier !== undefined) {
        return setCarrierFact(walk, identifier, exportCarrier);
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
      const targetName = walk.context.names.functionNameForDeclaration(declaration);
      if (name !== undefined && parameterAbis.every((abi) => abi !== undefined) &&
        returnCarrier !== undefined && targetName !== undefined) {
        const closedParameterAbis = parameterAbis as import("../rust-facts/keys.js").RustSourceParameterAbiFact[];
        const callableCarrier = rustCallableTargetType(
          closedParameterAbis.map(rustSourceParameterContractCarrier),
          returnCarrier,
        );
        walk.context.facts.set(identifier, rustSourceCallableValueFactKey, {
          form: "function",
          sourceDeclaration: declaration,
          fileName: ast.getFileName(ast.getSourceFile(declaration)),
          name: targetName,
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
  const nullishCarrier = semanticType !== undefined && semantics.isNullish(semanticType)
    ? resolveRustExactNullishValueCarrier(semanticType, semantics)
    : undefined;
  return nullishCarrier === undefined
    ? undefined
    : setCarrierFact(walk, identifier, nullishCarrier);
}

function recordProjectSourceBinding(
  walk: RustFactWalk,
  identifier: Node,
): RustSourceBindingFact | undefined {
  const { ast } = walk.context;
  const reference = walk.context.source.navigation.sourceReferenceFor(identifier);
  const declaration = reference?.declaration;
  if (reference === undefined || declaration === undefined || !reference.project ||
    isImportBindingDeclarationKind(ast.kindName(declaration))) {
    return undefined;
  }
  const declarationKind = ast.kindName(declaration);
  const declarationName = ast.name(declaration);
  const sourceName = declarationKind === KindExportAssignment
    ? "default"
    : declarationName === undefined
      ? ""
      : ast.text(declarationName);
  if (sourceName.length === 0 ||
    walk.context.names.nameForDeclaration(declaration) === undefined) {
    return undefined;
  }
  const binding: RustSourceBindingFact = declarationIsModuleScoped(declaration, ast)
    ? {
        scope: "module",
        sourceName,
        fileName: ast.getFileName(ast.getSourceFile(declaration)),
        sourceDeclaration: declaration,
      }
    : { scope: "lexical", sourceName, sourceDeclaration: declaration };
  walk.context.facts.set(identifier, rustSourceBindingFactKey, binding, [
    { message: `rust project-source ${binding.scope} binding` },
  ]);
  return binding;
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
  const sharedMarkerCarrier = resolveSharedSourceMarkerCarrier(
    walk,
    expression,
    sourceFile,
    expected,
  );
  if (sharedMarkerCarrier.handled) {
    return sharedMarkerCarrier.carrier;
  }
  const callArguments = ast.arguments(expression);
  const flowHandled = tryFlowMarkerCall(walk, expression, callArguments, sourceFile, expected);
  if (flowHandled !== undefined) {
    return flowHandled.carrier;
  }
  const deferred = walk.deferredCallbackCalls.get(expression);
  if (deferred !== undefined) {
    walk.deferredCallbackCalls.delete(expression);
    const prepared = prepareRustDeferredCheckedCall(
      deferred.request,
      deferred.selection,
      rustOperationContext(walk, expression),
      walk.operationOptions,
      (argument, argumentExpected) =>
        resolveExpressionCarrier(walk, argument, sourceFile, argumentExpected),
    );
    if (prepared.kind === "reject") {
      walk.context.diagnostics.push(
        rustPolicyTargetDiagnostic(prepared.diagnostic),
      );
      return undefined;
    }
    walk.preparedCallbackCalls.set(expression, {
      request: deferred.request,
      prepared: prepared.value,
    });
    walk.context.facts.set(expression, rustPreparedOperationResultFactKey, {
      operationId: prepared.value.template.operationId,
      operationKind: prepared.value.template.operationKind,
      resultCarrier: prepared.value.resultCarrier,
    }, [{ message: "rust exact prepared callback operation result" }]);
    return setCarrierFact(walk, expression, prepared.value.resultCarrier);
  }
  const selectedSignature = walk.context.facts.get(expression, rustSelectedCallKey) ??
    walk.context.facts.resolve(expression, rustSelectedCallKey);
  if (selectedSignature?.sourceCallableCarrier !== undefined) {
    return applySelectedRuntimeCallableCall(
      walk,
      expression,
      callee,
      callArguments,
      sourceFile,
      selectedSignature,
    );
  }
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

function isSharedSourceMarkerOperation(
  walk: RustFactWalk,
  expression: Node,
): boolean {
  const sourceFacts = walk.context.source.sourceFacts;
  return readRustSourceNativePointerOperation(sourceFacts, expression) !== undefined ||
    readRustSourceUnsafeContext(sourceFacts, expression) !== undefined ||
    readRustSourceSafetyBuilder(sourceFacts, expression) !== undefined;
}

type RustSharedSourceMarkerCarrierResolution =
  | { readonly handled: false }
  | { readonly handled: true; readonly carrier?: TargetTypeRef };

function resolveSharedSourceMarkerCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): RustSharedSourceMarkerCarrierResolution {
  const sourceFacts = walk.context.source.sourceFacts;
  const nativePointer = readRustSourceNativePointerOperation(
    sourceFacts,
    expression,
  );
  if (nativePointer !== undefined) {
    return {
      handled: true,
      ...resolvedNativePointerCarrier(
        walk,
        expression,
        sourceFile,
        nativePointer,
      ),
    };
  }
  const unsafeContext = readRustSourceUnsafeContext(sourceFacts, expression);
  if (unsafeContext !== undefined) {
    if (unsafeContext.kind === "remaining-block") {
      return {
        handled: true,
        carrier: setCarrierFact(walk, expression, rustUnitTargetType()),
      };
    }
    const carrier = resolveExpressionCarrier(
      walk,
      unsafeContext.expression,
      sourceFile,
      expected,
    );
    return {
      handled: true,
      ...(carrier === undefined
        ? {}
        : { carrier: setCarrierFact(walk, expression, carrier) }),
    };
  }
  if (readRustSourceSafetyBuilder(sourceFacts, expression) !== undefined) {
    return {
      handled: true,
      carrier: setCarrierFact(walk, expression, rustUnitTargetType()),
    };
  }
  return { handled: false };
}

function resolvedNativePointerCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  source: import("@tsonic/source-core").TsonicNativePointerOperationFact,
): { readonly carrier?: TargetTypeRef } {
  const pointerCarrier = resolveExpressionCarrier(
    walk,
    source.pointerExpression,
    sourceFile,
    undefined,
  );
  if (pointerCarrier?.kind !== "pointer") {
    appendRustDiagnostic(
      walk,
      "RUST_NATIVE_POINTER_OPERATION_NOT_MAPPED",
      `Rust native-pointer '${source.operation}' requires one exact native-pointer operand carrier.`,
      expression,
      ["target.capability=rust.native-pointer.exact-operand"],
    );
    return {};
  }
  if (source.explicitPointeeTypeNode !== undefined) {
    const explicitPointee = resolveRustTargetTypeRef(
      source.explicitPointeeTypeNode,
      rustResolutionContext(walk, source.explicitPointeeTypeNode),
      walk.operationOptions,
    );
    if (!rustTargetTypeRefEquals(explicitPointee, pointerCarrier.pointee)) {
      appendRustDiagnostic(
        walk,
        "RUST_NATIVE_POINTER_POINTEE_CONFLICT",
        "The authored pointee type and selected native-pointer operand do not have one exact Rust representation.",
        expression,
        ["target.capability=rust.native-pointer.exact-pointee"],
      );
      return {};
    }
  }
  let resultCarrier: TargetTypeRef;
  let fact: Extract<RustTargetOperationFact, { readonly kind: "native-pointer" }>;
  switch (source.operation) {
    case "load":
      resultCarrier = pointerCarrier.pointee;
      fact = {
        kind: "native-pointer",
        operationId: "tsonic.rust.native-pointer.load",
        operation: source.operation,
        pointerExpression: source.pointerExpression,
        pointerCarrier,
        pointeeCarrier: pointerCarrier.pointee,
        resultCarrier,
      };
      break;
    case "store": {
      const valueCarrier = resolveExactNativePointerOperandCarrier(
        walk,
        source.valueExpression,
        sourceFile,
        pointerCarrier.pointee,
      );
      if (!rustTargetTypeRefEquals(valueCarrier, pointerCarrier.pointee)) {
        appendRustDiagnostic(
          walk,
          "RUST_NATIVE_POINTER_STORE_VALUE_CONFLICT",
          "The selected native-pointer store value does not have the exact pointee carrier.",
          expression,
          ["target.capability=rust.native-pointer.exact-store"],
        );
        return {};
      }
      resultCarrier = rustUnitTargetType();
      fact = {
        kind: "native-pointer",
        operationId: "tsonic.rust.native-pointer.store",
        operation: source.operation,
        pointerExpression: source.pointerExpression,
        pointerCarrier,
        pointeeCarrier: pointerCarrier.pointee,
        valueExpression: source.valueExpression,
        valueCarrier,
        resultCarrier,
      };
      break;
    }
    case "offset": {
      const nativeIntCarrier = rustSourcePrimitiveTargetType("native-int");
      const offsetCarrier = resolveExactNativePointerOperandCarrier(
        walk,
        source.offsetExpression,
        sourceFile,
        nativeIntCarrier,
      );
      if (!rustTargetTypeRefEquals(offsetCarrier, nativeIntCarrier)) {
        appendRustDiagnostic(
          walk,
          "RUST_NATIVE_POINTER_OFFSET_TYPE_CONFLICT",
          "The selected native-pointer element offset is not exactly native-int in Rust.",
          expression,
          ["target.capability=rust.native-pointer.exact-offset"],
        );
        return {};
      }
      resultCarrier = pointerCarrier;
      fact = {
        kind: "native-pointer",
        operationId: "tsonic.rust.native-pointer.offset",
        operation: source.operation,
        pointerExpression: source.pointerExpression,
        pointerCarrier,
        pointeeCarrier: pointerCarrier.pointee,
        offsetExpression: source.offsetExpression,
        offsetCarrier,
        resultCarrier,
      };
      break;
    }
  }
  setRustOperationFact(walk, expression, fact);
  return { carrier: setCarrierFact(walk, expression, resultCarrier) };
}

function resolveExactNativePointerOperandCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  contextualCarrier: TargetTypeRef,
): TargetTypeRef | undefined {
  return resolveExpressionCarrier(walk, expression, sourceFile, undefined) ??
    resolveExpressionCarrier(walk, expression, sourceFile, contextualCarrier);
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

function applySelectedRuntimeCallableCall(
  walk: RustFactWalk,
  expression: Node,
  callee: Node,
  callArguments: readonly (Node | undefined)[],
  sourceFile: SourceFile,
  selectedSignature: RustSelectedTargetSignature,
): TargetTypeRef | undefined {
  const carrier = selectedSignature.sourceCallableCarrier;
  const callable = carrier?.kind === "function-pointer"
    ? { parameters: carrier.args, result: carrier.result }
    : rustCallableProtocol(carrier);
  const bindings = selectedSignature.sourceArgumentBindings;
  const memberParameters = selectedSignature.member.parameters;
  const sourceParameterIndexes = selectedSignature.sourceCallableParameterIndexes;
  const selectedParameters = selectedSignature.sourceSelectedSignatureParameters;
  if (
    carrier === undefined ||
    callable === undefined ||
    bindings === undefined ||
    sourceParameterIndexes === undefined ||
    selectedParameters === undefined ||
    !isDenseDataArray(callArguments) ||
    callArguments.some((argument) => argument === undefined) ||
    (selectedSignature.sourceSelectedMethodTypeArguments?.length ?? 0) !== 0 ||
    (selectedSignature.targetTypeArguments?.length ?? 0) !== 0 ||
    callable.parameters.length !== memberParameters.length ||
    sourceParameterIndexes.length !== memberParameters.length ||
    sourceParameterIndexes.some((index) => !Number.isSafeInteger(index) || index < 0 ||
      !selectedParameters.some((parameter) => parameter.parameterIndex === index)) ||
    !rustTargetTypeRefEquals(callable.result, selectedSignature.member.returnType)
  ) {
    appendRustDiagnostic(
      walk,
      "RUST_RUNTIME_CALLABLE_CONTRACT_CONFLICT",
      "The exact runtime-callable selection does not have one closed argument and result contract.",
      expression,
      ["target.capability=rust.source-call.runtime-callable"],
    );
    return undefined;
  }
  const consumedBindings = new Set<object>();
  const parameters = memberParameters.map((parameter, index) => {
    const parameterCarrier = callable.parameters[index];
    if (parameterCarrier === undefined ||
      !rustTargetTypeRefEquals(parameterCarrier, parameter.type)) {
      return undefined;
    }
    const form = parameter.paramsArray === true
      ? "rest" as const
      : parameter.optional === true ? "optional" as const : "required" as const;
    const valueCarrier = form === "optional"
      ? rustOptionElementCarrier(parameterCarrier) ?? parameterCarrier
      : parameterCarrier;
    const selectedBindings = bindings.filter((binding) =>
      form === "rest"
        ? binding.sourceParameterIndex === sourceParameterIndexes[index]
        : binding.effectiveArgumentIndex === index);
    if ((form === "required" && selectedBindings.length !== 1) ||
      (form === "optional" && selectedBindings.length > 1)) {
      return undefined;
    }
    const inputs = selectedBindings.map((binding) => {
      consumedBindings.add(binding);
      const inputCarrier = form === "rest" &&
          binding.sourceParameterForm === "rest-element"
        ? valueCarrier.kind === "array" ? valueCarrier.element : undefined
        : form === "optional" ? parameterCarrier : valueCarrier;
      return inputCarrier === undefined
        ? undefined
        : {
            sourceArgumentIndex: binding.sourceArgumentIndex,
            sourceForm: binding.sourceForm,
            sourceParameterForm: binding.sourceParameterForm,
            carrier: inputCarrier,
            ...(binding.spreadElementIndex === undefined
              ? {}
              : { spreadElementIndex: binding.spreadElementIndex }),
          };
    });
    return inputs.some((input) => input === undefined)
      ? undefined
      : {
          form,
          valueCarrier,
          parameterCarrier,
          mode: "value" as const,
          inputs: inputs as readonly NonNullable<typeof inputs[number]>[],
        };
  });
  if (parameters.some((parameter) => parameter === undefined) ||
    consumedBindings.size !== bindings.length) {
    appendRustDiagnostic(
      walk,
      "RUST_RUNTIME_CALLABLE_ARGUMENT_BINDING_CONFLICT",
      "The exact runtime-callable parameters do not form a total mapping over the checker-selected effective arguments.",
      expression,
      ["target.capability=rust.source-call.runtime-callable-bindings"],
    );
    return undefined;
  }
  const finalizedParameters = parameters as readonly NonNullable<
    typeof parameters[number]
  >[];
  if (!applySelectedSourceCallArguments(
    walk,
    callArguments as readonly Node[],
    sourceFile,
    finalizedParameters,
    bindings,
  )) {
    return undefined;
  }
  const optionalCall = walk.context.facts.get(expression, rustOptionalChainFactKey) ??
    walk.context.facts.resolve(expression, rustOptionalChainFactKey);
  if (optionalCall !== undefined &&
    (!rustTargetTypeRefEquals(optionalCall.innerResultCarrier, callable.result) ||
      optionalCall.operationKind !== "method")) {
    appendRustDiagnostic(
      walk,
      "RUST_OPTIONAL_CALL_RESULT_CONFLICT",
      "The finalized optional call conflicts with the exact selected runtime-callable result carrier.",
      expression,
      ["target.capability=rust.optional-call.exact-result"],
    );
    return undefined;
  }
  const finalResultCarrier = optionalCall?.resultCarrier ?? callable.result;
  const structuralMethod = selectedSignature.sourceStructuralMethod;
  if (structuralMethod !== undefined && (
    selectedSignature.sourceSelectedReceiverCarrier === undefined ||
    !rustTargetTypeRefEquals(
      structuralMethod.receiverCarrier,
      selectedSignature.sourceSelectedReceiverCarrier,
    ) || structuralMethod.storageIndex < 0 ||
    !Number.isSafeInteger(structuralMethod.storageIndex)
  )) {
    appendRustDiagnostic(
      walk,
      "RUST_STRUCTURAL_METHOD_SELECTION_CONFLICT",
      "The exact structural-method selection has an invalid receiver or storage identity.",
      expression,
      ["target.capability=rust.source-call.structural-method"],
    );
    return undefined;
  }
  const target: Extract<
    RustTargetOperationFact,
    { readonly kind: "source-call" }
  >["target"] = structuralMethod === undefined
    ? { form: "callable", carrier }
    : {
        form: "structural-method",
        receiverCarrier: structuralMethod.receiverCarrier,
        storageIndex: structuralMethod.storageIndex,
        callableCarrier: carrier,
      };
  recordTargetOperation(
    walk,
    expression,
    selectedSignature.member.id,
    "method",
    target.form,
    finalResultCarrier,
  );
  setRustOperationFact(walk, expression, {
    kind: "source-call",
    operationId: selectedSignature.member.id,
    target,
    parameters: finalizedParameters,
    resultCarrier: callable.result,
  });
  if (target.form === "callable") {
    resolveExpressionCarrier(walk, callee, sourceFile, carrier);
  }
  return setCarrierFact(walk, expression, finalResultCarrier);
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
  let parameters: import("../rust-facts/keys.js").RustSourceCallParameterPlan[] = [];
  for (const [index, targetParameter] of selectedMember.parameters.entries()) {
    const selectedParameter = selectedParameters[index];
    const parameterDeclaration = declarationParameters[index] ?? asSourceNode(
      selectedParameter?.parameterDeclaration,
      ast,
    );
    const parameterAbi = parameterDeclaration === undefined
      ? undefined
      : resolveParameterAbi(walk, parameterDeclaration);
    const parameterInputs = bindings.filter((binding) =>
      binding.sourceParameterIndex === index);
    if (parameterAbi === undefined ||
      (selectedParameter !== undefined && selectedParameter.parameterIndex !== index) ||
      (selectedParameter === undefined &&
        (parameterInputs.length !== 0 || parameterAbi.form === "required"))) {
      appendRustDiagnostic(
        walk,
        "RUST_SOURCE_CALL_PARAMETER_MISSING",
        `Project-source call selects unavailable parameter ${index}.`,
        expression,
        ["target.capability=rust.source-call.argument-bindings"],
      );
      return undefined;
    }
    if (selectedParameter !== undefined &&
      (parameterAbi.form === "rest") !== selectedParameter.rest) {
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
  const calleeImplementation = calleeReferenceDeclaration === undefined
    ? undefined
    : walk.context.source.navigation.callableImplementation(
        calleeReferenceDeclaration,
      );
  const calleeModuleBinding = calleeReferenceDeclaration === undefined
    ? undefined
    : walk.context.facts.get(calleeReferenceDeclaration, rustModuleBindingFactKey) ??
      walk.context.facts.resolve(calleeReferenceDeclaration, rustModuleBindingFactKey);
  const directModuleFunction = calleeModuleBinding?.storage === "native-function" &&
    calleeModuleBinding.callableDeclaration === selectedDeclaration;
  const directCallableDeclaration = calleeReferenceDeclaration === selectedDeclaration ||
    (calleeImplementation?.kind === "resolved" &&
      calleeImplementation.implementation.declaration === selectedDeclaration);
  const callableCalleeCarrier = expressionKind === KindNewExpression
    ? undefined
    : resolveExpressionCarrier(walk, callee, sourceFile, undefined);
  const optionalCall = walk.context.facts.get(expression, rustOptionalChainFactKey) ??
    walk.context.facts.resolve(expression, rustOptionalChainFactKey);
  const selectedCallableCarrier = optionalCall?.selectedGuardCarrier ?? callableCalleeCarrier;
  const indirectCallable = selectedCallableCarrier !== undefined &&
    (selectedCallableCarrier.kind === "function-pointer" ||
      rustCallableProtocol(selectedCallableCarrier) !== undefined) &&
    (!directCallableDeclaration ||
      ast.kindName(callee) === "KindArrowFunction" || ast.kindName(callee) === KindFunctionExpression);
  if (directModuleFunction) {
    const name = calleeModuleBinding.name;
    const fileName = ast.getFileName(ast.getSourceFile(calleeReferenceDeclaration!));
    if (name === undefined || fileName.length === 0) {
      return undefined;
    }
    target = {
      form: "function",
      fileName,
      name,
      selectedTargetName: selectedMember.targetName,
    };
  } else if (indirectCallable) {
    target = { form: "callable", carrier: selectedCallableCarrier };
  } else if (selectedMember.kind === "constructor") {
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
      resolveExpressionCarrier(
        walk,
        receiver,
        sourceFile,
        undefined,
      );
      const rawReceiverCarrier = walk.context.facts.getRuntimeCarrierFact(receiver)?.carrier;
      const selectedReceiverCarrier = selectedSignature.sourceSelectedReceiverCarrier;
      if (rawReceiverCarrier === undefined || selectedReceiverCarrier === undefined) {
        appendRustDiagnostic(
          walk,
          "RUST_SOURCE_CALL_RECEIVER_CARRIER_MISSING",
          "Selected project-source method call has no exact raw and checker-selected receiver carriers.",
          receiver,
          ["target.capability=rust.source-call.receiver-carrier"],
        );
        return undefined;
      }
      const receiverProjection = selectRustFlowReadProjection(
        rawReceiverCarrier,
        selectedReceiverCarrier,
        walk.context.projectTypes,
      );
      if (receiverProjection.kind === "incompatible") {
        appendRustDiagnostic(
          walk,
          "RUST_SOURCE_CALL_RECEIVER_PROJECTION_UNSUPPORTED",
          "The project-source method receiver cannot project from its exact runtime carrier to its checker-selected carrier.",
          receiver,
          ["target.capability=rust.source-call.receiver-projection"],
        );
        return undefined;
      }
      if (receiverProjection.kind === "projection") {
        recordRustFlowReadProjection(
          walk.context.facts,
          receiver,
          receiverProjection.fact,
        );
      }
      const selfMode = walk.context.facts.get(selectedDeclaration, rustSelfModeFactKey) ??
        walk.context.facts.resolve(selectedDeclaration, rustSelfModeFactKey);
      if (selfMode === undefined) {
        return undefined;
      }
      const mutatesSelf = selfMode.mode === "mut-ref";
      const owner = walk.context.projectTypes.definitionContainingDeclaration(selectedDeclaration);
      const ownerRelationship = owner === undefined
        ? undefined
        : walk.context.projectTypes.relationship(selectedReceiverCarrier, owner);
      const ownerCarrier = ownerRelationship?.kind === "related"
        ? ownerRelationship.targetType
        : undefined;
      const polymorphic = owner !== undefined && walk.context.projectTypes.isPolymorphic(owner);
      if (polymorphic && ownerCarrier === undefined) {
        return undefined;
      }
      if (polymorphic && ast.typeParameters(selectedDeclaration).length > 0) {
        const registration = walk.context.sourceCallableSpecializations.recordProjectMethodCall({
          subject: expression,
          ...(walk.currentCallableDeclaration === undefined
            ? {}
            : { caller: walk.currentCallableDeclaration }),
          declaration: selectedDeclaration,
          targetTypeArguments,
          ast,
          projectTypes: walk.context.projectTypes,
        });
        if (registration.kind === "rejected") {
          appendRustDiagnostic(
            walk,
            "RUST_PROJECT_METHOD_SPECIALIZATION_UNAVAILABLE",
            registration.reason,
            expression,
            ["target.capability=rust.project-dispatch.finite-generic-specialization"],
          );
          return undefined;
        }
      }
      const receiverKind = ast.kindName(receiver);
      target = {
        form: "method",
        name: methodName,
        mutatesSelf,
        ...(!polymorphic
          ? {}
          : {
              dispatch: {
                selected: receiverKind === "KindSuperKeyword" ? "exact" : "virtual",
                ownerCarrier: ownerCarrier!,
              },
            }),
      };
    }
  } else if (declarationKind === KindFunctionDeclaration) {
    const name = walk.context.names.functionNameForDeclaration(selectedDeclaration);
    const fileName = ast.getFileName(ast.getSourceFile(selectedDeclaration));
    if (name === undefined || fileName.length === 0) {
      return undefined;
    }
    target = {
      form: "function",
      fileName,
      name,
      selectedTargetName: selectedMember.targetName,
    };
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
  if (declarationKind === KindFunctionDeclaration ||
    declarationKind === "KindMethodDeclaration") {
    const registration = walk.context.sourceCallableSpecializations.recordSourceCall({
      subject: expression,
      ...(walk.currentCallableDeclaration === undefined
        ? {}
        : { caller: walk.currentCallableDeclaration }),
      callee: selectedDeclaration,
      targetTypeArguments,
      ast,
    });
    if (registration.kind === "rejected") {
      appendRustDiagnostic(
        walk,
        "RUST_SOURCE_CALLABLE_SPECIALIZATION_EVIDENCE_CONFLICT",
        registration.reason,
        expression,
        ["target.capability=rust.source-callable.exact-call-graph"],
      );
      return undefined;
    }
  }
  if (target.form === "callable") {
    const callable = rustCallableProtocol(target.carrier);
    if (callable !== undefined) {
      if (callable.parameters.length !== parameters.length) {
        appendRustDiagnostic(
          walk,
          "RUST_SOURCE_CALL_CALLABLE_ARITY_CONFLICT",
          "The exact runtime-callable carrier conflicts with the selected source parameter count.",
          expression,
          ["target.capability=rust.source-call.callable-abi"],
        );
        return undefined;
      }
      const callableParameters = parameters.map((parameter, index) => {
        const carrier = callable.parameters[index];
        const contractCarrier = parameter.mode === "value"
          ? parameter.parameterCarrier
          : parameter.valueCarrier;
        return carrier !== undefined && rustTargetTypeRefEquals(carrier, contractCarrier)
          ? { ...parameter, parameterCarrier: carrier, mode: "value" as const }
          : undefined;
      });
      if (callableParameters.some((parameter) => parameter === undefined)) {
        appendRustDiagnostic(
          walk,
          "RUST_SOURCE_CALL_CALLABLE_PARAMETER_CONFLICT",
          "The exact runtime-callable carrier conflicts with the selected source parameter ABI.",
          expression,
          ["target.capability=rust.source-call.callable-abi"],
        );
        return undefined;
      }
      parameters = callableParameters as import("../rust-facts/keys.js").RustSourceCallParameterPlan[];
    }
  }
  if (!applySelectedSourceCallArguments(
    walk,
    callArguments as readonly Node[],
    sourceFile,
    parameters,
    bindings,
  )) {
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

function applySelectedSourceCallArguments(
  walk: RustFactWalk,
  callArguments: readonly Node[],
  sourceFile: SourceFile,
  parameters: readonly import("../rust-facts/keys.js").RustSourceCallParameterPlan[],
  bindings: readonly NonNullable<RustSelectedTargetSignature["sourceArgumentBindings"]>[number][],
): boolean {
  const { ast } = walk.context;
  for (const [index, argument] of callArguments.entries()) {
    const argumentBindings = bindings.filter((binding) =>
      binding.sourceArgumentIndex === index);
    if (argumentBindings.length === 0) {
      appendRustDiagnostic(
        walk,
        "RUST_SOURCE_CALL_BINDING_MISSING",
        `Selected source argument ${index} has no exact parameter binding.`,
        argument,
        ["target.capability=rust.source-call.argument-bindings"],
      );
      return false;
    }
    const bindingCarriers = parameters.flatMap((parameter) =>
      parameter.inputs
        .filter((input) => input.sourceArgumentIndex === index)
        .map((input) => input.carrier));
    const expected = ast.kindName(argument) === KindSpreadElement
      ? undefined
      : bindingCarriers.length > 0 && bindingCarriers.every((carrier) =>
          rustTargetTypeRefEquals(carrier, bindingCarriers[0]))
        ? bindingCarriers[0]
        : undefined;
    resolveExpressionCarrier(walk, argument, sourceFile, expected);
    const modes = parameters
      .filter((parameter) => parameter.inputs.some((input) =>
        input.sourceArgumentIndex === index))
      .map((parameter) => parameter.mode);
    if (modes.length === 0 || modes.some((mode) => mode !== modes[0])) {
      appendRustDiagnostic(
        walk,
        "RUST_SOURCE_CALL_ARGUMENT_MODE_CONFLICT",
        `Selected source argument ${index} spans incompatible target parameter modes.`,
        argument,
        ["target.capability=rust.source-call.argument-modes"],
      );
      return false;
    }
    const mode = modes[0]!;
    const passingMode = rustArgumentPassingMode(mode);
    walk.context.facts.set(argument, rustArgumentPassingKey, {
      mode: passingMode,
      ...(mode === "value" ? {} : { storageExpression: argument }),
    }, [{
      message: `rust selected source argument ${index} passes as ${passingMode}`,
    }]);
    validateFlowMarkerAgainstMode(walk, argument, mode);
    if (mode === "mut-ref") {
      recordBindingWrite(walk, argument, "referent");
    }
  }
  return true;
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
      resolveExpressionCarrier(
        walk,
        right,
        sourceFile,
        rustSelectedAssignmentValueCarrier(fact),
      );
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
      if (providerOperationSourceReceiverMode(fact) === "mut-ref") {
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
        if (providerOperationSourceReceiverMode(fact) === "mut-ref") {
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

function providerOperationSourceReceiverMode(
  fact: RustTargetOperationFact | undefined,
): "value" | "ref" | "mut-ref" | undefined {
  if (fact?.kind !== "provider-operation") {
    return undefined;
  }
  const directInputs = [
    ...(fact.abi.targetReceiver.kind === "input" ? [fact.abi.targetReceiver.input] : []),
    ...fact.abi.targetArguments.flatMap((input) => {
      if ("mode" in input && "source" in input && input.source.kind === "receiver") {
        return [input];
      }
      return [];
    }),
  ];
  const receiverModes = directInputs
    .filter((input) => input.source.kind === "receiver")
    .map((input) => input.mode);
  return receiverModes.length === 1 ? receiverModes[0] : undefined;
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
  if (expectedElement === undefined && presentElements.length > 0 &&
    presentElements.every((element) => ast.kindName(element) === KindNumericLiteral)) {
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
        const declaration = recordProjectSourceBinding(walk, initializer)?.sourceDeclaration;
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
        if ((ast.kindName(member) === "KindMethodDeclaration" ||
            ast.kindName(member) === "KindGetAccessor" ||
            ast.kindName(member) === "KindSetAccessor") &&
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
    if (memberKind === KindClassStaticBlockDeclaration) {
      continue;
    }
    if (memberKind === "KindPropertyDeclaration") {
      const fieldCarrier = resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, member));
      if (fieldCarrier !== undefined) {
        setCarrierFact(walk, member, fieldCarrier);
      }
      continue;
    }
    if (memberKind === "KindConstructor" || memberKind === "KindMethodDeclaration" ||
      memberKind === "KindGetAccessor" || memberKind === "KindSetAccessor") {
      if (memberKind !== "KindConstructor") {
        recordCallableSuspensionFacts(walk, member);
        recordCallableReturnFact(walk, member);
        if (memberKind === "KindSetAccessor" &&
          walk.context.facts.get(member, rustSourceCallableReturnFactKey) === undefined) {
          walk.context.facts.set(member, rustSourceCallableReturnFactKey, {
            returnCarrier: rustUnitTargetType(),
          }, [{ message: "rust setter unit return carrier" }]);
        }
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
        edge.kind === "extends" && edge.target.kind === "class")?.targetType ??
      walk.context.projectTypes.externalBaseForDefinition(definition)?.targetType;
  const members = requireDenseSourceNodes(walk, ast.members(declaration), "Class declaration contains an undefined or non-data member slot.");
  if (members === undefined) {
    walk.currentThisCarrier = previousThis;
    walk.currentSuperCarrier = previousSuper;
    return;
  }
  for (const member of members) {
    const memberKind = ast.kindName(member);
    if (memberKind === KindClassStaticBlockDeclaration) {
      const previousStaticThis: TargetTypeRef | undefined = walk.currentThisCarrier;
      const previousStaticSuper: TargetTypeRef | undefined = walk.currentSuperCarrier;
      walk.currentThisCarrier = undefined;
      walk.currentSuperCarrier = undefined;
      const body = ClassStaticBlock_Body(ast, member);
      const statements = body === undefined
        ? undefined
        : requireDenseSourceNodes(
            walk,
            ast.statements(body),
            "Class static block contains an undefined or non-data statement slot.",
          );
      if (body === undefined) {
        appendMalformedSourceAst(
          walk,
          "Class static block has no exact body node.",
        );
      } else if (statements !== undefined) {
        for (const statement of statements) {
          recordStatementFacts(walk, statement, sourceFile, undefined);
        }
      }
      walk.currentThisCarrier = previousStaticThis;
      walk.currentSuperCarrier = previousStaticSuper;
      continue;
    }
    if (memberKind === "KindPropertyDeclaration") {
      const initializer = Node_Initializer(ast, member);
      const fieldCarrier = walk.context.facts.get(member, rustRuntimeCarrierKey)?.carrier ??
        resolveTypeNodeCarrier(walk, Node_Type(ast, member));
      if (initializer !== undefined && fieldCarrier !== undefined) {
        resolveExpressionCarrier(walk, initializer, sourceFile, fieldCarrier);
      }
      continue;
    }
    if (memberKind === "KindConstructor" || memberKind === "KindMethodDeclaration" ||
      memberKind === "KindGetAccessor" || memberKind === "KindSetAccessor") {
      const asyncFact = walk.context.facts.get(member, rustAsyncFunctionFactKey);
      const generatorFact = walk.context.facts.get(member, rustGeneratorFactKey);
      const returnCarrier = memberKind !== "KindConstructor"
        ? generatorFact?.returnType ?? asyncFact?.outputCarrier ??
          walk.context.facts.get(member, rustSourceCallableReturnFactKey)?.returnCarrier
        : undefined;
      const previousMethod = walk.currentMethodDeclaration;
      const previousCallable = walk.currentCallableDeclaration;
      const previousGenerator = walk.currentGeneratorDeclaration;
      walk.currentMethodDeclaration = memberKind === "KindConstructor" ? undefined : member;
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
    } else if (memberKind === "KindIndexSignature") {
      const parameters = requireDenseSourceNodes(
        walk,
        ast.parameters(member),
        "Interface index signature contains an undefined key parameter slot.",
      );
      const keyParameter = parameters?.length === 1 ? parameters[0] : undefined;
      const keyCarrier = keyParameter === undefined
        ? undefined
        : resolveTypeNodeCarrier(walk, Node_Type(ast, keyParameter));
      const valueCarrier = resolveTypeNodeCarrier(walk, Node_Type(ast, member));
      if (keyParameter === undefined || keyCarrier === undefined || valueCarrier === undefined) {
        appendRustDiagnostic(
          walk,
          "RUST_INTERFACE_INDEX_SIGNATURE_NOT_CLOSED",
          "Interface index signatures require one exact key carrier and one exact value carrier.",
          member,
          ["target.capability=rust.project-index-signature"],
        );
        continue;
      }
      setCarrierFact(walk, keyParameter, keyCarrier);
      setCarrierFact(walk, member, valueCarrier);
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
  const properties = requireDenseSourceNodes(walk, ast.properties(expression), "Object literal contains an undefined or non-data property slot.");
  if (properties === undefined) {
    return undefined;
  }
  const accessorSelection = selectSourceObjectLiteralAccessors(
    ast,
    walk.context.semanticsFor(expression),
    expression,
  );
  if (accessorSelection.kind === "rejected") {
    appendRustDiagnostic(
      walk,
      "RUST_OBJECT_LITERAL_ACCESSOR_EVIDENCE_MISSING",
      accessorSelection.reason,
      accessorSelection.element,
      ["target.capability=rust.object-literal.accessor.selected-evidence"],
    );
    return undefined;
  }
  const accessorsByElement = new Map<Node,
    Extract<typeof accessorSelection, { readonly kind: "resolved" }>[
      "members"
    ][number]
  >();
  if (accessorSelection.kind === "resolved") {
    for (const accessor of accessorSelection.members) {
      if (accessor.getter === undefined) {
        appendRustDiagnostic(
          walk,
          "RUST_OBJECT_LITERAL_SETTER_ONLY_UNSUPPORTED",
          `Object-literal setter '${accessor.sourceName}' has no getter and therefore no exact Rust read carrier.`,
          accessor.setter?.element,
          ["target.capability=rust.object-literal.accessor.closed-read-write"],
        );
        return undefined;
      }
      accessorsByElement.set(accessor.getter.element, accessor);
      if (accessor.setter !== undefined) {
        accessorsByElement.set(accessor.setter.element, accessor);
      }
    }
  }
  const selectedExpected = expected ?? resolveRustTargetTypeRef(
    walk.context.semanticsFor(expression).getTypeAtLocation(expression),
    rustResolutionContext(walk, expression),
    walk.operationOptions,
  );
  if (selectedExpected === undefined) {
    return undefined;
  }
  const indexedDefinition = walk.context.projectTypes.definitionForCarrier(selectedExpected);
  const indexedLayout = indexedDefinition?.kind === "interface"
    ? rustProjectObjectLayout(indexedDefinition.declaration, ast)
    : undefined;
  if (indexedLayout !== undefined && indexedLayout.indexSignatures.length !== 0) {
    return resolveProjectIndexRecordLiteral(
      walk,
      expression,
      sourceFile,
      selectedExpected,
      properties,
      indexedDefinition!,
      indexedLayout,
    );
  }
  const explicitPropertiesByName = new Map<string, Node>();
  if (accessorSelection.kind === "resolved") {
    for (const accessor of accessorSelection.members) {
      if (explicitPropertiesByName.has(accessor.sourceName)) {
        return undefined;
      }
      explicitPropertiesByName.set(accessor.sourceName, accessor.getter!.element);
    }
  }
  let containsSpread = false;
  for (const property of properties) {
    const kind = ast.kindName(property);
    if (kind === KindSpreadAssignment) {
      containsSpread = true;
      continue;
    }
    if (kind === "KindMethodDeclaration") {
      continue;
    }
    if (kind === "KindGetAccessor" || kind === "KindSetAccessor") {
      if (!accessorsByElement.has(property)) {
        return undefined;
      }
      continue;
    }
    if (kind !== "KindPropertyAssignment" && kind !== "KindShorthandPropertyAssignment") {
      return undefined;
    }
    const nameNode = ast.name(property);
    const fieldName = nameNode === undefined ? "" : ast.text(nameNode);
    if (fieldName.length === 0 || explicitPropertiesByName.has(fieldName)) {
      return undefined;
    }
    explicitPropertiesByName.set(fieldName, property);
  }
  const sourceValue = rustSourceTypeCarrierValue(selectedExpected);
  const unionValue = rustSourceUnionCarrierValue(selectedExpected);
  const structuralExpected = rustStructuralObjectCarrierValue(selectedExpected);
  let resultCarrier: TargetTypeRef;
  let storage: "project-object" | "object-handle";
  let selectedProjectDefinition: import("./project-type-policy.js").RustProjectTypeDefinition | undefined;
  let selectedFields: readonly {
    readonly implementationDeclaration?: Node;
    readonly contractDeclarations: readonly Node[];
    readonly sourceName: string;
    readonly storageIndex: number;
    readonly carrier: TargetTypeRef;
    readonly presence: "required" | "optional";
    readonly readonly: boolean;
    readonly accessor?: {
      readonly getter: true;
      readonly setter: boolean;
    };
    readonly method?: true;
  }[];
  let selectedMethodDeclarations: readonly Node[] = [];
  if (sourceValue?.shape === "object") {
    const definition = walk.context.projectTypes.definitionForCarrier(selectedExpected);
    const contracts = definition === undefined
      ? undefined
      : rustProjectInterfaceContracts(
          walk.context.projectTypes,
          definition,
          selectedExpected,
        );
    if (definition?.kind !== "interface" || contracts === undefined) {
      return undefined;
    }
    const contractFields = contracts.flatMap((contract) => {
      const layout = rustProjectObjectLayout(contract.definition.declaration, ast);
      if (layout?.kind !== "interface") {
        return [undefined];
      }
      return layout.fields.map((field) => {
        const implementation = walk.context.projectTypes.memberImplementation(
          definition,
          field.declaration,
        );
        const declared = walk.context.facts.get(field.declaration, rustRuntimeCarrierKey)?.carrier ??
          resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, field.declaration));
        const carrier = declared === undefined
          ? undefined
          : walk.context.projectTypes.instantiateMemberCarrier(
              field.declaration,
              selectedExpected,
              declared,
            );
        return carrier === undefined || implementation.kind !== "resolved"
          ? undefined
          : {
              contractDeclaration: field.declaration,
              implementationDeclaration: implementation.implementation.declaration,
              sourceName: field.sourceName,
              carrier,
              presence: "required" as const,
              readonly: ast.hasModifierKind(field.declaration, "readonly"),
            };
      });
    });
    if (contractFields.some((field) => field === undefined)) {
      return undefined;
    }
    const projectFields: {
      readonly implementationDeclaration: Node;
      readonly contractDeclarations: Node[];
      readonly sourceName: string;
      readonly storageIndex: number;
      readonly carrier: TargetTypeRef;
      readonly presence: "required";
      readonly readonly: boolean;
    }[] = [];
    for (const field of contractFields as readonly {
      readonly contractDeclaration: Node;
      readonly implementationDeclaration: Node;
      readonly sourceName: string;
      readonly carrier: TargetTypeRef;
      readonly presence: "required";
      readonly readonly: boolean;
    }[]) {
      const existing = projectFields.find((candidate) =>
        candidate.implementationDeclaration === field.implementationDeclaration);
      if (existing !== undefined) {
        if (!rustTargetTypeRefEquals(existing.carrier, field.carrier)) {
          return undefined;
        }
        existing.contractDeclarations.push(field.contractDeclaration);
        continue;
      }
      projectFields.push({
        implementationDeclaration: field.implementationDeclaration,
        contractDeclarations: [field.contractDeclaration],
        sourceName: field.sourceName,
        storageIndex: projectFields.length,
        carrier: field.carrier,
        presence: "required",
        readonly: field.readonly,
      });
    }
    resultCarrier = selectedExpected;
    storage = "project-object";
    selectedProjectDefinition = definition;
    selectedMethodDeclarations = contracts.flatMap((contract) =>
      ast.members(contract.definition.declaration).filter((member): member is Node =>
        member !== undefined && ast.kindName(member) === "KindMethodSignature"));
    selectedFields = projectFields as readonly {
      readonly implementationDeclaration: Node;
      readonly contractDeclarations: readonly Node[];
      readonly sourceName: string;
      readonly storageIndex: number;
      readonly carrier: TargetTypeRef;
      readonly presence: "required";
      readonly readonly: boolean;
      readonly accessor?: {
        readonly getter: true;
        readonly setter: boolean;
      };
    }[];
  } else {
    let structuralCarrier = structuralExpected === undefined ? undefined : selectedExpected;
    let structuralValue = structuralExpected;
    if (unionValue !== undefined) {
      const sourceUnion = walk.sourceTypes.sourceUnionForCarrier(selectedExpected);
      const selectedVariant = sourceUnion === undefined
        ? undefined
        : containsSpread
          ? selectRustRecordLiteralUnionVariantByCheckedType(
              walk,
              expression,
              sourceUnion,
            )
          : selectRustRecordLiteralUnionVariant(
              walk,
              expression,
              sourceUnion,
              explicitPropertiesByName,
            );
      if (selectedVariant === undefined) {
        return undefined;
      }
      structuralCarrier = selectedVariant.carrier;
      structuralValue = rustStructuralObjectCarrierValue(structuralCarrier);
    }
    if (structuralCarrier === undefined || structuralValue === undefined) {
      return undefined;
    }
    resultCarrier = structuralCarrier;
    storage = "object-handle";
    const structuralShape = walk.sourceTypes.structuralObjectForCarrier(structuralCarrier);
    if (structuralShape === undefined ||
      structuralShape.fields.length !== structuralValue.fields.length) {
      return undefined;
    }
    const selectedAccessorMembers = accessorSelection.kind === "resolved"
      ? accessorSelection.members
      : [];
    const structuralFields = structuralValue.fields.map((field, storageIndex) => {
      const sourceField = structuralShape.fields[storageIndex];
      const matchingAccessors = selectedAccessorMembers.filter((accessor) =>
        accessor.sourceName === field.sourceName
      );
      const accessor = matchingAccessors[0];
      if (sourceField === undefined || sourceField.sourceName !== field.sourceName ||
        sourceField.storageIndex !== storageIndex ||
        !rustTargetTypeRefEquals(sourceField.resultCarrier, field.type) ||
        sourceField.presence !== field.presence || sourceField.readonly !== field.readonly ||
        sourceField.accessor?.setter !== field.accessor?.setter ||
        sourceField.method !== field.method || matchingAccessors.length > 1 ||
        (accessor !== undefined && (
          field.method === true || accessor.getter === undefined ||
          accessor.sourceSelectedDeclarations.length === 0 ||
          accessor.sourceSelectedDeclarations.some((declaration) =>
            !sourceField.declarations.includes(declaration)) ||
          !field.readonly && accessor.setter === undefined
        ))) {
        return undefined;
      }
      return {
        contractDeclarations: sourceField.declarations,
        sourceName: field.sourceName,
        storageIndex,
        carrier: field.type,
        presence: field.presence,
        readonly: field.readonly,
        ...(field.accessor === undefined ? {} : { accessor: field.accessor }),
        ...(field.method === true ? { method: true as const } : {}),
      };
    });
    if (structuralFields.some((field) => field === undefined)) {
      return undefined;
    }
    selectedFields = structuralFields as typeof selectedFields;
  }
  const selectedFieldByName = new Map(selectedFields.map((field) => [field.sourceName, field]));
  if (selectedFieldByName.size !== selectedFields.length) {
    return undefined;
  }
  const contributions: Extract<
    RustTargetOperationFact,
    { readonly kind: "record-literal" }
  >["contributions"][number][] = [];
  const assignedStorageIndexes = new Set<number>();
  const assignedAccessorRoles = new Map<number, Set<"get" | "set">>();
  const assignedMethodDeclarations = new Set<Node>();
  for (const property of properties) {
    const kind = ast.kindName(property);
    if (kind === KindSpreadAssignment) {
      const spreadExpression = SpreadAssignment_Expression(ast, property);
      const sourceCarrier = spreadExpression === undefined
        ? undefined
        : resolveExpressionCarrier(walk, spreadExpression, sourceFile, undefined);
      const sourceShape = sourceCarrier === undefined
        ? undefined
        : resolveRustRecordShape(walk, sourceCarrier, false);
      if (spreadExpression === undefined || sourceCarrier === undefined ||
        sourceShape === undefined) {
        return undefined;
      }
      const spreadFields: {
        readonly sourceName: string;
        readonly sourceStorageIndex: number;
        readonly targetStorageIndex: number;
        readonly carrier: TargetTypeRef;
        readonly accessor?: {
          readonly getter: true;
          readonly setter: boolean;
        };
        readonly method?: true;
      }[] = [];
      for (const sourceField of sourceShape.fields) {
        const targetField = selectedFieldByName.get(sourceField.sourceName);
        if (targetField === undefined) {
          continue;
        }
        if (!rustTargetTypeRefEquals(sourceField.carrier, targetField.carrier) ||
          sourceField.method !== targetField.method ||
          sourceField.method === true && (
            sourceShape.storage !== "object-handle" ||
            !rustTargetTypeRefEquals(sourceCarrier, resultCarrier)
          )) {
          return undefined;
        }
        spreadFields.push({
          sourceName: sourceField.sourceName,
          sourceStorageIndex: sourceField.storageIndex,
          targetStorageIndex: targetField.storageIndex,
          carrier: targetField.carrier,
          ...(sourceField.accessor === undefined
            ? {}
            : { accessor: sourceField.accessor }),
          ...(sourceField.method === true ? { method: true as const } : {}),
        });
        assignedStorageIndexes.add(targetField.storageIndex);
      }
      const sourceDefinition = walk.context.projectTypes.definitionForCarrier(sourceCarrier);
      const spreadMethods: {
        readonly contractDeclaration: Node;
        readonly sourceDeclaration: Node;
        readonly callableCarrier: TargetTypeRef;
      }[] = [];
      if (storage === "project-object") {
        for (const contractDeclaration of selectedMethodDeclarations) {
          const implementation = sourceDefinition === undefined
            ? undefined
            : walk.context.projectTypes.memberImplementation(
                sourceDefinition,
                contractDeclaration,
              );
          const callableCarrier = resolveProjectMethodPropertyCarrier(
            walk,
            contractDeclaration,
            sourceCarrier,
          );
          if (implementation?.kind !== "resolved" || callableCarrier === undefined) {
            return undefined;
          }
          spreadMethods.push({
            contractDeclaration,
            sourceDeclaration: implementation.implementation.declaration,
            callableCarrier,
          });
          assignedMethodDeclarations.add(contractDeclaration);
        }
      }
      contributions.push({
        kind: "spread",
        property,
        expression: spreadExpression,
        sourceStorage: sourceShape.storage,
        sourceCarrier,
        fields: spreadFields,
        methods: spreadMethods,
      });
      continue;
    }
    const propertySemantics = walk.context.semanticsFor(property);
    const selectedElement = propertySemantics.getResolvedObjectLiteralElementInfo(property);
    if (kind === "KindGetAccessor" || kind === "KindSetAccessor") {
      const accessor = accessorsByElement.get(property);
      const role = kind === "KindGetAccessor" ? "get" as const : "set" as const;
      const matchingFields = accessor === undefined
        ? []
        : selectedFields.filter((field) =>
            field.method !== true && field.sourceName === accessor.sourceName &&
            accessor.sourceSelectedDeclarations.length > 0 &&
            accessor.sourceSelectedDeclarations.every((declaration) =>
              field.contractDeclarations.includes(declaration))
          );
      const targetField = matchingFields.length === 1 ? matchingFields[0] : undefined;
      const valueCarrier = targetField === undefined
        ? undefined
        : rustStructuralPropertyValueCarrier(targetField.carrier, targetField.presence);
      const callableCarrier = targetField === undefined || valueCarrier === undefined
        ? undefined
        : role === "get"
          ? rustCallableTargetType([resultCarrier], valueCarrier)
          : rustCallableTargetType(
              [resultCarrier, valueCarrier],
              rustUnitTargetType(),
            );
      const sourceCallableCarrier = valueCarrier === undefined
        ? undefined
        : role === "get"
          ? rustCallableTargetType([], valueCarrier)
          : rustCallableTargetType([valueCarrier], rustUnitTargetType());
      if (role === "set" && targetField?.presence === "optional") {
        appendRustDiagnostic(
          walk,
          "RUST_STRUCTURAL_OPTIONAL_ACCESSOR_WRITE_UNSUPPORTED",
          `Optional structural property '${targetField.sourceName}' has a source write contract that includes undefined, but its authored setter accepts only the declared value type.`,
          property,
          [
            "target.capability=rust.structural-property.optional-accessor-write",
            "source.write=exact-selected-property-contract",
          ],
        );
        return undefined;
      }
      if (accessor === undefined ||
        targetField === undefined || valueCarrier === undefined ||
        role === "set" && targetField.readonly || callableCarrier === undefined ||
        sourceCallableCarrier === undefined ||
        selectedElement === undefined ||
        selectedElement.sourceSelectedSymbol !== accessor.sourceSelectedSymbol ||
        !selectedElement.sourceSelectedDeclarations.every((declaration) =>
          accessor.sourceSelectedDeclarations.includes(declaration)) ||
        resolveFunctionExpressionCarrier(
          walk,
          property,
          sourceFile,
          callableCarrier,
          {
            leadingParameters: [{ kind: "this", carrier: resultCarrier }],
            preserveSourceParameterForms: true,
            sourceCarrier: sourceCallableCarrier,
          },
        ) === undefined) {
        return undefined;
      }
      const roles = assignedAccessorRoles.get(targetField.storageIndex) ?? new Set();
      if (roles.has(role)) {
        return undefined;
      }
      roles.add(role);
      assignedAccessorRoles.set(targetField.storageIndex, roles);
      contributions.push({
        kind: "accessor",
        property,
        sourceName: accessor.sourceName,
        targetStorageIndex: targetField.storageIndex,
        role,
      });
      continue;
    }
    if (kind === "KindMethodDeclaration") {
      const selectedDeclarations = selectedElement?.sourceSelectedDeclarations ?? [];
      const selectedDeclaration = selectedElement?.sourceSelectedDeclaration;
      const selectedMemberCarrier = selectedElement === undefined || selectedDeclaration === undefined
        ? undefined
        : resolveObjectLiteralMethodCarrier(
            walk,
            property,
            selectedElement.sourceSelectedType,
            selectedElement.sourceElementType,
          );
      const selectedCallableCarrier = rustOptionElementCarrier(selectedMemberCarrier) ??
        selectedMemberCarrier;
      const selectedCallable = rustCallableProtocol(selectedCallableCarrier);
      const selectedClosure = rustClosureProtocol(selectedCallableCarrier);
      const selectedParameterCarriers = selectedCallableCarrier?.kind === "function-pointer"
        ? selectedCallableCarrier.args
        : selectedCallable?.parameters ?? selectedClosure?.parameters;
      const selectedResultCarrier = selectedCallableCarrier?.kind === "function-pointer"
        ? selectedCallableCarrier.result
        : selectedCallable?.result ?? selectedClosure?.result;
      const sourceName = selectedElement?.sourceSelectedSymbol === undefined
        ? ""
        : propertySemantics.getSymbolName(selectedElement.sourceSelectedSymbol);
      if (storage === "object-handle") {
        const methodProjection = selectedDeclaration === undefined
          ? undefined
          : walk.sourceTypes.structuralFieldProjectionForDeclaration(
              selectedDeclaration,
              resultCarrier,
            );
        const targetField = selectedFields.find((field) =>
          field.method === true && field.sourceName === sourceName &&
          field.storageIndex === methodProjection?.field.storageIndex);
        const targetCallableCarrier = targetField === undefined
          ? undefined
          : rustStructuralMethodCallableCarrier(
              targetField.carrier,
              targetField.presence,
            );
        const targetCallable = rustCallableProtocol(targetCallableCarrier);
        if (selectedElement?.elementKind !== "method" ||
          selectedDeclaration === undefined || targetField === undefined ||
          selectedParameterCarriers === undefined || selectedResultCarrier === undefined ||
          targetCallable === undefined ||
          targetCallable.parameters.length !== selectedParameterCarriers.length ||
          targetCallable.parameters.some((carrier, index) =>
            !rustTargetTypeRefEquals(carrier, selectedParameterCarriers[index])) ||
          !rustTargetTypeRefEquals(targetCallable.result, selectedResultCarrier)) {
          return undefined;
        }
        const methodCarrier = rustCallableTargetType(
          [resultCarrier, ...selectedParameterCarriers],
          selectedResultCarrier,
        );
        if (resolveFunctionExpressionCarrier(walk, property, sourceFile, methodCarrier, {
          leadingParameters: [{ kind: "this", carrier: resultCarrier }],
          preserveSourceParameterForms: true,
          selectedMethodDeclaration: selectedDeclaration,
          sourceCarrier: selectedCallableCarrier,
        }) === undefined) {
          return undefined;
        }
        contributions.push({
          kind: "structural-method",
          property,
          expression: property,
          sourceName,
          targetStorageIndex: targetField.storageIndex,
        });
        assignedStorageIndexes.add(targetField.storageIndex);
        continue;
      }
      const matchedDeclarations = selectedMethodDeclarations.filter((declaration) => {
        const implementation = selectedProjectDefinition === undefined
          ? undefined
          : walk.context.projectTypes.memberImplementation(
              selectedProjectDefinition,
              declaration,
            );
        return implementation?.kind === "resolved" && selectedDeclarations.includes(
          implementation.implementation.declaration,
        );
      });
      if (storage !== "project-object" || selectedElement?.elementKind !== "method" ||
        selectedDeclaration === undefined || !selectedMethodDeclarations.includes(selectedDeclaration) ||
        matchedDeclarations.length === 0 || selectedParameterCarriers === undefined ||
        selectedResultCarrier === undefined) {
        return undefined;
      }
      const methodCarrier = rustClosureTargetType(
        [resultCarrier, ...selectedParameterCarriers],
        selectedResultCarrier,
      );
      if (resolveFunctionExpressionCarrier(walk, property, sourceFile, methodCarrier, {
        leadingParameters: [{ kind: "this", carrier: resultCarrier }],
        preserveSourceParameterForms: true,
        selectedMethodDeclaration: selectedDeclaration,
        sourceCarrier: selectedCallableCarrier,
      }) === undefined) {
        return undefined;
      }
      contributions.push({
        kind: "method",
        property,
        expression: property,
        contractDeclarations: Object.freeze([...matchedDeclarations]),
      });
      for (const declaration of matchedDeclarations) {
        assignedMethodDeclarations.add(declaration);
      }
      continue;
    }
    const nameNode = ast.name(property);
    const sourceName = nameNode === undefined ? "" : ast.text(nameNode);
    const initializer = ObjectLiteralProperty_Value(ast, property);
    const initializerKind = initializer === undefined ? "" : ast.kindName(initializer);
    if (initializer !== undefined &&
      (initializerKind === KindFunctionExpression || initializerKind === "KindArrowFunction") &&
      storage === "project-object" && selectedElement?.elementKind === "property") {
      const selectedDeclarations = selectedElement.sourceSelectedDeclarations;
      const selectedDeclaration = selectedElement.sourceSelectedDeclaration;
      const matchedDeclarations = selectedMethodDeclarations.filter((declaration) => {
        const implementation = selectedProjectDefinition === undefined
          ? undefined
          : walk.context.projectTypes.memberImplementation(
              selectedProjectDefinition,
              declaration,
            );
        return implementation?.kind === "resolved" && selectedDeclarations.includes(
          implementation.implementation.declaration,
        );
      });
      const selectedMemberCarrier = selectedDeclaration === undefined
        ? undefined
        : resolveObjectLiteralMethodCarrier(
            walk,
            initializer,
            selectedElement.sourceSelectedType,
            selectedElement.sourceElementType,
          );
      const selectedCallable = rustCallableProtocol(selectedMemberCarrier);
      const selectedClosure = rustClosureProtocol(selectedMemberCarrier);
      const selectedParameterCarriers = selectedMemberCarrier?.kind === "function-pointer"
        ? selectedMemberCarrier.args
        : selectedCallable?.parameters ?? selectedClosure?.parameters;
      const selectedResultCarrier = selectedMemberCarrier?.kind === "function-pointer"
        ? selectedMemberCarrier.result
        : selectedCallable?.result ?? selectedClosure?.result;
      if (selectedDeclaration === undefined ||
        !selectedMethodDeclarations.includes(selectedDeclaration) ||
        matchedDeclarations.length === 0 || selectedParameterCarriers === undefined ||
        selectedResultCarrier === undefined) {
        return undefined;
      }
      const methodCarrier = rustClosureTargetType(
        [resultCarrier, ...selectedParameterCarriers],
        selectedResultCarrier,
      );
      if (resolveFunctionExpressionCarrier(walk, initializer, sourceFile, methodCarrier, {
        leadingParameters: [{
          kind: initializerKind === KindFunctionExpression ? "this" : "receiver",
          carrier: resultCarrier,
        }],
        preserveSourceParameterForms: true,
        selectedMethodDeclaration: selectedDeclaration,
        sourceCarrier: selectedMemberCarrier,
      }) === undefined) {
        return undefined;
      }
      contributions.push({
        kind: "method",
        property,
        expression: initializer,
        contractDeclarations: Object.freeze([...matchedDeclarations]),
      });
      for (const declaration of matchedDeclarations) {
        assignedMethodDeclarations.add(declaration);
      }
      continue;
    }
    const targetField = storage === "project-object"
      ? selectedFields.find((field) =>
          field.implementationDeclaration !== undefined &&
          (selectedElement?.sourceSelectedDeclaration === field.implementationDeclaration ||
            selectedElement?.sourceSelectedDeclarations.includes(field.implementationDeclaration)))
      : selectedFieldByName.get(sourceName);
    if (targetField === undefined || initializer === undefined ||
      resolveExpressionCarrier(walk, initializer, sourceFile, targetField.carrier) === undefined) {
      return undefined;
    }
    contributions.push({
      kind: "property",
      property,
      sourceName,
      targetStorageIndex: targetField.storageIndex,
    });
    assignedStorageIndexes.add(targetField.storageIndex);
  }
  const everyFieldAssigned = selectedFields.every((field) => {
    const roles = assignedAccessorRoles.get(field.storageIndex);
    const accessorComplete = roles?.has("get") === true &&
      (field.readonly || roles.has("set"));
    return field.presence === "optional" ||
      assignedStorageIndexes.has(field.storageIndex) || accessorComplete;
  });
  if (!everyFieldAssigned ||
    selectedMethodDeclarations.some((declaration) => !assignedMethodDeclarations.has(declaration))) {
    return undefined;
  }
  const fields = selectedFields.map((field) => ({
    ...(field.implementationDeclaration === undefined
      ? {}
      : { implementationDeclaration: field.implementationDeclaration }),
    contractDeclarations: Object.freeze([...field.contractDeclarations]),
    sourceName: field.sourceName,
    storageIndex: field.storageIndex,
    carrier: field.carrier,
    presence: field.presence,
    readonly: field.readonly,
    ...(field.accessor === undefined ? {} : { accessor: field.accessor }),
    ...(field.method === true ? { method: true as const } : {}),
  }));
  if (storage === "object-handle" && selectedFields.some((field) => {
    if (field.method === true) {
      return false;
    }
    const kinds = [
      ...(assignedStorageIndexes.has(field.storageIndex) ? ["stored" as const] : []),
      ...(assignedAccessorRoles.get(field.storageIndex)?.has("get") === true
        ? ["accessor" as const]
        : []),
    ];
    return kinds.some((kind) => !walk.sourceTypes.registerStructuralFieldImplementation({
      carrier: resultCarrier,
      storageIndex: field.storageIndex,
      kind,
    }));
  })) {
    appendRustDiagnostic(
      walk,
      "RUST_STRUCTURAL_PROPERTY_IMPLEMENTATION_CONFLICT",
      "A structural property implementation conflicts with its finalized carrier and storage slot.",
      expression,
      ["target.capability=rust.structural-property.closed-storage"],
    );
    return undefined;
  }
  setRustOperationFact(walk, expression, {
    kind: "record-literal",
    operationId: "tsonic.rust.record.literal",
    storage,
    resultCarrier,
    fields,
    contributions,
  });
  if (storage === "project-object") {
    for (const contribution of contributions) {
      if (contribution.kind !== "accessor") {
        continue;
      }
      const field = fields.find((candidate) =>
        candidate.storageIndex === contribution.targetStorageIndex);
      if (field === undefined) {
        return undefined;
      }
      walk.context.projectFieldDispatch.recordObjectLiteralAccessor(
        field.contractDeclarations,
        contribution.role,
      );
    }
  }
  if (contributions.some((contribution) => contribution.kind === "method")) {
    walk.objectLiteralMethodExpressions.push(expression);
  }
  if (contributions.some((contribution) =>
    contribution.kind === "spread" && contribution.methods.length > 0)) {
    walk.objectLiteralMethodSpreadExpressions.push(expression);
  }
  return setCarrierFact(walk, expression, resultCarrier);
}

function resolveProjectMethodPropertyCarrier(
  walk: RustFactWalk,
  declaration: Node,
  receiverCarrier: TargetTypeRef,
): TargetTypeRef | undefined {
  const owner = walk.context.projectTypes.definitionContainingDeclaration(declaration);
  const relationship = owner === undefined
    ? undefined
    : walk.context.projectTypes.relationship(receiverCarrier, owner);
  const parameters = requireDenseSourceNodes(
    walk,
    walk.context.ast.parameters(declaration),
    "Project method property contains an undefined parameter slot.",
  );
  if (relationship?.kind !== "related" || parameters === undefined ||
    walk.context.ast.typeParameters(declaration).length !== 0 ||
    walk.context.ast.hasModifierKind(declaration, "async") ||
    walk.context.facts.get(declaration, rustGeneratorFactKey) !== undefined) {
    return undefined;
  }
  const parameterCarriers = parameters.map((parameter) => {
    const abi = walk.context.facts.get(parameter, rustSourceParameterAbiFactKey);
    return abi?.form === "required" && abi.mode === "value"
      ? walk.context.projectTypes.instantiateMemberCarrier(
          parameter,
          relationship.targetType,
          abi.parameterCarrier,
        )
      : undefined;
  });
  const returnCarrier = walk.context.facts.get(
    declaration,
    rustSourceCallableReturnFactKey,
  )?.returnCarrier;
  const resultCarrier = returnCarrier === undefined
    ? undefined
    : walk.context.projectTypes.instantiateMemberCarrier(
        declaration,
        relationship.targetType,
        returnCarrier,
      );
  return resultCarrier === undefined || parameterCarriers.some((carrier) => carrier === undefined)
    ? undefined
    : rustCallableTargetType(
        parameterCarriers as TargetTypeRef[],
        resultCarrier,
      );
}

function resolveProjectIndexRecordLiteral(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  resultCarrier: TargetTypeRef,
  properties: readonly Node[],
  definition: import("./project-type-policy.js").RustProjectTypeDefinition,
  layout: import("./project-object-layout.js").RustProjectObjectLayout,
): TargetTypeRef | undefined {
  if (definition.kind !== "interface" || layout.indexSignatures.length !== 1 ||
    layout.fields.length !== 0 ||
    walk.context.projectTypes.isPolymorphic(definition)) {
    return undefined;
  }
  const index = layout.indexSignatures[0]!;
  const declaredKeyCarrier = walk.context.facts.get(index.keyParameter, rustRuntimeCarrierKey)?.carrier ??
    resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, index.keyParameter));
  const declaredValueCarrier = walk.context.facts.get(index.declaration, rustRuntimeCarrierKey)?.carrier ??
    resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, index.declaration));
  const keyCarrier = declaredKeyCarrier === undefined
    ? undefined
    : walk.context.projectTypes.instantiateMemberCarrier(
        index.keyParameter,
        resultCarrier,
        declaredKeyCarrier,
      );
  const valueCarrier = declaredValueCarrier === undefined
    ? undefined
    : walk.context.projectTypes.instantiateMemberCarrier(
        index.declaration,
        resultCarrier,
        declaredValueCarrier,
      );
  const storageName = walk.context.projectTypes.fieldStorageName(
    definition,
    index.declaration,
  );
  if (keyCarrier === undefined || valueCarrier === undefined || storageName === undefined ||
    (!isRustStringCarrier(keyCarrier) && !isRustIntegerCarrier(keyCarrier)) ||
    !rustCarrierSupportsClone(valueCarrier)) {
    return undefined;
  }
  const contributions: Extract<
    RustTargetOperationFact,
    { readonly kind: "record-index-literal" }
  >["contributions"][number][] = [];
  for (const property of properties) {
    const kind = walk.context.ast.kindName(property);
    if (kind === KindSpreadAssignment) {
      const spreadExpression = SpreadAssignment_Expression(walk.context.ast, property);
      const sourceCarrier = spreadExpression === undefined
        ? undefined
        : resolveExpressionCarrier(walk, spreadExpression, sourceFile, undefined);
      const sourceDefinition = sourceCarrier === undefined
        ? undefined
        : walk.context.projectTypes.definitionForCarrier(sourceCarrier);
      const sourceLayout = sourceDefinition?.kind === "interface"
        ? rustProjectObjectLayout(sourceDefinition.declaration, walk.context.ast)
        : undefined;
      const sourceIndex = sourceLayout?.indexSignatures.length === 1 &&
          sourceLayout.fields.length === 0 && !walk.context.projectTypes.isPolymorphic(sourceDefinition!)
        ? sourceLayout.indexSignatures[0]
        : undefined;
      const sourceDeclaredKey = sourceIndex === undefined
        ? undefined
        : walk.context.facts.get(sourceIndex.keyParameter, rustRuntimeCarrierKey)?.carrier ??
          resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, sourceIndex.keyParameter));
      const sourceDeclaredValue = sourceIndex === undefined
        ? undefined
        : walk.context.facts.get(sourceIndex.declaration, rustRuntimeCarrierKey)?.carrier ??
          resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, sourceIndex.declaration));
      const sourceKey = sourceDeclaredKey === undefined || sourceCarrier === undefined
        ? undefined
        : walk.context.projectTypes.instantiateMemberCarrier(
            sourceIndex!.keyParameter,
            sourceCarrier,
            sourceDeclaredKey,
          );
      const sourceValue = sourceDeclaredValue === undefined || sourceCarrier === undefined
        ? undefined
        : walk.context.projectTypes.instantiateMemberCarrier(
            sourceIndex!.declaration,
            sourceCarrier,
            sourceDeclaredValue,
          );
      const sourceStorageName = sourceDefinition === undefined || sourceIndex === undefined
        ? undefined
        : walk.context.projectTypes.fieldStorageName(sourceDefinition, sourceIndex.declaration);
      if (spreadExpression === undefined || sourceCarrier === undefined || sourceIndex === undefined ||
        sourceStorageName === undefined || !rustTargetTypeRefEquals(sourceKey, keyCarrier) ||
        !rustTargetTypeRefEquals(sourceValue, valueCarrier)) {
        return undefined;
      }
      contributions.push({
        kind: "spread",
        property,
        expression: spreadExpression,
        sourceCarrier,
        sourceStorageName,
      });
      continue;
    }
    if (kind !== "KindPropertyAssignment" && kind !== "KindShorthandPropertyAssignment") {
      return undefined;
    }
    const name = walk.context.ast.name(property);
    const sourceName = name === undefined ? "" : walk.context.ast.text(name);
    const initializer = ObjectLiteralProperty_Value(walk.context.ast, property);
    if (sourceName.length === 0 || initializer === undefined ||
      resolveExpressionCarrier(walk, initializer, sourceFile, valueCarrier) === undefined) {
      return undefined;
    }
    contributions.push({
      kind: "property",
      property,
      sourceName,
      expression: initializer,
    });
  }
  setRustOperationFact(walk, expression, {
    kind: "record-index-literal",
    operationId: "tsonic.rust.record.index-literal",
    resultCarrier,
    keyCarrier,
    valueCarrier,
    storageName,
    contributions,
  });
  return setCarrierFact(walk, expression, resultCarrier);
}

function resolveObjectLiteralMethodCarrier(
  walk: RustFactWalk,
  method: Node,
  selectedType: Type,
  implementationType: Type,
): TargetTypeRef | undefined {
  const typeParameters = requireDenseSourceNodes(
    walk,
    walk.context.ast.typeParameters(method),
    "Authored object-literal method contains an undefined type-parameter slot.",
  );
  const parameters = requireDenseSourceNodes(
    walk,
    walk.context.ast.parameters(method),
    "Authored object-literal method contains an undefined parameter slot.",
  );
  const authoredReturnType = Node_Type(walk.context.ast, method);
  if (parameters !== undefined && authoredReturnType !== undefined &&
    parameters.every((parameter) => Node_Type(walk.context.ast, parameter) !== undefined)) {
    const parameterCarriers = parameters.map((parameter) =>
      resolveParameterAbi(walk, parameter)?.parameterCarrier);
    const returnCarrier = resolveTypeNodeCarrier(walk, authoredReturnType);
    if (returnCarrier !== undefined && !parameterCarriers.some((carrier) => carrier === undefined)) {
      return rustClosureTargetType(
        parameterCarriers as readonly TargetTypeRef[],
        returnCarrier,
      );
    }
  }
  const selected = resolveRustTargetTypeRef(
    selectedType,
    rustResolutionContext(walk, method),
    walk.operationOptions,
  );
  if (selected !== undefined) {
    return selected;
  }
  const returnCarrier = walk.context.facts.get(
    method,
    rustSourceCallableReturnFactKey,
  )?.returnCarrier ?? walk.context.facts.resolve(
    method,
    rustSourceCallableReturnFactKey,
  )?.returnCarrier ?? resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, method));
  if (typeParameters !== undefined && typeParameters.length > 0 &&
    parameters !== undefined && returnCarrier !== undefined) {
    const parameterCarriers = parameters.map((parameter) =>
      (walk.context.facts.get(parameter, rustSourceParameterAbiFactKey) ??
        walk.context.facts.resolve(parameter, rustSourceParameterAbiFactKey) ??
        resolveParameterAbi(walk, parameter))?.parameterCarrier);
    if (!parameterCarriers.some((carrier) => carrier === undefined)) {
      return rustClosureTargetType(
        parameterCarriers as readonly TargetTypeRef[],
        returnCarrier,
      );
    }
  }
  return resolveRustTargetTypeRef(
    implementationType,
    rustResolutionContext(walk, method),
    walk.operationOptions,
  );
}

interface RustResolvedRecordShape {
  readonly storage: "project-object" | "object-handle";
  readonly fields: readonly {
    readonly sourceName: string;
    readonly storageIndex: number;
    readonly carrier: TargetTypeRef;
    readonly presence: "required" | "optional";
    readonly accessor?: {
      readonly getter: true;
      readonly setter: boolean;
    };
    readonly method?: true;
  }[];
}

function resolveRustRecordShape(
  walk: RustFactWalk,
  carrier: TargetTypeRef,
  requireInterface: boolean,
): RustResolvedRecordShape | undefined {
  const sourceValue = rustSourceTypeCarrierValue(carrier);
  if (sourceValue?.shape === "object") {
    const shapeDeclaration = walk.sourceTypes.declarationForCarrier(carrier);
    const layout = shapeDeclaration === undefined
      ? undefined
      : rustProjectObjectLayout(shapeDeclaration, walk.context.ast);
    if (layout === undefined || requireInterface && layout.kind !== "interface") {
      return undefined;
    }
    const fields = layout.fields.map((field) => {
      const declared = walk.context.facts.get(field.declaration, rustRuntimeCarrierKey)?.carrier ??
        resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, field.declaration));
      const instantiated = declared === undefined
        ? undefined
        : walk.context.projectTypes.instantiateMemberCarrier(
            field.declaration,
            carrier,
            declared,
          );
      return instantiated === undefined
        ? undefined
        : {
            sourceName: field.sourceName,
            storageIndex: field.storageIndex,
            carrier: instantiated,
            presence: "required" as const,
          };
    });
    return fields.some((field) => field === undefined)
      ? undefined
      : {
          storage: "project-object",
          fields: fields as readonly {
            readonly sourceName: string;
            readonly storageIndex: number;
            readonly carrier: TargetTypeRef;
            readonly presence: "required";
          }[],
        };
  }
  const structural = rustStructuralObjectCarrierValue(carrier);
  return structural === undefined
    ? undefined
    : {
        storage: "object-handle",
        fields: structural.fields.map((field, storageIndex) => ({
          sourceName: field.sourceName,
          storageIndex,
          carrier: field.type,
          presence: field.presence,
          ...(field.accessor === undefined ? {} : { accessor: field.accessor }),
          ...(field.method === true ? { method: true as const } : {}),
        })),
      };
}

function selectRustRecordLiteralUnionVariantByCheckedType(
  walk: RustFactWalk,
  expression: Node,
  union: RustSourceUnion,
): RustSourceUnionVariant | undefined {
  const selectedSourceType = walk.context.semanticsFor(expression).getTypeAtLocation(expression);
  const selectedCarrier = resolveRustTargetTypeRef(
    selectedSourceType,
    rustResolutionContext(walk, expression),
    walk.operationOptions,
  );
  const candidates = union.variants.filter((variant) =>
    rustTargetTypeRefEquals(variant.carrier, selectedCarrier));
  return candidates.length === 1 ? candidates[0] : undefined;
}

function selectRustRecordLiteralUnionVariant(
  walk: RustFactWalk,
  expression: Node,
  union: RustSourceUnion,
  propertiesByName: ReadonlyMap<string, Node>,
): RustSourceUnionVariant | undefined {
  const propertyNames = [...propertiesByName.keys()].sort();
  let candidates = union.variants.filter((variant) =>
    variant.shape !== undefined &&
    variant.shape.fields.length === propertyNames.length &&
    variant.shape.fields.every((field, index) =>
      field.sourceName === propertyNames[index]));
  if (candidates.length === 0) {
    return undefined;
  }
  const semantics = walk.context.semanticsFor(expression);
  const selectedSourceType = semantics.getTypeAtLocation(expression);
  const selectedCarrier = resolveRustTargetTypeRef(
    selectedSourceType,
    rustResolutionContext(walk, expression),
    walk.operationOptions,
  );
  const carrierCandidates = candidates.filter((variant) =>
    rustTargetTypeRefEquals(variant.carrier, selectedCarrier));
  if (carrierCandidates.length === 1) {
    return carrierCandidates[0];
  }
  for (const [sourceName, property] of propertiesByName) {
    const initializer = ObjectLiteralProperty_Value(walk.context.ast, property);
    if (initializer === undefined) {
      return undefined;
    }
    const fieldTypes = candidates.map((candidate) =>
      candidate.shape?.fields.find((field) => field.sourceName === sourceName)?.sourceType);
    if (fieldTypes.some((type) => type === undefined)) {
      return undefined;
    }
    const selectedFieldTypes = fieldTypes as readonly Type[];
    const firstFieldType = selectedFieldTypes[0]!;
    if (selectedFieldTypes.every((type) =>
      semantics.getTypeRelationship(firstFieldType, type) !== "unrelated")) {
      continue;
    }
    const selectedValueType = semantics.getTypeAtLocation(initializer);
    if (selectedValueType === undefined) {
      return undefined;
    }
    candidates = candidates.filter((_, index) => {
      const fieldType = selectedFieldTypes[index];
      if (fieldType === undefined) {
        return false;
      }
      const refinement = semantics.selectTypeRefinement(fieldType, selectedValueType);
      return refinement.kind === "exact" || refinement.kind === "members";
    });
    if (candidates.length < 2) {
      break;
    }
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

function registerTypeAlias(walk: RustFactWalk, declaration: Node): void {
  const variants = walk.sourceTypes.enumVariantsForDeclaration(declaration);
  if (variants !== undefined) {
    const carrier = sourceTypeCarrierForDeclaration(walk, declaration);
    if (carrier === undefined) {
      return;
    }
    setCarrierFact(walk, declaration, carrier);
    walk.context.facts.set(declaration, rustTypeAliasDeclarationFactKey, {
      kind: "string-literal",
      variants,
    }, [{ message: "rust string-literal union declaration" }]);
    return;
  }
  const { ast } = walk.context;
  if (ast.typeParameters(declaration).length !== 0) {
    return;
  }
  const nameNode = ast.name(declaration);
  const typeName = nameNode === undefined ? "" : ast.text(nameNode);
  const fileName = ast.getFileName(ast.getSourceFile(declaration));
  const semantics = walk.context.semanticsFor(declaration);
  const symbol = nameNode === undefined ? undefined : semantics.getSymbolAtLocation(nameNode);
  const sourceType = symbol === undefined ? undefined : semantics.getDeclaredTypeOfSymbol(symbol);
  if (sourceType === undefined || typeName.length === 0 || fileName.length === 0) {
    return;
  }
  if (!semantics.isUnion(sourceType)) {
    const typeNode = Node_Type(ast, declaration);
    const carrier = resolveRustTargetTypeRef(
      typeNode ?? sourceType,
      rustResolutionContext(walk, declaration),
      walk.operationOptions,
    );
    if (carrier === undefined ||
      !walk.sourceTypes.registerRepresentationAlias(declaration, carrier)) {
      return;
    }
    setCarrierFact(walk, declaration, carrier);
    if (typeNode !== undefined) {
      setCarrierFact(walk, typeNode, carrier);
    }
    walk.context.facts.set(declaration, rustTypeAliasDeclarationFactKey, {
      kind: "erased",
    }, [{ message: "rust representation-preserving type alias declaration" }]);
    return;
  }
  const compositeCarrier = resolveRustTargetTypeRef(
    sourceType,
    rustResolutionContext(walk, declaration),
    walk.operationOptions,
  );
  if (compositeCarrier !== undefined) {
    if (!walk.sourceTypes.registerDeclarationCarrier(declaration, compositeCarrier)) {
      return;
    }
    setCarrierFact(walk, declaration, compositeCarrier);
    walk.context.facts.set(declaration, rustTypeAliasDeclarationFactKey, {
      kind: "erased",
    }, [{ message: "rust representation-identical union declaration" }]);
    return;
  }
  const sourceMembers = semantics.getUnionOrIntersectionTypes(sourceType);
  if (!isDenseDataArray(sourceMembers) || sourceMembers.length < 2 ||
    sourceMembers.some((member) => member === undefined)) {
    return;
  }
  const uniqueVariants: {
    readonly sourceType: Type;
    readonly carrier: TargetTypeRef;
  }[] = [];
  for (const member of sourceMembers as readonly Type[]) {
    const carrier = resolveRustTargetTypeRef(
      member,
      rustResolutionContext(walk, declaration),
      walk.operationOptions,
    );
    if (carrier === undefined) {
      return;
    }
    if (!uniqueVariants.some((variant) =>
      rustTargetTypeRefEquals(variant.carrier, carrier))) {
      uniqueVariants.push({ sourceType: member, carrier });
    }
  }
  if (uniqueVariants.length === 1) {
    const carrier = uniqueVariants[0]!.carrier;
    if (!walk.sourceTypes.registerDeclarationCarrier(declaration, carrier)) {
      return;
    }
    setCarrierFact(walk, declaration, carrier);
    walk.context.facts.set(declaration, rustTypeAliasDeclarationFactKey, {
      kind: "erased",
    }, [{ message: "rust representation-identical union declaration" }]);
    return;
  }
  const finalizedVariants = uniqueVariants.map((variant, index) => {
    const shape = walk.sourceTypes.structuralObjectForType(
      variant.sourceType,
      variant.carrier,
    );
    return {
      name: `Variant${index}`,
      sourceType: variant.sourceType,
      carrier: variant.carrier,
      ...(shape === undefined ? {} : { shape }),
    };
  });
  const carrier = rustSourceUnionTargetType(
    fileName,
    typeName,
    finalizedVariants.map((variant) => ({
      name: variant.name,
      carrier: variant.carrier,
    })),
  );
  const variantFieldDeclarations = new Set(finalizedVariants.flatMap((variant) =>
    variant.shape?.fields.flatMap((field) => field.declarations) ?? []));
  const selectedProperties = semantics.getPropertyInfos(sourceType).map((property) => {
    const declarations = semantics.getSymbolDeclarations(property.symbol);
    if (!isDenseDataArray(declarations) || declarations.length === 0 ||
      declarations.some((selected) => selected === undefined)) {
      return undefined;
    }
    const selectedDeclarations = declarations as readonly Node[];
    return selectedDeclarations.every((selected) =>
      walk.context.source.navigation.isProjectDeclaration(selected) &&
      variantFieldDeclarations.has(selected))
      ? {
          symbol: property.symbol,
          declarations: Object.freeze([...selectedDeclarations]),
        }
      : undefined;
  });
  if (selectedProperties.some((property) => property === undefined)) {
    return;
  }
  if (!walk.sourceTypes.registerSourceUnion({
    declaration,
    sourceType,
    carrier,
    variants: finalizedVariants,
    selectedProperties: selectedProperties as readonly {
      readonly symbol: import("@tsonic/tsts").Symbol;
      readonly declarations: readonly Node[];
    }[],
  })) {
    return;
  }
  setCarrierFact(walk, declaration, carrier);
  walk.context.facts.set(declaration, rustTypeAliasDeclarationFactKey, {
    kind: "runtime",
    variants: finalizedVariants.map((variant) => ({
      name: variant.name,
      carrier: variant.carrier,
    })),
  }, [{ message: "rust runtime union declaration" }]);
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
    navigation: walk.context.source.navigation,
    semanticsFor: walk.context.semanticsFor,
    sourceTypes: walk.sourceTypes,
    resolveCarrier: (subject) => resolveRustTargetTypeRef(
      subject,
      rustResolutionContext(walk, subject),
      walk.operationOptions,
    ),
    resolveProjectFieldCarrier: (declaration, receiverCarrier) => {
      const declaredCarrier = resolveRustTargetTypeRef(
        declaration,
        rustResolutionContext(walk, declaration),
        walk.operationOptions,
      );
      return declaredCarrier === undefined
        ? undefined
        : walk.context.projectTypes.instantiateMemberCarrier(
            declaration,
            receiverCarrier,
            declaredCarrier,
          );
    },
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
    if (operation?.kind === "source-field" ||
      operation?.kind === "source-union-field" ||
      operation?.kind === "source-accessor" ||
      operation?.kind === "source-method-property") {
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
  const declarationSet = new Set<Node>();
  const regionsByDeclaration = new Map<Node, Set<Node>>();
  const relatedDeclarations = new Map<Node, Set<Node>>();
  const dependenciesByDeclaration = new Map<Node, Set<Node>>();
  const addDeclaration = (declaration: Node): void => {
    if (!declarationSet.has(declaration)) {
      declarationSet.add(declaration);
      declarations.push(declaration);
    }
  };
  const addRegion = (declaration: Node, region: Node | undefined): void => {
    addDeclaration(declaration);
    if (region === undefined) {
      return;
    }
    const regions = regionsByDeclaration.get(declaration) ?? new Set<Node>();
    regions.add(region);
    regionsByDeclaration.set(declaration, regions);
  };
  const relateDeclarations = (left: Node, right: Node): void => {
    addDeclaration(left);
    addDeclaration(right);
    if (left === right) {
      return;
    }
    const leftRelations = relatedDeclarations.get(left) ?? new Set<Node>();
    const rightRelations = relatedDeclarations.get(right) ?? new Set<Node>();
    leftRelations.add(right);
    rightRelations.add(left);
    relatedDeclarations.set(left, leftRelations);
    relatedDeclarations.set(right, rightRelations);
  };
  const addDeclarationDependency = (declaration: Node, dependency: Node): void => {
    addDeclaration(declaration);
    addDeclaration(dependency);
    const dependencies = dependenciesByDeclaration.get(declaration) ?? new Set<Node>();
    dependencies.add(dependency);
    dependenciesByDeclaration.set(declaration, dependencies);
  };
  const registerCallableDeclaration = (declaration: Node): void => {
    addRegion(declaration, ast.body(declaration));
    const implementation = walk.context.source.navigation.callableImplementation(declaration);
    if (implementation.kind !== "resolved") {
      return;
    }
    const implementationDeclaration = implementation.implementation.declaration;
    addRegion(implementationDeclaration, ast.body(implementationDeclaration));
    relateDeclarations(declaration, implementationDeclaration);
  };
  const callableMemberKind = (node: Node): boolean => {
    const kind = ast.kindName(node);
    return kind === "KindMethodDeclaration" || kind === "KindMethodSignature" ||
      kind === "KindGetAccessor" || kind === "KindSetAccessor";
  };
  for (const sourceFile of projectSourceFiles) {
    for (const statement of ast.statements(sourceFile) as readonly Node[]) {
      const kind = ast.kindName(statement);
      if (kind === KindFunctionDeclaration) {
        registerCallableDeclaration(statement);
      } else if (kind === KindVariableStatement) {
        const declarations = VariableDeclarationList_Declarations(
          ast,
          VariableStatement_DeclarationList(ast, statement),
        );
        if (declarations === undefined || !isDenseDataArray(declarations)) {
          return;
        }
        for (const declaration of declarations) {
          const binding = declaration === undefined
            ? undefined
            : walk.context.facts.get(declaration, rustModuleBindingFactKey) ??
              walk.context.facts.resolve(declaration, rustModuleBindingFactKey);
          if (binding?.storage === "native-function") {
            addRegion(
              binding.callableDeclaration,
              ast.body(binding.callableDeclaration),
            );
          }
        }
      } else if (kind === "KindClassDeclaration") {
        const members = requireDenseSourceNodes(walk, ast.members(statement), "Class declaration contains an undefined or non-data member slot.");
        if (members === undefined) {
          return;
        }
        const constructors = members.filter((member) =>
          ast.kindName(member) === "KindConstructor");
        const constructorImplementation = constructors.find((member) =>
          ast.body(member) !== undefined);
        const constructorSubject = constructorImplementation ?? statement;
        addDeclaration(constructorSubject);
        for (const constructor of constructors) {
          registerCallableDeclaration(constructor);
          relateDeclarations(constructorSubject, constructor);
        }
        for (const member of members) {
          if (ast.kindName(member) === "KindPropertyDeclaration") {
            if (!ast.hasModifierKind(member, "static")) {
              addRegion(constructorSubject, Node_Initializer(ast, member));
            }
          } else if (callableMemberKind(member)) {
            registerCallableDeclaration(member);
          }
        }
      }
    }
  }
  for (const sourceFile of projectSourceFiles) {
    const visitObjectLiteralMethods = (node: Node): void => {
      const operation = walk.context.facts.get(node, rustTargetOperationFactKey) ??
        walk.context.facts.resolve(node, rustTargetOperationFactKey);
      if (operation?.kind === "record-literal") {
        for (const contribution of operation.contributions) {
          if (contribution.kind !== "method") {
            continue;
          }
          addRegion(contribution.expression, ast.body(contribution.expression));
          for (const declaration of contribution.contractDeclarations) {
            addDeclarationDependency(declaration, contribution.expression);
          }
        }
      }
      ast.forEachChild(node, (child) => {
        if (child !== undefined) {
          visitObjectLiteralMethods(child);
        }
      });
    };
    visitObjectLiteralMethods(sourceFile);
  }
  for (const definition of walk.context.projectTypes.definitions) {
    const members = requireDenseSourceNodes(
      walk,
      ast.members(definition.declaration),
      "Project type declaration contains an undefined or non-data member slot.",
    );
    if (members === undefined) {
      return;
    }
    for (const member of members) {
      if (!callableMemberKind(member) || ast.hasModifierKind(member, "static")) {
        continue;
      }
      registerCallableDeclaration(member);
      for (const concrete of walk.context.projectTypes.concreteClassesFor(definition)) {
        const implementation = walk.context.projectTypes.memberImplementation(concrete, member);
        if (implementation.kind !== "resolved") {
          continue;
        }
        const implementationDeclaration = implementation.implementation.declaration;
        addRegion(implementationDeclaration, ast.body(implementationDeclaration));
        relateDeclarations(member, implementationDeclaration);
      }
    }
    if (definition.kind === "class") {
      for (const signature of walk.context.projectTypes.constructorsForDefinition(definition)) {
        const inherited = rustInheritedProjectConstructor(
          walk.context.projectTypes,
          definition,
          signature,
        );
        if (inherited !== undefined) {
          addDeclarationDependency(
            definition.declaration,
            inherited.constructor.declaration ?? inherited.base.declaration,
          );
        }
      }
    }
  }
  const fallible = new Set<Node>();
  for (const usage of walk.context.projectMethodProperties.usages) {
    if (usage.writable) {
      fallible.add(usage.declaration);
    }
  }
  for (const expression of walk.objectLiteralMethodExpressions) {
    const adapters = walk.context.facts.get(expression, rustObjectLiteralMethodAdapterFactKey) ??
      walk.context.facts.resolve(expression, rustObjectLiteralMethodAdapterFactKey);
    for (const dispatch of adapters?.dispatches ?? []) {
      if (dispatch.adapterFallible) {
        fallible.add(dispatch.contractMethod);
      }
    }
  }
  for (const expression of walk.objectLiteralMethodSpreadExpressions) {
    const operation = walk.context.facts.get(expression, rustTargetOperationFactKey) ??
      walk.context.facts.resolve(expression, rustTargetOperationFactKey);
    if (operation?.kind !== "record-literal") {
      continue;
    }
    for (const contribution of operation.contributions) {
      if (contribution.kind !== "spread") {
        continue;
      }
      for (const method of contribution.methods) {
        fallible.add(method.contractDeclaration);
      }
    }
  }
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
    const operation = walk.context.facts.get(node, rustTargetOperationFactKey) ??
      walk.context.facts.resolve(node, rustTargetOperationFactKey);
    const bindingProjection = walk.context.facts.get(node, rustBindingProjectionFactKey) ??
      walk.context.facts.resolve(node, rustBindingProjectionFactKey);
    const contextualConversion = walk.context.facts.get(
      node,
      rustContextualValueConversionFactKey,
    ) ?? walk.context.facts.resolve(node, rustContextualValueConversionFactKey);
    const projection = bindingProjection?.projection;
    const bindingProjectionIsFallible = bindingProjection === undefined
      ? false
      : projection?.kind === "object-field"
      ? projection.accessor !== undefined ||
        projection.storage === "object-handle" &&
          walk.context.structuralShapes.field(
            bindingProjection.sourceCarrier,
            projection.storageIndex,
          )?.storage === "property"
      : projection?.kind === "object-rest" &&
        projection.fields.some((field) => field.accessor !== undefined ||
          projection.storage === "object-handle" &&
            walk.context.structuralShapes.field(
              bindingProjection.sourceCarrier,
              field.sourceStorageIndex,
            )?.storage === "property");
    return rustTargetOperationIsFallible(
      operation,
      walk.context.structuralShapes,
      walk.context.projectFieldDispatch,
    ) ||
      bindingProjectionIsFallible ||
      rustValueConversionIsFallible(contextualConversion?.conversion);
  };
  const selectedAccessorDeclarations = (node: Node): readonly Node[] => {
    const operation = walk.context.facts.get(node, rustTargetOperationFactKey) ??
      walk.context.facts.resolve(node, rustTargetOperationFactKey);
    if (operation?.kind !== "source-accessor") {
      return [];
    }
    const selected = walk.context.facts.get(node, rustSelectedOperationKey) ??
      walk.context.facts.resolve(node, rustSelectedOperationKey);
    return [
      asSourceNode(
        selected?.provenance?.sourceSelectedReadDeclaration,
        walk.context.ast,
      ),
      asSourceNode(
        selected?.provenance?.sourceSelectedWriteDeclaration,
        walk.context.ast,
      ),
    ].filter((declaration): declaration is Node => declaration !== undefined);
  };

  const callbackExpression = (
    pending: { readonly request: import("../../policy/operations/contracts.js").RustCheckedCallSelectionInput; readonly prepared: RustPreparedDeferredCheckedCall },
  ): Node | undefined => pending.request.source.sourceArguments[
    pending.prepared.callback.sourceArgumentIndex
  ]?.expression;
  const callbackValueExpression = (expression: Node | undefined): Node | undefined => {
    let current = expression;
    while (current !== undefined && ast.kindName(current) === KindParenthesizedExpression) {
      current = Node_Expression(ast, current);
    }
    return current;
  };
  interface CallbackValueAnalysis {
    readonly fallible: boolean;
    readonly subjects: readonly Node[];
  }
  const callbackExpressionIsFallible = (
    pending: { readonly request: import("../../policy/operations/contracts.js").RustCheckedCallSelectionInput; readonly prepared: RustPreparedDeferredCheckedCall },
  ): boolean => callbackValueAnalysis(callbackExpression(pending), new Set())?.fallible === true;
  const callbackValueAnalysis = (
    expression: Node | undefined,
    resolving: Set<Node>,
  ): CallbackValueAnalysis | undefined => {
    const value = callbackValueExpression(expression);
    if (value === undefined || resolving.has(value)) {
      return undefined;
    }
    resolving.add(value);
    try {
      const body = ast.body(value);
      if (body !== undefined) {
        return {
          fallible: expressionRegionIsFallible(body),
          subjects: [value],
        };
      }
      const declaration = walk.context.source.navigation.sourceReferenceFor(value)?.declaration;
      if (declaration === undefined) {
        return undefined;
      }
      if (fallible.has(declaration)) {
        return { fallible: true, subjects: [value, declaration] };
      }
      const declarationBody = ast.body(declaration);
      if (declarationBody !== undefined) {
        return {
          fallible: expressionRegionIsFallible(declarationBody),
          subjects: [value, declaration],
        };
      }
      const initialized = callbackValueAnalysis(Node_Initializer(ast, declaration), resolving);
      return initialized === undefined
        ? undefined
        : {
            fallible: initialized.fallible,
            subjects: [value, declaration, ...initialized.subjects],
          };
    } finally {
      resolving.delete(value);
    }
  };
  const preparedCallbackOperationIsFallible = (node: Node): boolean => {
    const pending = walk.preparedCallbackCalls.get(node);
    return pending !== undefined && (
      pending.prepared.template.isFallible || callbackExpressionIsFallible(pending)
    );
  };
  function expressionRegionIsFallible(root: Node): boolean {
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
      if (!insideTry && (operationIsFallible(node) || preparedCallbackOperationIsFallible(node))) {
        found = true;
        return;
      }
      if (!insideTry && selectedAccessorDeclarations(node).some((declaration) =>
        fallible.has(declaration))) {
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
  }
  const declarationIsFallible = (declaration: Node): boolean =>
    [...(regionsByDeclaration.get(declaration) ?? [])].some(expressionRegionIsFallible) ||
    [...(dependenciesByDeclaration.get(declaration) ?? [])].some((dependency) =>
      fallible.has(dependency));

  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      if (!fallible.has(declaration) && declarationIsFallible(declaration)) {
        fallible.add(declaration);
        changed = true;
      }
    }
    for (const [declaration, related] of relatedDeclarations) {
      if (!fallible.has(declaration) && [...related].some((candidate) => fallible.has(candidate))) {
        fallible.add(declaration);
        changed = true;
      }
    }
  }
  const ownedCallbackClosures = new Set<Node>();
  for (const [call, pending] of walk.preparedCallbackCalls) {
    const callbackArgument = callbackValueExpression(callbackExpression(pending));
    const callbackAnalysis = callbackValueAnalysis(callbackArgument, new Set());
    if (callbackAnalysis === undefined) {
      appendRustDiagnostic(
        walk,
        "RUST_CALLBACK_VALUE_NOT_PROVEN",
        "The selected provider callback argument does not resolve to one exact project-source callable implementation.",
        callbackArgument ?? call,
        ["target.capability=rust.callback.exact-source"],
      );
      continue;
    }
    for (const subject of callbackAnalysis.subjects) {
      ownedCallbackClosures.add(subject);
    }
    const sourceFile = ast.getSourceFile(call);
    if (sourceFile === undefined) {
      appendRustDiagnostic(
        walk,
        "RUST_CALLBACK_SOURCE_FILE_MISSING",
        "Prepared callback operation has no owning checked source file.",
        call,
        ["target.capability=rust.callback.exact-source"],
      );
      continue;
    }
    const callbackFallible = callbackAnalysis.fallible;
    const finalized = finalizeRustPreparedCheckedCall(
      pending.request,
      pending.prepared,
      callbackFallible,
      rustOperationContext(walk, call),
      walk.operationOptions,
    );
    if (finalized.kind === "reject") {
      walk.context.diagnostics.push(rustPolicyTargetDiagnostic(finalized.diagnostic));
      continue;
    }
    const operation = walk.context.facts.get(call, rustTargetOperationFactKey) ??
      walk.context.facts.resolve(call, rustTargetOperationFactKey);
    recordSelectedOperationInputs(walk, call, sourceFile, operation);
    if (callbackFallible) {
      for (const subject of callbackAnalysis.subjects) {
        walk.context.facts.set(subject, rustFallibleFactKey, { fallible: true }, [
          { message: "rust fallible callback ABI" },
        ]);
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
          if (rustCallableProtocol(operation.resultCarrier) !== undefined) {
            walk.context.facts.set(node, rustFallibleFactKey, { fallible: true }, [
              { message: "rust fallible first-class callable implementation" },
            ]);
          } else if (!ownedCallbackClosures.has(node)) {
            appendRustDiagnostic(
              walk,
              "RUST_FALLIBLE_CLOSURE_UNSUPPORTED",
              "Native Rust closures cannot contain fallible operations without an exact fallible callback ABI.",
              node,
              ["target.capability=rust.closure.exact-result"],
            );
          }
        }
      } else if (kind === KindPropertyAccessExpression) {
        const operation = walk.context.facts.get(node, rustTargetOperationFactKey) ??
          walk.context.facts.resolve(node, rustTargetOperationFactKey);
        const selected = walk.context.facts.get(node, rustSelectedOperationKey) ??
          walk.context.facts.resolve(node, rustSelectedOperationKey);
        if (operation?.kind === "source-accessor") {
          const readDeclaration = asSourceNode(
            selected?.provenance?.sourceSelectedReadDeclaration,
            walk.context.ast,
          );
          const writeDeclaration = asSourceNode(
            selected?.provenance?.sourceSelectedWriteDeclaration,
            walk.context.ast,
          );
          walk.context.facts.set(node, rustSourceAccessorEffectsFactKey, {
            ...(operation.read === undefined || readDeclaration === undefined
              ? {}
              : { read: fallible.has(readDeclaration) ? "fallible" : "infallible" }),
            ...(operation.write === undefined || writeDeclaration === undefined
              ? {}
              : { write: fallible.has(writeDeclaration) ? "fallible" : "infallible" }),
          }, [{ message: "rust finalized selected project accessor effects" }]);
        }
      } else if (kind === KindCallExpression || kind === KindNewExpression) {
        const operation = walk.context.facts.get(node, rustTargetOperationFactKey) ??
          walk.context.facts.resolve(node, rustTargetOperationFactKey);
        if (operation?.kind === "source-call") {
          const declaration = selectedProjectDeclaration(node);
          const runtimeCallable = (operation.target.form === "callable" &&
              rustCallableProtocol(operation.target.carrier) !== undefined) ||
            operation.target.form === "structural-method" &&
              rustCallableProtocol(operation.target.callableCarrier) !== undefined;
          if (runtimeCallable || declaration !== undefined) {
            const isAsync = rustFutureOutputCarrier(operation.resultCarrier) !== undefined;
            const isFallible = declaration !== undefined && fallible.has(declaration);
            walk.context.facts.set(node, rustSourceCallEffectsFactKey, {
              invocation: runtimeCallable || isFallible && !isAsync
                ? "fallible"
                : "infallible",
              awaiting: isAsync
                ? runtimeCallable || isFallible ? "fallible" : "infallible"
                : "not-applicable",
            }, [{ message: "rust finalized selected project-source call effects" }]);
          }
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

function recordThrowFacts(walk: RustFactWalk, statement: Node, sourceFile: SourceFile): void {
  const { ast } = walk.context;
  const expression = Node_Expression(walk.context.ast, statement);
  if (expression === undefined) {
    return;
  }
  const carrier = resolveExpressionCarrier(walk, expression, sourceFile, undefined);
  const constructor = walk.context.facts.get(expression, rustTargetOperationFactKey) ??
    walk.context.facts.resolve(expression, rustTargetOperationFactKey);
  if (ast.kindName(expression) === KindNewExpression &&
    constructor?.kind === "provider-operation" &&
    constructor.operationId === "tsonic.rust.error.constructor") {
    const [message] = ast.arguments(expression);
    if (message !== undefined) {
      resolveExpressionCarrier(walk, message, sourceFile, rustStringTargetType());
    }
    setRustOperationFact(walk, statement, {
      kind: "throw-op",
      operationId: "tsonic.rust.error.throw.runtime",
      error: { kind: "runtime", constructorOperationId: constructor.operationId },
    });
    return;
  }
  const definition = walk.context.projectTypes.definitionForCarrier(carrier);
  const variant = definition === undefined
    ? undefined
    : walk.context.projectTypes.programErrorVariant(definition);
  if (carrier !== undefined && definition !== undefined && variant !== undefined) {
    setRustOperationFact(walk, statement, {
      kind: "throw-op",
      operationId: `tsonic.rust.error.throw.${variant}`,
      error: { kind: "project", carrier, variant },
    });
    return;
  }
  if (isRustProgramErrorCarrier(carrier)) {
    setRustOperationFact(walk, statement, {
      kind: "throw-op",
      operationId: "tsonic.rust.error.rethrow",
      error: { kind: "program" },
    });
  }
}

// Callable expressions lower to Rust closures only when the selected target
// callback supplies one finalized function-pointer carrier.
function resolveFunctionExpressionCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
  options?: {
    readonly leadingParameters?: readonly {
      readonly kind: "this" | "receiver";
      readonly carrier: TargetTypeRef;
    }[];
    readonly preserveSourceParameterForms?: boolean;
    readonly selectedMethodDeclaration?: Node;
    readonly sourceCarrier?: TargetTypeRef;
  },
): TargetTypeRef | undefined {
  const { ast } = walk.context;
  const parameters = ast.parameters(expression);
  const sourceSelected = options?.sourceCarrier ?? (expected === undefined
    ? resolveRustTargetTypeRef(
        expression,
        rustResolutionContext(walk, expression),
        walk.operationOptions,
      )
    : undefined);
  const resolvedSourceCallable = sourceSelected?.kind === "function-pointer"
    ? { parameters: sourceSelected.args, result: sourceSelected.result }
    : rustClosureProtocol(sourceSelected) ?? rustCallableProtocol(sourceSelected);
  const fallbackParameterCarriers = resolvedSourceCallable?.parameters.map((carrier, index) =>
    Node_Initializer(ast, parameters[index]) === undefined
      ? carrier
      : rustOptionTargetType(carrier));
  const selectedExpected = expected ?? (sourceSelected === undefined ||
      resolvedSourceCallable === undefined || fallbackParameterCarriers === undefined
    ? undefined
    : sourceSelected.kind === "function-pointer" || sourceSelected.kind === "closure"
    ? {
        ...sourceSelected,
        args: fallbackParameterCarriers,
        result: resolvedSourceCallable.result,
      }
    : rustCallableTargetType(fallbackParameterCarriers, resolvedSourceCallable.result));
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
  const leadingParameters = options?.leadingParameters ?? [];
  if (selectedParameters.length < leadingParameters.length ||
    !leadingParameters.every((parameter, index) =>
      rustTargetTypeRefEquals(parameter.carrier, selectedParameters[index]))) {
    return undefined;
  }
  const targetParameterCarriers = selectedParameters.slice(leadingParameters.length);
  if (parameters.length !== targetParameterCarriers.length) {
    return undefined;
  }
  if (resolvedSourceCallable !== undefined &&
    parameters.length !== resolvedSourceCallable.parameters.length) {
    return undefined;
  }
  const parameterAbis: import("./source-callable-abi.js").RustSourceParameterAbi[] = [];
  const byRefCopyParams: boolean[] = [];
  for (const [index, parameter] of parameters.entries()) {
    if (parameter === undefined) {
      return undefined;
    }
    const sourceParameterCarrier = resolvedSourceCallable?.parameters[index];
    const targetParameterCarrier = targetParameterCarriers[index];
    if (targetParameterCarrier === undefined ||
      (targetParameterCarrier.kind === "opaque" && targetParameterCarrier.id === "tsonic.rust.infer")) {
      return undefined;
    }
    const finalizedAbi = walk.context.facts.get(parameter, rustSourceParameterAbiFactKey) ??
      walk.context.facts.resolve(parameter, rustSourceParameterAbiFactKey);
    const parameterAbi = finalizedAbi ?? resolveRustContextualParameterAbi(
      parameter,
      targetParameterCarrier,
      rustResolutionContext(walk, parameter),
      walk.operationOptions,
    );
    if (parameterAbi === undefined ||
      (sourceParameterCarrier !== undefined &&
        !rustTargetTypeRefEquals(parameterAbi.valueCarrier, sourceParameterCarrier)) ||
      !rustTargetTypeRefEquals(
        parameterAbi.parameterCarrier,
        targetParameterCarrier,
      )) {
      return undefined;
    }
    if (finalizedAbi === undefined) {
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
    }
    parameterAbis.push(parameterAbi);
    byRefCopyParams.push(false);
  }
  const body = ast.body(expression);
  if (body === undefined) {
    return undefined;
  }
  const finalizedReturn = walk.context.facts.get(expression, rustSourceCallableReturnFactKey)?.returnCarrier ??
    walk.context.facts.resolve(expression, rustSourceCallableReturnFactKey)?.returnCarrier;
  const selectedResultExpectation = selectedResult.kind === "opaque" && selectedResult.id === "tsonic.rust.infer"
    ? resolveTypeNodeCarrier(walk, Node_Type(ast, expression))
    : selectedResult;
  if (finalizedReturn !== undefined && selectedResultExpectation !== undefined &&
    !rustTargetTypeRefEquals(finalizedReturn, selectedResultExpectation)) {
    return undefined;
  }
  const resultExpectation = finalizedReturn ?? selectedResultExpectation;
  const parameterCarriers = parameterAbis.map((abi) => abi.parameterCarrier);
  const expressionName = Node_Name(ast, expression);
  if (ast.kindName(expression) === KindFunctionExpression && expressionName !== undefined) {
    if (resultExpectation === undefined) {
      return undefined;
    }
    const recursiveCarrier: TargetTypeRef = selectedExpected.kind === "function-pointer" ||
        selectedExpected.kind === "closure"
      ? { ...selectedExpected, args: parameterCarriers, result: resultExpectation }
      : rustCallableTargetType(parameterCarriers, resultExpectation);
    setCarrierFact(walk, expression, recursiveCarrier);
    setCarrierFact(walk, expressionName, recursiveCarrier);
  }
  let bodyCarrier = resultExpectation;
  const previousCallable = walk.currentCallableDeclaration;
  const previousGenerator = walk.currentGeneratorDeclaration;
  const previousMethod = walk.currentMethodDeclaration;
  const previousThis = walk.currentThisCarrier;
  walk.currentCallableDeclaration = expression;
  walk.currentGeneratorDeclaration = undefined;
  walk.currentMethodDeclaration = options?.selectedMethodDeclaration;
  walk.currentThisCarrier = leadingParameters.find((parameter) => parameter.kind === "this")?.carrier;
  try {
    if (ast.kindName(body) === KindBlock) {
      if (bodyCarrier === undefined) {
        return undefined;
      }
      const statements = requireDenseSourceNodes(walk, ast.statements(body), "Callable-expression body contains an undefined or non-data statement slot.");
      if (statements === undefined) {
        return undefined;
      }
      for (const statement of statements) {
        recordStatementFacts(walk, statement, sourceFile, bodyCarrier);
      }
    } else {
      bodyCarrier = resolveExpressionCarrier(walk, body, sourceFile, resultExpectation);
      if (bodyCarrier === undefined) {
        return undefined;
      }
    }
  } finally {
    walk.currentCallableDeclaration = previousCallable;
    walk.currentGeneratorDeclaration = previousGenerator;
    walk.currentMethodDeclaration = previousMethod;
    walk.currentThisCarrier = previousThis;
  }
  const finalizedParameterCarriers = [
    ...leadingParameters.map((parameter) => parameter.carrier),
    ...parameterCarriers,
  ];
  const closureCarrier: TargetTypeRef = selectedExpected.kind === "function-pointer" || selectedExpected.kind === "closure"
    ? { ...selectedExpected, args: finalizedParameterCarriers, result: bodyCarrier }
    : rustCallableTargetType(finalizedParameterCarriers, bodyCarrier);
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
    parameterForms: options?.preserveSourceParameterForms === true
      ? "source"
      : "required-only",
    byRefCopyParams,
    ...(leadingParameters.length === 0 ? {} : { leadingParameters }),
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
  const valueDeclaration = callableExpressionValueDeclaration(expression, ast);
  let valid = true;
  const visit = (node: Node): void => {
    if (!valid) {
      return;
    }
    if (ast.kindName(node) === KindIdentifier) {
      const binding = walk.context.facts.get(node, rustSourceBindingFactKey) ??
        walk.context.facts.resolve(node, rustSourceBindingFactKey);
      const declaration = binding?.sourceDeclaration;
      if (declaration === expression || declaration === valueDeclaration) {
        recursiveDeclaration = declaration;
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
          const storage = rustCapturedBindingStorage(walk, declaration, node);
          if (storage === undefined) {
            valid = false;
            return;
          }
          if (storage === "location") {
            walk.context.facts.set(declaration, rustLocationStorageFactKey, {
              valueCarrier: carrier,
            }, [{ message: "rust captured mutable binding storage" }]);
          }
          captures.set(declaration, {
            declaration,
            reference: node,
            carrier,
            storage,
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

function rustCapturedBindingStorage(
  walk: RustFactWalk,
  declaration: Node,
  reference: Node,
): "value" | "location" | undefined {
  const cached = walk.capturedBindingStorage.get(declaration);
  if (cached !== undefined) {
    return cached;
  }
  const selected = walk.context.source.navigation.sourceReferenceFor(reference);
  const sourceFile = walk.context.ast.getSourceFile(declaration);
  if (selected?.declaration !== declaration || sourceFile === undefined) {
    return undefined;
  }
  const mutated = walk.context.facts.get(declaration, rustMutatedBindingFactKey) !== undefined ||
    walk.context.source.navigation.bindingWritesWithin(selected.symbol, sourceFile).length > 0;
  const storage = mutated ? "location" : "value";
  walk.capturedBindingStorage.set(declaration, storage);
  return storage;
}

function callableExpressionValueDeclaration(
  expression: Node,
  ast: RustFactWalk["context"]["ast"],
): Node | undefined {
  let current = expression;
  let parent = ast.parent(current);
  while (parent !== undefined) {
    const kind = ast.kindName(parent);
    if (kind !== KindParenthesizedExpression && kind !== KindNonNullExpression &&
      kind !== KindSatisfiesExpression && kind !== "KindAsExpression" &&
      kind !== "KindTypeAssertionExpression") {
      break;
    }
    if (Node_Expression(ast, parent) !== current) {
      return undefined;
    }
    current = parent;
    parent = ast.parent(current);
  }
  return parent !== undefined && ast.kindName(parent) === KindVariableDeclaration &&
      Node_Initializer(ast, parent) === current
    ? parent
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
    const parent = ast.parent(current);
    if (parent === undefined) {
      return false;
    }
    const parentKind = ast.kindName(parent);
    if (parentKind === KindFunctionDeclaration || parentKind === KindFunctionExpression ||
      parentKind === "KindArrowFunction" || parentKind === "KindMethodDeclaration" ||
      parentKind === "KindConstructor") {
      return false;
    }
    if (parentKind === "KindSourceFile") {
      if (current === declaration) {
        const declarationKind = ast.kindName(declaration);
        return declarationKind === KindFunctionDeclaration ||
          declarationKind === "KindClassDeclaration" ||
          declarationKind === "KindEnumDeclaration" ||
          declarationKind === KindExportAssignment;
      }
      const declarationKind = ast.kindName(declaration);
      return ast.kindName(current) === KindVariableStatement &&
        (declarationKind === KindVariableDeclaration || declarationKind === KindBindingElement);
    }
    current = parent;
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
