import { Node_Expression, Node_Type, sourceDeclarationIsModuleScoped, sourceEnclosingCallable } from "@tsonic/target-api/source";
import type { Node } from "@tsonic/tsts";
import { rustCallableValueConversionMatches } from "../../target-model/conversions/callable.js";
import { rustNativeRepresentationMatches } from "../../target-model/conversions/native-representation.js";
import { isClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { rustAwaitSelection, rustAwaitSelectionLeaves, type RustAwaitSelection } from "../../target-model/types/await.js";
import { rustUnparenthesizedExpression } from "../../target-model/syntax/expressions.js";
import { isRustTargetTypeRef } from "../../target-model/types/equality.js";
import {
  isRustNeverCarrier,
  rustFutureOutputCarrier,
  rustJsPromiseOutputTargetType,
  rustJsPromiseTargetId,
  rustJsPromiseTargetType,
  rustOptionElementCarrier,
} from "../../target-model/types/index.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { selectRustSourceValueConversion } from "../../policy/conversions/selection.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution/index.js";

import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import type { RustFactWalk } from "../program/walk.js";
import { selectRustInferredReturn } from "./inferred-return.js";
import { resolveRustSuspendedCallableStorage } from "./suspension-storage.js";
import { rustRetainedEnvironment } from "../../policy/ownership/retained-environments.js";
import type {
  RustAsyncFunctionFact, RustJsPromiseLowering, RustSettledPromiseAwait,
} from "../../target-model/records/callables-and-resources.js";
import type { RustRetainedEnvironment } from "../../target-model/records/retained-environments.js";
import { rustNativeAsyncFunctionFact, rustPromiseAsyncFunctionFact } from "../program/records/async-function.js";

export type RustAsyncBodyPromiseSelection =
  | {
      readonly kind: "selected";
      readonly outputCarrier: TargetTypeRef;
      readonly contextualPromise?: TargetTypeRef;
    }
  | { readonly kind: "rejected"; readonly reason: string };

export function selectRustAsyncBodyPromise(
  sourcePromise: TargetTypeRef,
  inferredOutput: TargetTypeRef | undefined,
  contextualResult: TargetTypeRef | undefined,
  definitions: RustTypeDefinitions,
): RustAsyncBodyPromiseSelection {
  if (!isClosedMetadata(sourcePromise) || !isRustTargetTypeRef(sourcePromise) ||
    rustJsPromiseOutputTargetType(sourcePromise) === undefined ||
    inferredOutput === undefined || !isClosedMetadata(inferredOutput) || !isRustTargetTypeRef(inferredOutput)) {
    return { kind: "rejected", reason: "An authored async body requires an exact JS promise output." };
  }
  const inferred: RustAsyncBodyPromiseSelection = Object.freeze({ kind: "selected", outputCarrier: inferredOutput });
  if (contextualResult === undefined) return inferred;
  const awaited = rustAwaitSelection(contextualResult, definitions);
  if (awaited === undefined) {
    return { kind: "rejected", reason: "The contextual async result has no bounded, closed native promise alternatives." };
  }
  const promises = rustAwaitSelectionLeaves(awaited).flatMap(leaf =>
    leaf.future?.futureCarrier.kind === "target-named" && leaf.future.futureCarrier.id === rustJsPromiseTargetId
      ? [leaf.future.futureCarrier] : []);
  if (promises.length === 0) return inferred;
  const admitted = promises.flatMap(contextualPromise => {
    const output = rustJsPromiseOutputTargetType(contextualPromise);
    if (output === undefined) return [];
    if (rustNativeRepresentationMatches(inferredOutput, output) ||
      rustCallableValueConversionMatches({ kind: "absence" }, inferredOutput, output, definitions)) {
      return [{ outputCarrier: output, contextualPromise }];
    }
    const conversion = selectRustSourceValueConversion(inferredOutput, output, definitions);
    return conversion !== undefined && rustCallableValueConversionMatches(
      { kind: "value", conversion }, inferredOutput, output, definitions)
      ? [{ outputCarrier: output, contextualPromise }] : [];
  });
  if (admitted.length !== 1) {
    return { kind: "rejected", reason: "An authored async body requires one unambiguous contextual JS promise alternative admitting its output." };
  }
  return Object.freeze({ kind: "selected", ...admitted[0]! });
}

export function selectRustAsyncBodyFacts(
  walk: RustFactWalk,
  declaration: Node,
  futureCarrier: TargetTypeRef | undefined,
  ownedReceiver?: TargetTypeRef,
  contextualResult?: TargetTypeRef,
): { readonly fact: RustAsyncFunctionFact; readonly retainedEnvironment?: RustRetainedEnvironment } | undefined {
  walk.context.records.assertOpen();
  const { ast } = walk.context;
  const inference = selectRustInferredReturn(walk, declaration, rustFutureOutputCarrier(futureCarrier));
  if (inference.kind === "pending") return undefined;
  const inferred = inference.carrier;
  const contextualLiteral = Node_Type(ast, declaration) === undefined &&
    (ast.is.IsArrowFunction(declaration) || ast.is.IsFunctionExpression(declaration));
  const isJsPromise = futureCarrier?.kind === "target-named" && futureCarrier.id === rustJsPromiseTargetId;
  const closedContext = contextualResult?.kind === "opaque" && contextualResult.id === "tsonic.rust.infer"
    ? undefined : contextualResult;
  const sourceContext = contextualLiteral && closedContext === undefined && (isJsPromise || isRustNeverCarrier(inferred))
    ? walk.context.semanticsFor(declaration).types.contextualType(declaration) : undefined;
  const callableContext = sourceContext === undefined ? undefined
    : walk.context.semanticsFor(declaration).types.callable(sourceContext);
  const selectedContext = contextualLiteral
    ? closedContext ?? (callableContext === undefined ? undefined : resolveRustTargetTypeRef(
      callableContext.result.selectedType, rustResolutionContext(walk, declaration), walk.operationOptions))
    : undefined;
  if (!isJsPromise) {
    const inner = !isRustNeverCarrier(inferred) || selectedContext === undefined ? inferred
      : rustFutureOutputCarrier(rustOptionElementCarrier(selectedContext) ?? selectedContext);
    return inner === undefined ? undefined : { fact: rustNativeAsyncFunctionFact(inner) };
  }
  const selected = selectRustAsyncBodyPromise(futureCarrier, inferred, selectedContext, walk.context.typeDefinitions);
  if (selected.kind === "rejected") {
    appendRustDiagnostic(walk, "RUST_ASYNC_CONTEXTUAL_PROMISE_NOT_CLOSED", selected.reason,
      declaration, ["target.capability=rust.async.contextual-promise-output"]);
    return;
  }
  const closedFutureCarrier = rustJsPromiseTargetType(selected.outputCarrier);
  const lowering = selectRustAsyncBodyLowering(walk, declaration);
  if (lowering.kind === "pending") return undefined;
  if (lowering.kind === "settled") {
    const environment = rustRetainedEnvironment(declaration, ast.parameters(declaration).map(parameter =>
      parameter === undefined ? undefined : walk.context.records.sourceParameterAbi.get(parameter)?.parameterCarrier), walk.context);
    if (environment.kind === "unresolved") {
      appendRustDiagnostic(walk, "RUST_ASYNC_PROMISE_STORAGE_LIFETIME_NOT_PROVEN", environment.reason,
        declaration, ["target.capability=rust.async.js-promise-storage-lifetime"]);
      return;
    }
    return { fact: rustPromiseAsyncFunctionFact(closedFutureCarrier, selected.outputCarrier, lowering),
      ...(environment.kind === "selected" ? { retainedEnvironment: environment.environment } : {}),
    };
  }
  const storage = resolveRustSuspendedCallableStorage(walk, declaration, [selected.outputCarrier], ownedReceiver);
  if (storage.kind === "rejected") {
    appendRustDiagnostic(walk, "RUST_ASYNC_PROMISE_STORAGE_LIFETIME_NOT_PROVEN",
      storage.reason,
      declaration, ["target.capability=rust.async.js-promise-storage-lifetime"]);
    return;
  }
  return { fact: rustPromiseAsyncFunctionFact(closedFutureCarrier, selected.outputCarrier, { kind: "factory",
    storage: storage.storage,
    capturedParameters: storage.capturedParameters,
    capturedCarriers: storage.capturedCarriers,
    ...(storage.ownedReceiver === undefined ? {} : { ownedReceiver: storage.ownedReceiver }),
  }), ...(storage.retainedEnvironment === undefined ? {} : { retainedEnvironment: storage.retainedEnvironment }) };
}

export type RustAsyncBodyLowering =
  | Extract<RustJsPromiseLowering, { readonly kind: "settled" }>
  | { readonly kind: "pending" }
  | { readonly kind: "suspending" };

const suspendingLowering: RustAsyncBodyLowering = Object.freeze({ kind: "suspending" });
const pendingLowering: RustAsyncBodyLowering = Object.freeze({ kind: "pending" });

export function selectRustAsyncBodyLowering(walk: RustFactWalk, declaration: Node): RustAsyncBodyLowering {
  const states = new Map<Node, "active" | RustAsyncBodyLowering>();
  const select = (target: Node): RustAsyncBodyLowering => {
    const previous = states.get(target);
    if (previous === "active") return suspendingLowering;
    if (previous !== undefined) return previous;
    const finalized = walk.context.records.asyncFunction.get(target);
    if (finalized?.kind === "js-promise") return finalized.lowering.kind === "settled"
      ? finalized.lowering : suspendingLowering;
    states.set(target, "active");
    const selected = selectBodyLowering(walk, target, select);
    states.set(target, selected);
    return selected;
  };
  return select(declaration);
}

function selectBodyLowering(
  walk: RustFactWalk, declaration: Node, select: (target: Node) => RustAsyncBodyLowering,
): RustAsyncBodyLowering {
  const { ast } = walk.context;
  const body = ast.body(declaration);
  if (body === undefined) return suspendingLowering;
  if (!ast.is.IsBlock(body)) {
    const state = expressionSuspension(walk, body);
    if (state === "pending") return pendingLowering;
    if (state === "suspending") return suspendingLowering;
  }
  const settledAwaits: RustSettledPromiseAwait[] = [];
  let suspends = false;
  let pending = false;
  const visit = (node: Node): void => {
    if (suspends || node !== body && sourceEnclosingCallable(node, ast) === node) return;
    if (ast.is.IsForOfStatement(node) && ast.as.AsForInOrOfStatement(node)?.AwaitModifier !== undefined ||
      ast.is.IsVariableDeclaration(node) && ast.variableDeclarationKind(node) === "await using") {
      suspends = true;
      return;
    }
    if (ast.is.IsReturnStatement(node)) {
      const returned = Node_Expression(ast, node);
      if (returned !== undefined) {
        const state = expressionSuspension(walk, returned);
        if (state === "pending") pending = true;
        if (state === "suspending") {
          suspends = true;
          return;
        }
      }
    }
    if (ast.is.IsAwaitExpression(node)) {
      const operand = Node_Expression(ast, node);
      const outcome = operand === undefined ? undefined : awaitOutcome(walk, operand, select);
      if (outcome === "pending") {
        pending = true;
        return;
      }
      if (outcome === undefined) {
        suspends = true;
        return;
      }
      if (outcome !== "ready") settledAwaits.push(Object.freeze({ expression: node, callee: outcome }));
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(body);
  return suspends ? suspendingLowering : pending ? pendingLowering
    : Object.freeze({ kind: "settled", settledAwaits: Object.freeze(settledAwaits) });
}

function awaitOutcome(
  walk: RustFactWalk, operand: Node, select: (target: Node) => RustAsyncBodyLowering,
): "ready" | "pending" | Node | undefined {
  const selection = expressionAwaitSelection(walk, operand);
  if (selection === undefined) return "pending";
  if (rustAwaitSelectionLeaves(selection).every(leaf => leaf.future === undefined)) return "ready";
  const promise = selection.kind === "leaf" ? selection.value.future?.futureCarrier : undefined;
  if (promise?.kind !== "target-named" || promise.id !== rustJsPromiseTargetId) return undefined;
  const callee = directAsyncCallee(walk, operand);
  if (callee === undefined) return undefined;
  const selected = select(callee);
  return selected.kind === "pending" ? "pending" : selected.kind === "settled" ? callee : undefined;
}

function directAsyncCallee(walk: RustFactWalk, operand: Node): Node | undefined {
  const { ast } = walk.context;
  const call = rustUnparenthesizedExpression(ast, operand);
  if (!ast.is.IsCallExpression(call) || ast.as.AsCallExpression(call)?.QuestionDotToken !== undefined) return undefined;
  const expression = Node_Expression(ast, call);
  const callee = expression === undefined ? undefined : rustUnparenthesizedExpression(ast, expression);
  if (callee === undefined) return undefined;
  const semantics = walk.context.semanticsFor(call);
  const resolved = semantics.operations.call(call);
  const signature = resolved === undefined ? undefined : semantics.declarations.signatureDeclaration(resolved.selectedSignature);
  const implementation = signature === undefined ? undefined : walk.context.source.navigation.callableImplementation(signature);
  const target = implementation?.kind === "resolved" ? implementation.implementation.declaration : undefined;
  if (target === undefined || ast.body(target) === undefined || !ast.hasModifierKind(target, "async") ||
    !walk.context.source.navigation.isProjectDeclaration(target) ||
    walk.context.source.navigation.declarationUseSummary(target).bindingWritten) return undefined;
  if (ast.is.IsFunctionDeclaration(target)) return ast.is.IsIdentifier(callee) &&
    sourceDeclarationIsModuleScoped(target, ast) ? target : undefined;
  if (!ast.is.IsMethodDeclaration(target) || !ast.is.IsPropertyAccessExpression(callee)) return undefined;
  if (walk.context.projectMethodProperties.usageFor(target)?.writable === true) return undefined;
  const owner = walk.context.projectTypes.definitionContainingDeclaration(target);
  return owner !== undefined && !walk.context.projectTypes.isPolymorphic(owner) ? target : undefined;
}

function expressionSuspension(walk: RustFactWalk, expression: Node): "ready" | "suspending" | "pending" {
  const selection = expressionAwaitSelection(walk, expression);
  return selection === undefined ? "pending" : rustAwaitSelectionLeaves(selection).some(leaf => leaf.future !== undefined)
    ? "suspending" : "ready";
}

function expressionAwaitSelection(walk: RustFactWalk, expression: Node): RustAwaitSelection | undefined {
  const type = walk.context.semanticsFor(expression).types.expressionType(expression);
  const carrier = type === undefined ? undefined
    : resolveRustTargetTypeRef(type, rustResolutionContext(walk, expression), walk.operationOptions);
  return carrier === undefined ? undefined : rustAwaitSelection(carrier, walk.context.typeDefinitions);
}
