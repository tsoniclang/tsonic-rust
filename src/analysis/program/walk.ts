import type { RustOperationAnalysisContext } from "./operation-context.js";
import { requireRustRecord } from "./records/required-records.js";
import { rustPostCheckOperationKind } from "../../target-model/operations/model.js";
import { rustSourceStorageScope, rustSourceStorageSubjectContext } from "../source-evidence/types/resolution/source-storage-projection.js";
import { BinaryExpression_Left, BinaryExpression_Right, Node_Operand, KindBinaryExpression, KindCallExpression, KindDeleteExpression, KindElementAccessExpression, KindIdentifier, KindNewExpression, KindPostfixUnaryExpression, KindPrefixUnaryExpression, KindPropertyAccessExpression, Node_Expression, Node_Type, ForInOrOfStatement_Initializer, VariableDeclarationList_Declarations, selectSourceNativeValueGuard } from "@tsonic/target-api/source";
import { selectRustCheckedCall, selectRustCheckedConversion, selectRustCheckedElementAccess, selectRustCheckedOperator, selectRustCheckedPropertyAccess, selectRustCheckedValue } from "../operations/members/index.js";
import { selectRustCheckedDelete } from "../operations/member-access.js";
import { isSharedSourceMarkerOperation } from "../operations/source-markers.js";
import { resolveRegExpCreation } from "../operations/syntax/regexp.js";

import { rustPolicyTargetDiagnostic } from "./policy-diagnostics.js";
import { rustSourcePrimitiveTargetType } from "../../target-model/types/index.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import { checkedPropertySelectionInput } from "../operations/member-access.js";
import type { RustAnalysisContext } from "./context.js";
import type { RustModuleBindingAnalysis } from "./module-bindings.js";

import type { RustOperationsProviderOptions } from "../operations/members/index.js";
import type { RustPreparedDeferredCheckedCall } from "../../target-model/records/deferred-callbacks.js";
import type { RustProviderOperationRow } from "../../target-model/identities/provider-relations.js";
import type { RustSourceCallableAbiResolver } from "../callables/source-callable-abi.js";
import type { RustSourceProfileRegistry } from "../../policy/types/model/source-profile.js";
import type { RustSourceTypeRegistry } from "../project-types/source-type-model.js";
import type { RustTargetTypeResolutionContext } from "../source-evidence/types/resolution/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustSelectedTargetOperation } from "../../target-model/records/member-selections.js";
import type { RustCaptureStorage } from "../../target-model/records/capture-storage.js";
import { recordRustLogicalValueFact } from "../operations/logical-values.js";
import type { RustTargetOperationFact } from "../../target-model/records/operations.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { recordRustConversionSelection } from "./records/value-carrier-admission.js";
import type { RustOperationAttempt } from "./operation-attempts.js";
import type { RustCallableSignatureState } from "../callables/signature-query.js";
import type { RustInferredReturnMemo } from "../callables/inferred-return.js";
import type { RustModuleCycleAnalysis } from "../module-initialization/cycles.js";

export const rustTargetSemanticsExtensionId = "tsonic.rust.policy";

