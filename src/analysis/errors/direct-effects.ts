import type { Node } from "@tsonic/tsts";
import { KindCallExpression, KindNewExpression, KindVariableDeclaration, Node_Expression, asSourceNode,
  sourceEnclosingCallable } from "@tsonic/target-api/source";
import { appendRustDiagnostic, rustOperationContext, type RustFactWalk } from "../program/walk.js";
import type { RustEffectsWorkBudget } from "./effects-work-budget.js";
import { rustJsRejectionErrorIdentity, type RustErrorEffectsFact } from "../../target-model/records/error-effects.js";
import { rustLocalErrorEffects } from "./error-effects.js";
import type { RustSourceErrorEffectEdge } from "../../target-model/records/source-error-effects.js";
import type { RustSourceErrorEffectSelection } from "./source-error-effects.js";
import type { RustAwaitSourceErrorBranch } from "../../target-model/records/await-source-error-effects.js";
import type { RustGenericCallableInvocationFact } from "../../target-model/records/generic-callable-effects.js";
import { selectRustResourceManagement } from "../control-flow/resource-management.js";
import { rustGeneratorSourceInvocationKind } from "../../policy/operations/source-profiles/generator-source-profile.js";
import { getRustGeneratorProtocol } from "../../target-model/types/carriers/callables.js";
import { selectRustGeneratorSourceErrors } from "./generator-source-effects.js";
import { selectRustAwaitSourceErrors } from "./await-source-effects.js";
import { rustAwaitSelectionLeaves } from "../../target-model/types/await.js";
import { rustAwaitSelection } from "../../policy/operations/flow/await.js";
import { rustFutureValueForSourceStorage, rustFutureValuesForSourceStorage } from "../callables/future-values.js";
import { rustFutureValueForStoredBranch } from "../callables/future-storage.js";
import { rustJsValueTargetType } from "../../target-model/types/carriers/js.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustSourceCallCallableStorageCarrier } from "../../policy/operations/members/native-contracts.js";

interface RustDirectErrorEffectsInput {
  readonly walk: RustFactWalk;
  readonly budget: RustEffectsWorkBudget;
  readonly declarationEffects: (declaration: Node) => RustErrorEffectsFact;
  readonly operationIsFallible: (node: Node) => boolean;
  readonly preparedCallbackOperationIsFallible: (node: Node) => boolean;
  readonly isFallible: (declaration: Node) => boolean;
  readonly selectedAccessorDeclarations: (node: Node) => readonly Node[];
  readonly selectedProjectDeclaration: (node: Node) => Node | undefined;
  readonly genericInvocation: (node: Node) => RustGenericCallableInvocationFact | undefined;
  readonly mergeEffects: (effects: readonly RustErrorEffectsFact[]) => RustErrorEffectsFact | undefined;
  readonly sourceErrorEdges: Map<Node, RustSourceErrorEffectEdge[]>;
  readonly selectSourceErrors: RustSourceErrorEffectSelection;
  readonly awaitSourceEdges: Map<Node, readonly RustAwaitSourceErrorBranch[]>;
  readonly effectsByExpression: Map<Node, RustErrorEffectsFact>;
}

