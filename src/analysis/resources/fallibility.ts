import {
  KindCallExpression,
  KindElementAccessExpression,
  KindFunctionDeclaration,
  KindFunctionExpression,
  KindNewExpression,
  KindParenthesizedExpression,
  KindPropertyAccessExpression,
  KindVariableDeclaration,
  Node_Expression,
  Node_Initializer,
  asSourceNode,
  sourceEnclosingCallable,
} from "@tsonic/target-api/source";
import {
  rustAsyncFunctionFactKey,
  rustBindingProjectionFactKey,
  rustContextualValueConversionFactKey,
  rustFallibleFactKey,
  rustGeneratorFactKey,
  rustObjectLiteralMethodAdapterFactKey,
  rustSelfModeFactKey,
  rustSourceAccessorEffectsFactKey,
  rustSourceCallEffectsFactKey,
  rustSourceCallableReturnFactKey,
  rustTargetOperationFactKey,
} from "../facts/keys.js";
import { appendRustDiagnostic, rustOperationContext } from "../program/walk.js";
import { rustStructuralFieldIsFallible } from "../objects/structural-shape-plan.js";
import { finalizeRustPreparedCheckedCall } from "../operations/provider/index.js";
import { rustCallbackProtocol } from "../operations/provider/callbacks.js";
import { recordSelectedOperationInputs } from "../operations/inputs.js";
import { rustAwaitCarrier, rustCallableProtocol } from "../../target-model/types/index.js";
import { rustSourceCallCallableStorageCarrier } from "../facts/target-operation.js";
import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustGenericCallableInvocationFactKey, type RustGenericCallableInvocationFact } from "../facts/generic-callable-effects.js";
import { selectRustGenericCallableInvocation } from "./generic-call-errors.js";
import { rustTargetOperationIsFallible } from "../facts/target-operation.js";
import { rustPolicyTargetDiagnostic } from "../../policy/operations/contracts.js";
import { rustSelectedCallKey, rustSelectedOperationKey } from "../../target-model/facts/selections.js";
import { rustContextualValueConversionIsFallible } from "../../target-model/conversions/contextual.js";
import { selectedDeclarationIsProjectSource } from "../expressions/references.js";
import { selectRustResourceManagement } from "./management.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import { rustPropertyProjectionGetters } from "../conversions/property-projections.js";
import type { RustFactWalk } from "../program/walk.js";
import type { RustPreparedDeferredCheckedCall } from "../operations/provider/index.js";
import { rustProjectCallableAdaptersKey } from "../facts/project-callable-adapters.js";
import { rustFutureValuesForSourceStorage } from "../facts/future-values.js";
import { rustFutureValueForStoredBranch } from "./future-storage.js";
import { rustAwaitSelection, rustAwaitSelectionLeaves } from "../../target-model/types/await.js";
import { collectRustErrorRegionEffects } from "./error-regions.js";
import { collectRustErrorDeclarations } from "./error-declarations.js";
import { mergeRustErrorEffects, rustErrorEffectsAreFallible, rustErrorEffectsEqual, rustErrorEffectsFactKey,
  rustLocalErrorEffects, rustPureErrorEffects, type RustErrorEffectsFact } from "../facts/error-effects.js";
import { createRustSourceErrorEffectSelection } from "./source-error-effects.js";
import { rustSourceErrorEffectsFactKey, type RustSourceErrorEffectEdge } from "../facts/source-error-effects.js";
import { createRustEffectsWorkBudget, defaultRustEffectsWorkLimit, type RustEffectsWorkBudget } from "./effects-work-budget.js";
import { rustAwaitSourceErrorEffectsFactKey, type RustAwaitSourceErrorBranch } from "../facts/await-source-error-effects.js";
import { selectRustAwaitSourceErrors } from "./await-source-effects.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";

export function recordFallibilityFacts(
  walk: RustFactWalk,
  projectSourceFiles: readonly SourceFile[],
  maximumWork = defaultRustEffectsWorkLimit,
): void {
  const budget = createRustEffectsWorkBudget(maximumWork);
  const failure = budget.run(() => collectFallibilityFacts(walk, projectSourceFiles, budget));
  if (failure !== undefined) appendRustDiagnostic(walk, failure.code, failure.message, undefined,
    ["target.capability=rust.native-error.bounded-effects"]);
}