export interface RustFactWalk {
  readonly moduleCycles: RustModuleCycleAnalysis;
  readonly context: RustAnalysisContext;
  readonly providerRows: readonly RustProviderOperationRow[];
  readonly providerErrorCarriers: readonly TargetTypeRef[];
  readonly resolving: Set<Node>;
  readonly rejectedExpressions: WeakSet<Node>;
  readonly jsEnabled: boolean;
  readonly sourceProfiles: RustSourceProfileRegistry;
  readonly sourceTypes: RustSourceTypeRegistry;
  readonly sourceCallableAbi: RustSourceCallableAbiResolver;
  readonly operationOptions: RustOperationsProviderOptions;
  readonly operationAttempts: WeakMap<Node, RustOperationAttempt>;
  readonly inferredReturns: RustInferredReturnMemo;
  readonly resolvingReturns: Set<Node>;
  readonly callableSignatures: WeakMap<Node, RustCallableSignatureState>;
  readonly finalizedParameters: WeakSet<Node>;
  readonly callableSignatureCarrierFor: (walk: RustFactWalk, declaration: Node) => TargetTypeRef | undefined;
  readonly postCheckOperations: WeakMap<object, "binary" | "unary-minus" | "unary-plus">;
  readonly deferredCallbackCalls: WeakMap<Node, {
    readonly request: import("../../policy/model/contracts.js").RustCheckedCallSelectionInput;
    readonly selection: Extract<
      import("../../policy/model/contracts.js").RustCheckedCallSelectionResult,
      { readonly kind: "deferred-callback" }
    >;
  }>;
  readonly preparedCallbackCalls: Map<Node, {
    readonly request: import("../../policy/model/contracts.js").RustCheckedCallSelectionInput;
    readonly prepared: RustPreparedDeferredCheckedCall;
  }>;
  readonly capturedBindingStorage: Map<Node, { readonly carrier: TargetTypeRef; readonly selection: RustCaptureStorage }>;
  readonly promotedStorageDeclarations: ReadonlySet<Node>;
  readonly objectLiteralMethodExpressions: Set<Node>;
  readonly objectLiteralMethodSpreadExpressions: Set<Node>;
  readonly moduleBindings: RustModuleBindingAnalysis;
  currentThisCarrier?: TargetTypeRef;
  currentSuperCarrier?: TargetTypeRef;
  currentMethodDeclaration?: Node;
  currentCallableDeclaration?: Node;
  currentGeneratorDeclaration?: Node;
}

export const boolCarrier = rustSourcePrimitiveTargetType("bool");

function rustScopedContext(walk: RustFactWalk, node: Node) {
  const semantics = walk.context.semanticsFor(node);
  return { ...walk.context, currentSourceFile: semantics.sourceFile, currentSemantics: semantics,
    sourceStorageResolution: rustSourceStorageScope(walk.context, node, walk.currentCallableDeclaration) };
}

export function rustResolutionContext(
  walk: RustFactWalk,
  node: Node,
  kind?: import("@tsonic/target-api/analysis").SourceStorageSubject["kind"],
): RustTargetTypeResolutionContext {
  const selection = kind === undefined ? walk.context.sourceStorage.storageSubjectFor(node)
    : walk.context.sourceStorage.subject(node, kind);
  return rustSourceStorageSubjectContext(rustScopedContext(walk, node), selection);
}

export function appendRustDiagnostic(
  walk: RustFactWalk,
  code: string,
  message: string,
  node: Node | undefined,
  evidence: readonly string[],
): void {
  recordTerminalExpressionFailure(walk, node);
  walk.context.diagnostics.push({
    code,
    category: "error",
    source: "tsonic-rust",
    message,
    ...(node === undefined ? {} : { sourceNode: node }),
    evidence,
  });
}

function recordTerminalExpressionFailure(walk: RustFactWalk, node: Node | undefined): void {
  if (node !== undefined) walk.rejectedExpressions.add(node);
  for (const dependent of walk.resolving) walk.rejectedExpressions.add(dependent);
}

export function rustOperationContext(
  walk: RustFactWalk,
  node: Node,
): RustOperationAnalysisContext {
  return {
    ...rustScopedContext(walk, node),
    extensionId: rustTargetSemanticsExtensionId,
    operationAttempts: walk.operationAttempts,
  };
}