export function createRustDirectErrorEffects(
  input: RustDirectErrorEffectsInput,
): (node: Node) => RustErrorEffectsFact | undefined {
  const { walk, budget, declarationEffects, operationIsFallible, preparedCallbackOperationIsFallible, isFallible, selectedAccessorDeclarations,
    selectedProjectDeclaration, genericInvocation, mergeEffects, sourceErrorEdges, selectSourceErrors, awaitSourceEdges, effectsByExpression } = input;
  const { ast } = walk.context;
  return (node: Node): RustErrorEffectsFact | undefined => {
    budget.step();
    const kind = ast.kindName(node);
    const selected: RustErrorEffectsFact[] = [];
    const appendEdge = (invocation: Node, edge: RustSourceErrorEffectEdge): void => {
      budget.metadata(edge.effects);
      budget.metadata(edge.nativeErrors);
      const edges = sourceErrorEdges.get(invocation) ?? [];
      budget.step(edges.length + 1);
      const index = edges.findIndex(candidate => candidate.declaration === edge.declaration && candidate.kind === edge.kind);
      if (index < 0) edges.push(edge);
      else edges[index] = edge;
      sourceErrorEdges.set(invocation, edges);
      selected.push(edge.effects);
    };
    const appendDeclaration = (declaration: Node, invocation = node,
      kind: RustSourceErrorEffectEdge["kind"] = "invoke"): boolean => {
      const source = declarationEffects(declaration);
      let carrierWork = 0;
      for (const error of source.nativeErrors) {
        budget.metadata(error.identity);
        carrierWork += budget.metadata(error.errorType);
      }
      if (carrierWork !== 0) {
        const selectedSignature = walk.context.records.selectedCall.get(invocation);
        const selectedOperation = walk.context.records.targetOperation.get(invocation);
        budget.metadata(selectedSignature?.member.genericParameters);
        let replacementWork = 1;
        for (const argument of selectedOperation?.kind === "source-call" ? selectedOperation.targetGenericArguments ?? [] : []) {
          replacementWork = Math.max(replacementWork, budget.metadata(argument));
        }
        budget.expansion(carrierWork, replacementWork);
      }
      const bindings = source.nativeErrors.length === 0 ? undefined : selectSourceErrors.bindingsFor(
        invocation, declaration, source.nativeErrors.filter(error => !selectSourceErrors.substitutesOnCompletion(error.identity))
          .map(error => error.errorType));
      const edge = selectSourceErrors.edgeFor(declaration, kind, source, bindings);
      if (edge === undefined) {
        appendRustDiagnostic(walk, "RUST_NATIVE_ERROR_REBINDING_MISSING",
          "Selected source-call errors require exact native input and generic channel substitutions.", node,
          ["target.capability=rust.native-error.source-binding"]);
        return false;
      }
      appendEdge(invocation, edge);
      return true;
    };
    if (kind === "KindThrowStatement" || kind === "KindRegularExpressionLiteral" ||
      operationIsFallible(node) || preparedCallbackOperationIsFallible(node)) selected.push(rustLocalErrorEffects);
    const nativeInput = walk.context.callableValues.native.callFor(node);
    if (nativeInput !== undefined) selected.push({ localErrors: false,
      nativeErrors: [{ identity: nativeInput.invocationErrorSource, errorType: nativeInput.invocationError }] });
    if (kind === KindVariableDeclaration &&
      (ast.variableDeclarationKind(node) === "using" ||
        ast.variableDeclarationKind(node) === "await using")) {
      const disposal = selectRustResourceManagement(
        node,
        rustOperationContext(walk, node),
        walk.operationOptions,
        (declaration) => {
          const selfMode = walk.context.records.selfMode.get(declaration);
          if (selfMode === undefined) {
            return undefined;
          }
          return {
            selfMode,
            async: walk.context.records.asyncFunction.get(declaration) !== undefined,
            fallible: isFallible(declaration),
          };
        },
      );
      if (disposal.kind === "selected" && disposal.fact.disposal.fallible) {
        if (disposal.projectDisposerDeclarations.length === 0) selected.push(rustLocalErrorEffects);
        for (const declaration of disposal.projectDisposerDeclarations) {
          if (!appendDeclaration(declaration)) return undefined;
        }
      }
    }
    for (const declaration of selectedAccessorDeclarations(node)) {
      if (!appendDeclaration(declaration)) return undefined;
    }
    const operation = walk.context.records.targetOperation.get(node);
    const generatorInvocation = operation?.kind === "provider-operation"
      ? rustGeneratorSourceInvocationKind(operation.operationId) : undefined;
    const iterationOperand = operation?.kind === "iteration" && operation.iterationKind !== "for-in"
      ? Node_Expression(ast, node) : undefined;
    const generatorIteration = iterationOperand !== undefined &&
      getRustGeneratorProtocol(walk.context.records.runtimeCarrier.get(iterationOperand)?.carrier) !== undefined;
    if (generatorInvocation === "sync" || generatorIteration) {
      const receiver = generatorIteration ? iterationOperand
        : asSourceNode(walk.context.records.selectedOperation.get(node)?.provenance?.sourceReceiver, ast);
      const edge = receiver === undefined ? undefined
        : selectRustGeneratorSourceErrors(walk, receiver, declarationEffects, selectSourceErrors, budget);
      if (edge === undefined) {
        appendRustDiagnostic(walk, "RUST_GENERATOR_BODY_ERRORS_NOT_CLOSED",
          "Generator execution requires its exact original creation, input bindings and closed body error channel.", node,
          ["target.capability=rust.generator.exact-body-errors"]);
        return undefined;
      }
      appendEdge(node, edge);
    }
    if (kind === "KindAwaitExpression") {
      const operand = Node_Expression(walk.context.ast, node);
      const topology = operand === undefined ? undefined
        : rustAwaitSelection(walk.context.records.runtimeCarrier.get(operand)?.carrier, walk.context.typeDefinitions);
      const branches = topology === undefined ? [] : rustAwaitSelectionLeaves(topology);
      const sourceBranches = branches.filter(branch => branch.future !== undefined &&
        rustFutureValueForSourceStorage(branch.carrier) === undefined);
      if (branches.some(branch => branch.future !== undefined &&
        rustFutureValueForSourceStorage(branch.carrier) !== undefined)) selected.push({ localErrors: false,
        nativeErrors: [{ identity: rustJsRejectionErrorIdentity, errorType: rustJsValueTargetType() }] });
      const sourceEdges = operand === undefined || sourceBranches.length === 0 ? []
        : selectRustAwaitSourceErrors(walk, operand, sourceBranches
          .map(branch => branch.carrier), declarationEffects, selectSourceErrors, budget);
      if (sourceEdges === undefined) {
        appendRustDiagnostic(walk, "RUST_AWAIT_SOURCE_ERRORS_NOT_EXACT",
          "Awaited source futures require exact producer activations and branch error correspondence.", node,
          ["target.capability=rust.async.exact-source-errors"]);
        return undefined;
      }
      awaitSourceEdges.set(node, Object.freeze(sourceEdges.map(({ carrier, edge }) => Object.freeze({ carrier, edge }))));
      for (const branch of sourceBranches) {
        if (operand === undefined || branch.future === undefined) continue;
        const edges = sourceEdges.filter(source => rustTargetTypeRefEquals(source.carrier, branch.carrier));
        if (edges.length !== 0) {
          for (const source of edges) {
            if (sourceEnclosingCallable(source.invocation, ast) === sourceEnclosingCallable(node, ast))
              appendEdge(source.invocation, source.edge);
            else selected.push(source.edge.effects);
          }
          continue;
        }
        const future = rustFutureValueForStoredBranch(walk, operand, branch.carrier, selectSourceErrors);
        if (future?.errorBoundary === "source-native") {
          if (future.errorSource === undefined || future.errorCarrier === undefined) return undefined;
          selected.push({ localErrors: false, nativeErrors: [{ identity: future.errorSource, errorType: future.errorCarrier }] });
        } else if (future?.awaiting === "fallible" || future === undefined &&
          rustFutureValuesForSourceStorage(branch.carrier, walk.context.typeDefinitions)
            ?.some(future => future.awaiting === "fallible") === true) selected.push(rustLocalErrorEffects);
      }
    }
    if (nativeInput === undefined && (kind === KindCallExpression || kind === KindNewExpression)) {
      const operation = walk.context.records.targetOperation.get(node);
      const target = selectedProjectDeclaration(node);
      const generic = rustGenericCallableValue(rustSourceCallCallableStorageCarrier(operation, walk.context.structuralShapes));
      if (generic !== undefined) {
        const invocation = genericInvocation(node);
        if (invocation === undefined) return undefined;
        selected.push({ localErrors: false, nativeErrors: invocation.invocation });
      }
      const declarations = operation?.kind === "source-call" && operation.target.form === "union-method"
        ? operation.target.variants.map(variant => variant.declaration)
        : generic !== undefined || target === undefined ? [] : [target];
      for (const declaration of declarations) {
        if ((operation?.kind === "source-call" && operation.asyncBody?.maySuspend === false ||
          walk.context.records.asyncFunction.get(declaration) === undefined) &&
          walk.context.records.generator.get(declaration) === undefined && !appendDeclaration(declaration)) return undefined;
      }
    }
    const effects = mergeEffects(selected);
    if (effects === undefined) appendRustDiagnostic(walk, "RUST_ERROR_EFFECT_CONFLICT",
      "One native error identity has inconsistent exact carriers in this evaluation region.", node,
      ["target.capability=rust.native-error.exact-effects"]);
    else if (kind === KindCallExpression || kind === KindNewExpression || kind === "KindAwaitExpression")
      effectsByExpression.set(node, effects);
    return effects;
  };
}
