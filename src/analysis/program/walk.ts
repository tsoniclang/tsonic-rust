import {
  BinaryExpression_Left,
  BinaryExpression_Right,
  Node_Operand,
  KindBinaryExpression,
  KindCallExpression,
  KindDeleteExpression,
  KindElementAccessExpression,
  KindIdentifier,
  KindNewExpression,
  KindPostfixUnaryExpression,
  KindPrefixUnaryExpression,
  KindPropertyAccessExpression,
  Node_Expression,
  Node_Type,
} from "@tsonic/target-api/source";
import {
  selectRustCheckedCall,
  selectRustCheckedConversion,
  selectRustCheckedDelete,
  selectRustCheckedElementAccess,
  selectRustCheckedOperator,
  selectRustCheckedPropertyAccess,
  selectRustCheckedValue,
} from "../operations/provider/index.js";
import { isSharedSourceMarkerOperation } from "../expressions/references.js";
import { resolveRegExpCreation } from "../expressions/regexp.js";
import { rustConversionKey, rustSelectedOperationKey } from "../../policy/model/selections.js";
import { rustPolicyTargetDiagnostic } from "../../policy/operations/contracts.js";
import { rustPostCheckOperationKind } from "../facts/keys.js";
import { rustSourcePrimitiveTargetType } from "../../policy/types/target-types.js";
import type { Node, ResolvedSourcePropertyAccessInfo, SourceFile } from "@tsonic/tsts";
import type { RustAnalysisContext } from "./context.js";
import type { RustModuleBindingPolicy } from "./module-bindings.js";
import type { RustOperationPolicyContext } from "../../policy/operations/contracts.js";
import type { RustOperationsProviderOptions, RustPreparedDeferredCheckedCall } from "../operations/provider/index.js";
import type { RustProviderOperationRow } from "../../providers/packages/model.js";
import type { RustSourceCallableAbiResolver } from "../../policy/ownership/source-callable-abi.js";
import type { RustSourceProfileRegistry } from "../../policy/types/source-profile.js";
import type { RustSourceTypeRegistry } from "../project-types/source-type-registry.js";
import type { RustTargetTypeResolutionContext } from "../../policy/types/resolution.js";
import type { TargetTypeRef } from "../../policy/types/model.js";

export const rustTargetSemanticsExtensionId = "tsonic.rust.policy";

export interface RustFactWalk {
  readonly context: RustAnalysisContext;
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

export const boolCarrier = rustSourcePrimitiveTargetType("bool");

export function rustResolutionContext(
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

export function appendRustDiagnostic(
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

export function rustOperationContext(
  walk: RustFactWalk,
  node: Node,
): RustOperationPolicyContext {
  return {
    ...rustResolutionContext(walk, node),
    facts: walk.context.facts,
    extensionId: rustTargetSemanticsExtensionId,
  };
}

export function recordPolicySelection<T extends { readonly operation?: unknown }>(
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
        (operation as import("../../policy/types/model.js").RustSelectedTargetOperation).operationId,
      );
  if (deferredKind !== undefined) {
    walk.postCheckOperations.set(subject, deferredKind);
    return;
  }
  if (operation !== undefined && walk.context.facts.getSelectedTargetOperator(subject) === undefined) {
    walk.context.facts.set(
      subject,
      rustSelectedOperationKey,
      operation as import("../../policy/types/model.js").RustSelectedTargetOperation,
    );
  }
}

export function selectExpressionOperation(
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

export function checkedPropertySelectionInput(
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