function collectFallibilityFacts(
  walk: RustFactWalk,
  projectSourceFiles: readonly SourceFile[],
  budget: RustEffectsWorkBudget,
): void {
  budget.step();
  const { ast } = walk.context;
  const inventory = collectRustErrorDeclarations(walk, projectSourceFiles);
  if (inventory === undefined) return;
  const { declarations, regionsByDeclaration, relatedDeclarations, projectImplementations,
    dependenciesByDeclaration, registerCallableDeclaration, isDeclaration } = inventory;
  const effectsByDeclaration = new Map<Node, RustErrorEffectsFact>();
  const effectsByRegion = new Map<Node, RustErrorEffectsFact>();
  const effectsByExpression = new Map<Node, RustErrorEffectsFact>();
  const sourceErrorEdges = new Map<Node, RustSourceErrorEffectEdge[]>();
  const genericInvocations = new Map<Node, RustGenericCallableInvocationFact>();
  const awaitSourceEdges = new Map<Node, readonly RustAwaitSourceErrorBranch[]>();
  for (const call of walk.context.callableValues.native.calls) {
    budget.metadata(call.invocationError);
    budget.metadata(call.awaitErrors);
    budget.metadata(call.invocationErrorSource);
    budget.metadata(call.awaitErrorSources);
  }
  const selectSourceErrors = createRustSourceErrorEffectSelection(walk);
  const declarationEffects = (declaration: Node): RustErrorEffectsFact => {
    budget.step();
    return effectsByDeclaration.get(declaration) ?? rustPureErrorEffects;
  };
  const mergeEffects = (effects: readonly RustErrorEffectsFact[]): RustErrorEffectsFact | undefined => {
    budget.metadata(effects);
    return mergeRustErrorEffects(effects);
  };
  const isFallible = (declaration: Node): boolean => rustErrorEffectsAreFallible(declarationEffects(declaration));
  for (const nativeInput of walk.context.callableValues.native.calls) {
    budget.step();
    walk.context.facts.set(nativeInput.node, rustSourceCallEffectsFactKey, {
      invocation: "fallible", awaiting: nativeInput.completion === undefined ? "not-applicable" : "fallible",
      nativeInput: { invocationError: nativeInput.invocationError, invocationErrorSource: nativeInput.invocationErrorSource,
        awaitErrors: nativeInput.awaitErrors, awaitErrorSources: nativeInput.awaitErrorSources },
    }, [{ message: "rust exact abstract native callable input effects" }]);
  }
  const genericCallables = walk.context.callableValues.generic;
  for (const definition of genericCallables.definitions) {
    budget.step();
    for (const implementation of definition.implementations) {
      budget.step();
      registerCallableDeclaration(implementation.declaration);
    }
  }
  const genericInvocationIsFallible = (declaration: Node): boolean => {
    const implementations = projectImplementations.get(declaration) ?? [declaration];
    return [...implementations].some(implementation => isFallible(implementation) &&
      walk.context.facts.get(implementation, rustAsyncFunctionFactKey) === undefined &&
      walk.context.facts.get(implementation, rustGeneratorFactKey) === undefined);
  };
  const genericAwaitIsFallible = (declaration: Node): boolean =>
    walk.context.facts.get(declaration, rustSourceCallableReturnFactKey)?.implementationCompletion === undefined &&
      (walk.context.facts.get(declaration, rustAsyncFunctionFactKey) === undefined || isFallible(declaration));
  const genericInvocation = (node: Node): RustGenericCallableInvocationFact | undefined => {
    const selected = selectRustGenericCallableInvocation(node, walk.context, declaration => {
      const result = walk.context.facts.get(declaration, rustAsyncFunctionFactKey)?.futureCarrier ??
        walk.context.facts.get(declaration, rustSourceCallableReturnFactKey)?.returnCarrier;
      return { invocation: genericInvocationIsFallible(declaration) ? "fallible" : "infallible",
        awaiting: rustAwaitCarrier(result) === undefined ? "not-applicable"
          : genericAwaitIsFallible(declaration) ? "fallible" : "infallible" };
    });
    if (selected === undefined || !selectSourceErrors.register([...selected.invocation, ...selected.awaiting])) {
      appendRustDiagnostic(walk, "RUST_GENERIC_CALLABLE_EFFECTS_NOT_CLOSED",
        "A generic invocation requires one exact physical family and bound producer error channels.", node,
        ["target.capability=rust.generic-callable.effects"]);
      return undefined;
    }
    budget.metadata(selected);
    genericInvocations.set(node, selected);
    return selected;
  };
  for (const usage of walk.context.projectMethodProperties.usages) {
    budget.step();
    if (usage.writable) {
      effectsByDeclaration.set(usage.declaration, rustLocalErrorEffects);
    }
  }
  for (const expression of walk.objectLiteralMethodExpressions) {
    budget.step();
    const adapters = walk.context.facts.get(expression, rustObjectLiteralMethodAdapterFactKey) ??
      walk.context.facts.resolve(expression, rustObjectLiteralMethodAdapterFactKey);
    for (const dispatch of adapters?.dispatches ?? []) {
      budget.step();
      if (dispatch.adapterFallible) {
        effectsByDeclaration.set(dispatch.contractMethod, rustLocalErrorEffects);
      }
    }
  }
  for (const definition of walk.context.projectTypes.definitions) {
    budget.step();
    for (const adapter of walk.context.facts.get(definition.declaration, rustProjectCallableAdaptersKey) ?? []) {
      budget.step();
      if (adapter.adapterFallible) effectsByDeclaration.set(adapter.contract, rustLocalErrorEffects);
    }
  }
  for (const expression of walk.objectLiteralMethodSpreadExpressions) {
    budget.step();
    const operation = walk.context.facts.get(expression, rustTargetOperationFactKey) ??
      walk.context.facts.resolve(expression, rustTargetOperationFactKey);
    if (operation?.kind !== "record-literal") {
      continue;
    }
    for (const contribution of operation.contributions) {
      budget.step();
      if (contribution.kind !== "spread") {
        continue;
      }
      for (const method of contribution.methods) {
        budget.step();
        effectsByDeclaration.set(method.contractDeclaration, rustLocalErrorEffects);
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
    if (declaration === undefined || !selectedDeclarationIsProjectSource(walk, declaration)) return undefined;
    const selectedImplementation = walk.context.source.navigation.callableImplementation(declaration);
    return selectedImplementation.kind === "resolved" ? selectedImplementation.implementation.declaration : undefined;
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
        projection.storage === "structural-object" &&
          rustStructuralFieldIsFallible(walk.context.structuralShapes.field(
            bindingProjection.sourceCarrier,
            projection.storageIndex,
          ))
      : projection?.kind === "object-rest" &&
        projection.fields.some((field) => field.accessor !== undefined ||
          projection.storage === "structural-object" &&
            rustStructuralFieldIsFallible(walk.context.structuralShapes.field(
              bindingProjection.sourceCarrier,
              field.sourceStorageIndex,
            )));
    return walk.context.callableValues.native.callFor(node) === undefined && rustTargetOperationIsFallible(
      operation,
      walk.context.structuralShapes,
      walk.context.projectFieldDispatch,
      walk.context.frozenDataWrites, walk.context.typeDefinitions,
    ) ||
      bindingProjectionIsFallible ||
      rustContextualValueConversionIsFallible(contextualConversion?.conversion, walk.context.typeDefinitions);
  };
  const selectedAccessorDeclarations = (node: Node): readonly Node[] => {
    const projected = rustPropertyProjectionGetters(node, walk.context);
    const operation = walk.context.facts.get(node, rustTargetOperationFactKey) ??
      walk.context.facts.resolve(node, rustTargetOperationFactKey);
    if (operation?.kind !== "source-accessor") {
      return projected;
    }
    const selected = walk.context.facts.get(node, rustSelectedOperationKey) ??
      walk.context.facts.resolve(node, rustSelectedOperationKey);
    return [
      ...projected,
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
      budget.step();
      current = Node_Expression(ast, current);
    }
    return current;
  };
  interface CallbackValueAnalysis {
    readonly fallible: boolean;
    readonly implementationFallible: boolean;
    readonly implementationEffects: RustErrorEffectsFact;
    readonly subjects: readonly Node[];
  }
  const callbackExpressionIsFallible = (
    pending: { readonly request: import("../../policy/operations/contracts.js").RustCheckedCallSelectionInput; readonly prepared: RustPreparedDeferredCheckedCall },
  ): boolean => callbackValueAnalysis(callbackExpression(pending), new Set())?.fallible === true;
  const callbackValueAnalysis = (
    expression: Node | undefined,
    resolving: Set<Node>,
  ): CallbackValueAnalysis | undefined => {
    budget.step();
    const value = callbackValueExpression(expression);
    if (value === undefined || resolving.has(value)) {
      return undefined;
    }
    resolving.add(value);
    try {
      const carrier = walk.context.facts.getRuntimeCarrierFact(value)?.carrier;
      const invocationFallible = rustCallbackProtocol(carrier)?.fallible === true;
      const body = ast.body(value);
      if (body !== undefined) {
        const implementationEffects = expressionRegionEffects(body);
        if (implementationEffects === undefined) return undefined;
        const implementationFallible = rustErrorEffectsAreFallible(implementationEffects);
        return {
          fallible: invocationFallible || implementationFallible,
          implementationFallible,
          implementationEffects,
          subjects: [value],
        };
      }
      const declaration = walk.context.source.navigation.sourceReferenceFor(value)?.declaration;
      if (declaration === undefined) {
        return undefined;
      }
      if (isFallible(declaration)) {
        return { fallible: true, implementationFallible: true, implementationEffects: declarationEffects(declaration), subjects: [value, declaration] };
      }
      const declarationBody = ast.body(declaration);
      if (declarationBody !== undefined) {
        const implementationEffects = expressionRegionEffects(declarationBody);
        if (implementationEffects === undefined) return undefined;
        const implementationFallible = rustErrorEffectsAreFallible(implementationEffects);
        return {
          fallible: invocationFallible || implementationFallible,
          implementationFallible,
          implementationEffects,
          subjects: [value, declaration],
        };
      }
      const initialized = callbackValueAnalysis(Node_Initializer(ast, declaration), resolving);
      return initialized === undefined
        ? undefined
        : {
            fallible: invocationFallible || initialized.fallible,
            implementationFallible: initialized.implementationFallible,
            implementationEffects: initialized.implementationEffects,
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
  function expressionRegionEffects(root: Node): RustErrorEffectsFact | undefined {
    budget.step();
    const effects = collectRustErrorRegionEffects(root, ast, directEffects, (node, effects) => {
      budget.metadata(effects);
      const kind = ast.kindName(node);
      if (!isDeclaration(node) && kind !== KindCallExpression && kind !== KindNewExpression && kind !== "KindAwaitExpression")
        effectsByRegion.set(node, effects);
    });
    if (effects === undefined) appendRustDiagnostic(walk, "RUST_ERROR_REGION_NOT_EXACT",
      "An evaluation region has inconsistent or unresolved exact error channels.", root,
      ["target.capability=rust.native-error.exact-effects"]);
    return effects;
  }
  function directEffects(node: Node): RustErrorEffectsFact | undefined {
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
          const selectedSignature = walk.context.facts.getSelectedTargetCall(invocation);
          const selectedOperation = walk.context.facts.get(invocation, rustTargetOperationFactKey);
          budget.metadata(selectedSignature?.member.genericParameters);
          let replacementWork = 1;
          for (const argument of selectedOperation?.kind === "source-call" ? selectedOperation.targetGenericArguments ?? [] : []) {
            replacementWork = Math.max(replacementWork, budget.metadata(argument));
          }
          budget.expansion(carrierWork, replacementWork);
        }
        const bindings = source.nativeErrors.length === 0 ? undefined : selectSourceErrors.bindingsFor(
          invocation, declaration, source.nativeErrors.map(error => error.errorType));
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
            const selfMode = walk.context.facts.get(declaration, rustSelfModeFactKey);
            if (selfMode === undefined) {
              return undefined;
            }
            return {
              selfMode,
              async: walk.context.facts.get(declaration, rustAsyncFunctionFactKey) !== undefined,
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
      if (kind === "KindAwaitExpression") {
        const operand = Node_Expression(walk.context.ast, node);
        const topology = operand === undefined ? undefined
          : rustAwaitSelection(walk.context.facts.getRuntimeCarrierFact(operand)?.carrier, walk.context.typeDefinitions);
        const branches = topology === undefined ? [] : rustAwaitSelectionLeaves(topology);
        const sourceEdges = operand === undefined || branches.every(branch => branch.future === undefined) ? []
          : selectRustAwaitSourceErrors(walk, operand, branches.filter(branch => branch.future !== undefined)
            .map(branch => branch.carrier), declarationEffects, selectSourceErrors, budget);
        if (sourceEdges === undefined) {
          appendRustDiagnostic(walk, "RUST_AWAIT_SOURCE_ERRORS_NOT_EXACT",
            "Awaited source futures require exact producer activations and branch error correspondence.", node,
            ["target.capability=rust.async.exact-source-errors"]);
          return undefined;
        }
        awaitSourceEdges.set(node, Object.freeze(sourceEdges.map(({ carrier, edge }) => Object.freeze({ carrier, edge }))));
        for (const branch of branches) {
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
          const future = rustFutureValueForStoredBranch(walk, operand, branch.carrier);
          if (future?.errorBoundary === "source-native") {
            if (future.errorSource === undefined || future.errorCarrier === undefined) return undefined;
            selected.push({ localErrors: false, nativeErrors: [{ identity: future.errorSource, errorType: future.errorCarrier }] });
          } else if (future?.awaiting === "fallible" || future === undefined &&
            rustFutureValuesForSourceStorage(branch.carrier, walk.context.typeDefinitions)
              ?.some(future => future.awaiting === "fallible") === true) selected.push(rustLocalErrorEffects);
        }
      }
      if (nativeInput === undefined && (kind === KindCallExpression || kind === KindNewExpression)) {
        const operation = walk.context.facts.get(node, rustTargetOperationFactKey);
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
          if (walk.context.facts.get(declaration, rustAsyncFunctionFactKey) === undefined &&
            walk.context.facts.get(declaration, rustGeneratorFactKey) === undefined && !appendDeclaration(declaration)) return undefined;
        }
      }
      const effects = mergeEffects(selected);
      if (effects === undefined) appendRustDiagnostic(walk, "RUST_ERROR_EFFECT_CONFLICT",
        "One native error identity has inconsistent exact carriers in this evaluation region.", node,
        ["target.capability=rust.native-error.exact-effects"]);
      else if (kind === KindCallExpression || kind === KindNewExpression || kind === "KindAwaitExpression")
        effectsByExpression.set(node, effects);
      return effects;
  }
  const declarationBodyEffects = (declaration: Node): RustErrorEffectsFact | undefined => {
    budget.step();
    const effects = [...(regionsByDeclaration.get(declaration) ?? [])].map(expressionRegionEffects);
    if (effects.some(value => value === undefined)) return undefined;
    const selected = mergeEffects([declarationEffects(declaration), ...effects as RustErrorEffectsFact[],
      ...[...(dependenciesByDeclaration.get(declaration) ?? []), ...(relatedDeclarations.get(declaration) ?? [])].map(declarationEffects)]);
    if (selected === undefined) appendRustDiagnostic(walk, "RUST_ERROR_DECLARATION_NOT_EXACT",
      "A declaration has incompatible exact error channels from its evaluated regions or selected dependencies.", declaration,
      ["target.capability=rust.native-error.exact-effects"]);
    return selected;
  };

  let changed = true;
  while (changed) {
    budget.step();
    changed = false;
    for (const declaration of declarations) {
      const effects = declarationBodyEffects(declaration);
      if (effects === undefined) return;
      budget.metadata(effects);
      if (!rustErrorEffectsEqual(declarationEffects(declaration), effects)) {
        effectsByDeclaration.set(declaration, effects);
        changed = true;
      }
    }
  }
  const ownedCallbackClosures = new Set<Node>();
  for (const declaration of declarations) {
    budget.step();
    const result = walk.context.facts.get(declaration, rustAsyncFunctionFactKey)?.futureCarrier ??
      walk.context.facts.get(declaration, rustSourceCallableReturnFactKey)?.returnCarrier;
    walk.context.facts.set(declaration, rustSourceCallEffectsFactKey, {
      invocation: genericInvocationIsFallible(declaration) ? "fallible" : "infallible",
      awaiting: rustAwaitCarrier(result) === undefined ? "not-applicable"
        : genericAwaitIsFallible(declaration) ? "fallible" : "infallible",
    }, [{ message: "rust finalized callable declaration invocation and return effects" }]);
  }
  for (const [call, pending] of walk.preparedCallbackCalls) {
    budget.step();
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
      budget.step();
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
    if (callbackAnalysis.implementationFallible) {
      for (const subject of callbackAnalysis.subjects) {
        walk.context.facts.set(subject, rustFallibleFactKey, { fallible: true }, [
          { message: "rust fallible callback ABI" },
        ]);
      }
    }
  }
  for (const declaration of new Set([...declarations, ...effectsByDeclaration.keys()])) {
    const effects = declarationEffects(declaration);
    budget.metadata(effects);
    walk.context.facts.set(declaration, rustErrorEffectsFactKey, effects,
      [{ message: "rust finalized exact declaration error effects" }]);
    if (rustErrorEffectsAreFallible(effects)) walk.context.facts.set(declaration, rustFallibleFactKey, { fallible: true }, [
      { message: "rust fallible declaration" },
    ]);
  }
  for (const sourceFile of projectSourceFiles) {
    budget.step();
    const runtimeStatements = (ast.statements(sourceFile) as readonly Node[]).flatMap((statement): readonly Node[] => {
      budget.step();
      const kind = ast.kindName(statement);
      return kind !== KindFunctionDeclaration &&
        kind !== "KindInterfaceDeclaration" &&
        kind !== "KindTypeAliasDeclaration" &&
        kind !== "KindEnumDeclaration" &&
        kind !== "KindImportDeclaration" &&
        kind !== "KindExportDeclaration" &&
        kind !== "KindEndOfFile" ? [statement] : [];
    });
    const selectedEffects = runtimeStatements.map(expressionRegionEffects);
    if (selectedEffects.some(effects => effects === undefined)) return;
    const effects = mergeEffects(selectedEffects as RustErrorEffectsFact[]);
    if (effects === undefined) return;
    walk.context.facts.set(sourceFile, rustErrorEffectsFactKey, effects,
      [{ message: "rust finalized exact module initialization error effects" }]);
    if (rustErrorEffectsAreFallible(effects)) {
      walk.context.facts.set(sourceFile, rustFallibleFactKey, { fallible: true }, [
        { message: "rust fallible project module initialization" },
      ]);
    }
  }
  for (const sourceFile of projectSourceFiles) {
    const visit = (node: Node): void => {
      budget.step();
      const kind = ast.kindName(node);
      if (kind === "KindArrowFunction" || kind === KindFunctionExpression) {
        const operation = walk.context.facts.get(node, rustTargetOperationFactKey) ??
          walk.context.facts.resolve(node, rustTargetOperationFactKey);
        const body = ast.body(node);
        const effects = body === undefined ? undefined : expressionRegionEffects(body);
        if (operation?.kind === "closure" && effects !== undefined && rustErrorEffectsAreFallible(effects)) {
          if (rustGenericCallableValue(operation.resultCarrier) !== undefined || rustCallableProtocol(operation.resultCarrier) !== undefined ||
            operation.resultCarrier.kind === "closure" && operation.resultCarrier.fallible === true) {
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
      } else if (kind === KindPropertyAccessExpression || kind === KindElementAccessExpression) {
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
              : { read: isFallible(readDeclaration) ? "fallible" : "infallible" }),
            ...(operation.write === undefined || writeDeclaration === undefined
              ? {}
              : { write: isFallible(writeDeclaration) ? "fallible" : "infallible" }),
          }, [{ message: "rust finalized selected project accessor effects" }]);
        }
      } else if (kind === KindCallExpression || kind === KindNewExpression) {
        const operation = walk.context.facts.get(node, rustTargetOperationFactKey) ??
          walk.context.facts.resolve(node, rustTargetOperationFactKey);
        if (operation?.kind === "source-call") {
          const declaration = selectedProjectDeclaration(node);
          const nativeCallable = operation.target.form === "callable" &&
            (operation.target.carrier.kind === "closure" || operation.target.carrier.kind === "function-pointer");
          const runtimeCallable = (operation.target.form === "callable" &&
              (rustCallableProtocol(operation.target.carrier) !== undefined ||
                operation.target.carrier.kind === "closure" && operation.target.carrier.fallible === true)) ||
            (operation.target.form === "structural-method" || operation.target.form === "constructor-value") &&
              rustCallableProtocol(operation.target.callableCarrier) !== undefined;
          const nativeInput = walk.context.callableValues.native.callFor(node);
          const generic = nativeInput === undefined &&
            rustGenericCallableValue(rustSourceCallCallableStorageCarrier(operation, walk.context.structuralShapes)) !== undefined;
          const invocation = generic ? genericInvocation(node) : undefined;
          if (nativeInput === undefined && (nativeCallable || runtimeCallable || invocation !== undefined || declaration !== undefined)) {
            const isAsync = rustAwaitCarrier(operation.resultCarrier) !== undefined;
            const unionBranches = operation.target.form === "union-method"
              ? operation.target.variants.map(variant => ({
                invocation: genericInvocationIsFallible(variant.declaration) ? "fallible" as const : "infallible" as const,
                awaiting: !isAsync ? "not-applicable" as const
                  : genericAwaitIsFallible(variant.declaration) ? "fallible" as const : "infallible" as const,
              }))
              : undefined;
            walk.context.facts.set(node, rustSourceCallEffectsFactKey, {
              ...(unionBranches === undefined ? {} : { unionBranches }),
              invocation: invocation !== undefined ? invocation.effects.invocation
                : runtimeCallable || (unionBranches === undefined
                  ? declaration !== undefined && genericInvocationIsFallible(declaration)
                  : unionBranches.some(branch => branch.invocation === "fallible"))
                ? "fallible"
                : "infallible",
              awaiting: isAsync
                  ? invocation !== undefined ? invocation.effects.awaiting
                  : runtimeCallable || (unionBranches === undefined
                    ? declaration !== undefined && genericAwaitIsFallible(declaration)
                    : unionBranches.some(branch => branch.awaiting === "fallible")) ? "fallible" : "infallible"
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
  for (const [region, effects] of effectsByRegion) {
    budget.metadata(effects);
    walk.context.facts.set(region, rustErrorEffectsFactKey, effects,
      [{ message: "rust finalized exact lexical region error effects" }]);
  }
  for (const [node, invocation] of genericInvocations) {
    budget.metadata(invocation);
    walk.context.facts.set(node, rustGenericCallableInvocationFactKey, invocation,
      [{ message: "rust finalized physical generic invocation and exact producer error channels" }]);
  }
  for (const [node, effects] of effectsByExpression) {
    budget.metadata(effects);
    walk.context.facts.set(node, rustErrorEffectsFactKey, effects,
      [{ message: "rust finalized exact selected invocation or await errors" }]);
  }
  for (const [node, edges] of sourceErrorEdges) {
    budget.step();
    for (const edge of edges) {
      budget.metadata(edge.effects);
      budget.metadata(edge.nativeErrors);
    }
    walk.context.facts.set(node, rustSourceErrorEffectsFactKey, Object.freeze({ edges: Object.freeze(edges) }),
      [{ message: "rust exact selected source error identity correspondence" }]);
  }
  for (const [node, branches] of awaitSourceEdges) walk.context.facts.set(node,
    rustAwaitSourceErrorEffectsFactKey, Object.freeze({ branches }),
    [{ message: "rust exact awaited branch and producer error correspondence" }]);
}