export function recordPolicySelection<T extends { readonly operation?: RustSelectedTargetOperation;
  readonly targetFact?: RustTargetOperationFact }>(
  walk: RustFactWalk,
  subject: Node,
  selection: import("../../policy/model/contracts.js").RustPolicySelection<T>,
): void {
  walk.context.records.assertOpen();
  if (selection.kind === "reject") {
    recordPolicyRejection(walk, selection);
    return;
  }
  const fact = selection.value.targetFact;
  if (fact !== undefined) requireRustRecord(walk.context.requiredRecords, "targetOperation", subject,
    fact.kind, "recordPolicySelection");
  const operation = selection.value.operation;
  if (operation !== undefined && rustPostCheckOperationKind(operation.operationId) === undefined) {
    requireRustRecord(walk.context.requiredRecords, "selectedOperation", subject,
      operation.operationKind, "recordPolicySelection");
  }
  if (fact?.kind === "iteration") {
    const initializer = ForInOrOfStatement_Initializer(walk.context.ast, subject);
    if (initializer !== undefined) {
      requireRustRecord(walk.context.requiredRecords, "runtimeCarrier", initializer, "iteration initializer", "recordPolicySelection");
      walk.context.records.runtimeCarriers.selected(initializer, fact.elementCarrier);
      const declarations = VariableDeclarationList_Declarations(walk.context.ast, initializer);
      if (declarations !== undefined && isDenseDataArray(declarations)) {
        for (const declaration of declarations) {
          if (declaration !== undefined && walk.context.ast.kindName(declaration) === "KindVariableDeclaration") {
            requireRustRecord(walk.context.requiredRecords, "runtimeCarrier", declaration, "iteration declaration", "recordPolicySelection");
            walk.context.records.runtimeCarriers.selected(declaration, fact.elementCarrier);
          }
        }
      }
    }
  }
  walk.context.records.targetOperations.checked(subject, selection);
  const deferredKind = walk.context.records.selectedOperations.checked(subject, selection);
  if (deferredKind !== undefined) {
    walk.postCheckOperations.set(subject, deferredKind);
  }
}

function recordPolicyRejection(walk: RustFactWalk,
  selection: import("../../policy/model/contracts.js").RustPolicySelection<unknown>): void {
  if (selection.kind !== "reject") return;
  const diagnostic = rustPolicyTargetDiagnostic(selection.diagnostic);
  if (diagnostic.category === "error") recordTerminalExpressionFailure(walk, diagnostic.sourceNode);
  walk.context.diagnostics.push(diagnostic);
}

export function selectExpressionOperation(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
): void {
  walk.context.records.assertOpen();
  if (walk.operationAttempts.has(expression)) {
    return;
  }
  walk.operationAttempts.set(expression, { kind: "attempted" });
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
    const source = semantics.operations.call(expression);
    if (source === undefined) {
      return;
    }
    const sourceSelectedDeclaration = semantics.declarations.signatureDeclaration(source.selectedSignature);
    const request: import("../../policy/model/contracts.js").RustCheckedCallSelectionInput = {
      target: "rust",
      source,
      ...(sourceSelectedDeclaration === undefined ? {} : { sourceSelectedDeclaration }),
    };
    const selection = selectRustCheckedCall(request, context, walk.operationOptions);
    if (selection.kind === "reject") {
      recordPolicyRejection(walk, selection);
    } else if (selection.value.kind === "deferred-callback") {
      walk.deferredCallbackCalls.set(expression, {
        request,
        selection: selection.value,
      });
    }
    return;
  }
  if (kind === KindPropertyAccessExpression) {
    const source = semantics.operations.propertyAccess(expression);
    if (source === undefined || source.callCallee && !hasSelectedRuntimeCallableUse(walk, expression)) {
      return;
    }
    recordPolicyRejection(walk, selectRustCheckedPropertyAccess(
      checkedPropertySelectionInput(context, expression, source),
      context,
      walk.operationOptions,
    ));
    return;
  }
  if (kind === KindElementAccessExpression) {
    const source = semantics.operations.elementAccess(expression);
    if (source === undefined || source.callCallee && !hasSelectedRuntimeCallableUse(walk, expression)) {
      return;
    }
    const receiverReference = walk.context.source.navigation.sourceReferenceFor(
      source.receiver.expression,
    );
    recordPolicyRejection(walk, selectRustCheckedElementAccess({
      target: "rust",
      expression,
      receiver: source.receiver.expression,
      sourceReceiverType: source.receiver.type,
      ...(source.receiver.intrinsic === undefined ? {} : { sourceReceiverIntrinsic: source.receiver.intrinsic }),
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
      : semantics.operations.elementAccess(operand);
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
    const target = semantics.types.authoredType(explicitTargetTypeNode);
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
            ...(sourceReference.symbol === undefined
              ? {}
              : { sourceSelectedSymbol: sourceReference.symbol }),
            sourceSelectedDeclaration: sourceReference.declaration,
          }),
    }, context, walk.operationOptions);
    recordPolicySelection(walk, expression, selection);
    if (selection.kind === "accept" && selection.value.convertedType !== undefined) {
      recordRustConversionSelection(walk.context.records, walk.context.requiredRecords, expression, selection.value.convertedType);
    }
    return;
  }
  if (kind !== KindBinaryExpression && kind !== KindPrefixUnaryExpression && kind !== KindPostfixUnaryExpression) {
    return;
  }
  if (kind === KindBinaryExpression && recordRustLogicalValueFact(walk, expression)) return;
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
  const nativeGuard = operator === "instanceof" ? selectSourceNativeValueGuard({ ast,
    navigation: walk.context.source.navigation, semanticsFor: walk.context.semanticsFor }, expression) : undefined;
  const sourceRightDeclaration = operator === "instanceof"
    ? nativeGuard?.kind === "nominal" ? nativeGuard.declaration : undefined
    : right === undefined ? undefined : walk.context.source.navigation.sourceReferenceFor(right)?.declaration;
  recordPolicySelection(walk, expression, selectRustCheckedOperator({
    target: "rust",
    expression,
    operator,
    ...(left === undefined ? {} : { left }),
    ...(right === undefined ? {} : { right }),
    ...(sourceRightDeclaration === undefined
      ? {}
      : { sourceRightDeclaration }),
  }, context, walk.operationOptions));
}

