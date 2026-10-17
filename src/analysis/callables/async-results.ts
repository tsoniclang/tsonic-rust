import { Node_Expression, Node_Type, sourceEnclosingCallable } from "@tsonic/target-api/source";
import { createTargetGraphComponentQuery, createSourceStorageBudget, defaultSourceStorageLimits } from "@tsonic/target-api/analysis";
import type { Node } from "@tsonic/tsts";
import { rustCallableValueConversionMatches } from "../../target-model/conversions/callable.js";
import { rustNativeRepresentationMatches } from "../../target-model/conversions/native-representation.js";
import { isClosedMetadata } from "../../target-model/metadata/closed-data.js";
import { rustAwaitSelection, rustAwaitSelectionLeaves, type RustAwaitSelection } from "../../target-model/types/await.js";
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
import { rustDirectPromiseBodyCallee } from "./promise-bodies.js";

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
const completionQueries = new WeakMap<RustFactWalk["context"], (declaration: Node) => RustAsyncBodyLowering>();

export function selectRustAsyncBodyLowering(walk: RustFactWalk, declaration: Node): RustAsyncBodyLowering {
  if (!walk.context.promiseBodies.namesReady) return pendingLowering;
  let select = completionQueries.get(walk.context);
  if (select === undefined) {
    const budget = createSourceStorageBudget(defaultSourceStorageLimits);
    const query = createTargetGraphComponentQuery<Node, RustAsyncCompletionInput,
      { readonly kind: "settled" | "suspending"; readonly awaits: ReadonlyMap<Node, readonly RustSettledPromiseAwait[]> }>(
      target => loadRustAsyncCompletion(walk, target, budget.step),
      members => {
        let suspends = false;
        const awaits = new Map<Node, readonly RustSettledPromiseAwait[]>();
        for (const member of members) {
          if (!budget.step()) return undefined;
          suspends ||= member.data.suspends;
          awaits.set(member.vertex, member.data.settledAwaits);
          for (const successor of member.successors) {
            if (!budget.step()) return undefined;
            suspends ||= successor.kind === "suspending";
          }
        }
        return Object.freeze({ kind: suspends ? "suspending" : "settled", awaits });
      }, budget);
    select = target => {
      const selected = query(target);
      return selected === undefined ? pendingLowering : selected.kind === "suspending" ? suspendingLowering
        : Object.freeze({ kind: "settled", settledAwaits: selected.awaits.get(target)! });
    };
    completionQueries.set(walk.context, select);
  }
  return select(declaration);
}

interface RustAsyncCompletionInput {
  readonly suspends: boolean;
  readonly settledAwaits: readonly RustSettledPromiseAwait[];
}

function loadRustAsyncCompletion(
  walk: RustFactWalk, declaration: Node, step: () => boolean,
): { readonly data: RustAsyncCompletionInput; readonly neighbours: ReadonlySet<Node> } | undefined {
  const { ast } = walk.context;
  const body = ast.body(declaration);
  const neighbours = new Set<Node>();
  if (body === undefined) return { data: { suspends: true, settledAwaits: [] }, neighbours };
  if (!ast.is.IsBlock(body)) {
    const state = expressionSuspension(walk, body);
    if (state === "pending") return undefined;
    if (state === "suspending") return { data: { suspends: true, settledAwaits: [] }, neighbours };
  }
  const settledAwaits: RustSettledPromiseAwait[] = [];
  let suspends = false;
  let pending = false;
  const visit = (node: Node): void => {
    if (suspends || node !== body && sourceEnclosingCallable(node, ast) === node) return;
    if (!step()) { pending = true; return; }
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
      const selection = operand === undefined ? undefined : expressionAwaitSelection(walk, operand);
      if (selection === undefined) {
        pending = true;
        return;
      }
      if (rustAwaitSelectionLeaves(selection).some(leaf => leaf.future !== undefined)) {
        const promise = selection.kind === "leaf" ? selection.value.future?.futureCarrier : undefined;
        const callee = promise?.kind === "target-named" && promise.id === rustJsPromiseTargetId && operand !== undefined
          ? rustDirectPromiseBodyCallee(walk.context, operand, promise) : undefined;
        if (callee === undefined) {
          suspends = true;
          return;
        }
        neighbours.add(callee);
        settledAwaits.push(Object.freeze({ expression: node, callee }));
      }
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  visit(body);
  return pending && !suspends ? undefined
    : { data: Object.freeze({ suspends, settledAwaits: Object.freeze(settledAwaits) }), neighbours };
}

function expressionSuspension(walk: RustFactWalk, expression: Node): "ready" | "suspending" | "pending" {
  const carrier = expressionCarrier(walk, expression);
  if (carrier?.kind === "type-parameter") return "ready";
  const selection = rustAwaitSelection(carrier, walk.context.typeDefinitions);
  return selection === undefined ? "pending" : rustAwaitSelectionLeaves(selection).some(leaf => leaf.future !== undefined)
    ? "suspending" : "ready";
}

function expressionAwaitSelection(walk: RustFactWalk, expression: Node): RustAwaitSelection | undefined {
  return rustAwaitSelection(expressionCarrier(walk, expression), walk.context.typeDefinitions);
}

function expressionCarrier(walk: RustFactWalk, expression: Node): TargetTypeRef | undefined {
  const type = walk.context.semanticsFor(expression).types.expressionType(expression);
  return type === undefined ? undefined
    : resolveRustTargetTypeRef(type, rustResolutionContext(walk, expression), walk.operationOptions);
}