export function hasSelectedRuntimeCallableUse(walk: RustFactWalk, node: Node): boolean {
  const { ast } = walk.context;
  let callee = node;
  let parent = ast.parent(callee);
  while (parent !== undefined && ast.kindName(parent) === "KindParenthesizedExpression" &&
    Node_Expression(ast, parent) === callee) {
    callee = parent;
    parent = ast.parent(callee);
  }
  if (parent === undefined || ![KindCallExpression, KindNewExpression].includes(ast.kindName(parent)) ||
    Node_Expression(ast, parent) !== callee) return false;
  const selected = walk.context.records.selectedCall.get(parent);
  if (ast.kindName(parent) === KindNewExpression) return selected?.sourceConstructorCarrier !== undefined;
  return selected?.sourceCallableCarrier !== undefined &&
    selected.sourceStructuralMethod === undefined;
}

function rustOperatorText(kind: string | undefined): string | undefined {
  const operators: Readonly<Record<string, string>> = {
    KindCommaToken: ",",
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
    KindEqualsEqualsToken: "==",
    KindExclamationEqualsToken: "!=",
    KindAmpersandAmpersandToken: "&&",
    KindBarBarToken: "||",
    KindQuestionQuestionToken: "??",
    KindQuestionQuestionEqualsToken: "??=",
    KindPlusEqualsToken: "+=",
    KindMinusEqualsToken: "-=",
    KindAsteriskEqualsToken: "*=",
    KindSlashEqualsToken: "/=",
    KindPercentEqualsToken: "%=",
    KindLessThanLessThanEqualsToken: "<<=",
    KindGreaterThanGreaterThanEqualsToken: ">>=",
    KindGreaterThanGreaterThanGreaterThanEqualsToken: ">>>=",
    KindAmpersandEqualsToken: "&=",
    KindBarEqualsToken: "|=",
    KindCaretEqualsToken: "^=",
    KindExclamationToken: "!",
    KindTildeToken: "~",
    KindPlusPlusToken: "++",
    KindMinusMinusToken: "--",
    KindInstanceOfKeyword: "instanceof",
    KindInKeyword: "in",
  };
  return kind === undefined ? undefined : operators[kind];
}
