import { createRustDirectErrorEffects } from "./direct-effects.js";
import { createRustCallbackEffectAnalysis } from "./callback-effects.js";
import { createRustIntrinsicErrorEffectsPublication } from "../program/records/intrinsic-error-effects.js";
import {
  KindCallExpression,
  KindElementAccessExpression,
  KindFunctionDeclaration,
  KindFunctionExpression,
  KindNewExpression,
  KindPropertyAccessExpression,
  Node_Expression,
  asSourceNode,
} from "@tsonic/target-api/source";

import { appendRustDiagnostic, rustOperationContext } from "../program/walk.js";
import { rustStructuralFieldIsFallible, rustOperationAbiConversionsAreFallible } from "../../policy/operations/members/native-contracts.js";
import { finalizeRustPreparedCheckedCall } from "../operations/members/index.js";
import { recordFinalizedOperationInputEffects } from "../operations/inputs.js";
import { rustCallableProtocol } from "../../target-model/types/index.js";
import { rustNativeCallableCompletion } from "../../policy/types/callables/native-completion.js";
import { rustSourceCallCallableStorageCarrier } from "../../policy/operations/members/native-contracts.js";
import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";

import type { RustGenericCallableInvocationFact } from "../../target-model/records/generic-callable-effects.js";
import { prepareRustGenericCallableInvocation, type RustSourceGenericCallableInvocation } from "./generic-call-errors.js";
import { rustTargetOperationIsFallible } from "../../policy/operations/members/native-contracts.js";
import { rustPolicyTargetDiagnostic } from "../program/policy-diagnostics.js";

import { rustContextualValueConversionIsFallible } from "../../policy/conversions/contextual.js";
import { selectedDeclarationIsProjectSource } from "../storage/source-bindings.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import { rustPropertyProjectionGetters } from "../conversions/property-projections.js";
import type { RustFactWalk } from "../program/walk.js";

import { rustFutureValueForSourceStorage } from "../callables/future-values.js";
import { rustAwaitSelectionLeaves } from "../../target-model/types/await.js";
import { rustAwaitSelection } from "../../policy/operations/flow/await.js";
import { collectRustErrorRegionEffects } from "./region-effects.js";
import { collectRustErrorDeclarations } from "./error-declarations.js";
import { mergeRustErrorEffects, rustErrorEffectsAreFallible, rustErrorEffectsEqual, rustLocalErrorEffects, rustPureErrorEffects } from "./error-effects.js";

import type { RustErrorEffectsFact } from "../../target-model/records/error-effects.js";
import type { RustSourceErrorEffectSelection } from "./source-error-effects.js";

import type { RustSourceErrorEffectEdge } from "../../target-model/records/source-error-effects.js";
import { createRustEffectsWorkBudget, defaultRustEffectsWorkLimit, type RustEffectsWorkBudget } from "./effects-work-budget.js";

import type { RustAwaitSourceErrorBranch } from "../../target-model/records/await-source-error-effects.js";
import { selectRustAwaitSourceErrors } from "./await-source-effects.js";
import { rustGeneratorSourceInvocationKind } from "../../policy/operations/source-profiles/generator-source-profile.js";
import { getRustGeneratorProtocol } from "../../target-model/types/carriers/callables.js";
import { requireRustRecord } from "../program/records/required-records.js";
import type { SourceNativeTaskGraph } from "@tsonic/target-api/analysis";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";

export interface RustSourceFallibilityConstruction {
  readonly sourceErrors: RustSourceErrorEffectSelection;
  effectsFor(subject: Node): RustErrorEffectsFact | undefined;
  complete(): void;
}

export function recordFallibilityFacts(
  walk: RustFactWalk,
  projectSourceFiles: readonly SourceFile[],
  nativeTasks: SourceNativeTaskGraph,
  maximumWork = defaultRustEffectsWorkLimit,
): RustSourceFallibilityConstruction | undefined {
  walk.context.records.assertOpen();
  const budget = createRustEffectsWorkBudget(maximumWork);
  let construction: RustSourceFallibilityConstruction | undefined;
  const failure = budget.run(() => { construction = collectFallibilityFacts(walk, projectSourceFiles, nativeTasks, budget); });
  if (failure !== undefined) appendRustDiagnostic(walk, failure.code, failure.message, undefined,
    ["target.capability=rust.native-error.bounded-effects"]);
  return failure === undefined ? construction : undefined;
}

function collectFallibilityFacts(
  walk: RustFactWalk,
  projectSourceFiles: readonly SourceFile[],
  nativeTasks: SourceNativeTaskGraph,
  budget: RustEffectsWorkBudget,
): RustSourceFallibilityConstruction | undefined {
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
  const genericInvocations = new Map<Node, RustSourceGenericCallableInvocation>();
  const effectsByModule = new Map<SourceFile, RustErrorEffectsFact>();
  const completedInvocations = new Map<Node, ReturnType<RustSourceGenericCallableInvocation["complete"]>>();
  const awaitSourceEdges = new Map<Node, readonly RustAwaitSourceErrorBranch[]>();
  const fallibleSubjects = new Set<Node>();
  for (const call of walk.context.callableValues.native.calls) {
    budget.metadata(call.invocationError);
    budget.metadata(call.awaitErrors);
    budget.metadata(call.invocationErrorSource);
    budget.metadata(call.awaitErrorSources);
  }
  const selectSourceErrors = walk.context.callableValues.nativeStorage.sourceErrors;
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
    requireRustRecord(walk.context.requiredRecords, "sourceCallEffects", nativeInput.node,
      "native-call", "recordFallibilityFacts");
    walk.context.records.sourceCallEffectPlans.nativeInput(nativeInput);
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
      walk.context.records.asyncFunction.get(implementation) === undefined &&
      walk.context.records.generator.get(implementation) === undefined);
  };
  const genericAwaitIsFallible = (declaration: Node): boolean =>
    walk.context.records.sourceCallableReturn.get(declaration)?.implementationCompletion === undefined &&
      (walk.context.records.asyncFunction.get(declaration) === undefined || isFallible(declaration));
  const hasCompletion = (carrier: import("../../target-model/types/model.js").TargetTypeRef | undefined): boolean =>
    carrier !== undefined && rustNativeCallableCompletion(carrier, walk.context.typeDefinitions) !== undefined;
  const genericInvocation = (node: Node): RustGenericCallableInvocationFact | undefined => {
    const pending = prepareRustGenericCallableInvocation(node, walk.context, declaration => {
      const result = walk.context.records.asyncFunction.get(declaration)?.futureCarrier ??
        walk.context.records.sourceCallableReturn.get(declaration)?.returnCarrier;
      return { invocation: genericInvocationIsFallible(declaration) ? "fallible" : "infallible",
        awaiting: !hasCompletion(result) ? "not-applicable"
          : genericAwaitIsFallible(declaration) ? "fallible" : "infallible" };
    }, selectSourceErrors);
    const selected = pending?.selection;
    if (pending === undefined || selected === undefined || !selectSourceErrors.register([...selected.invocation, ...selected.awaiting])) {
      appendRustDiagnostic(walk, "RUST_GENERIC_CALLABLE_EFFECTS_NOT_CLOSED",
        "A generic invocation requires one exact physical family and bound producer error channels.", node,
        ["target.capability=rust.generic-callable.effects"]);
      return undefined;
    }
    for (const error of [...selected.invocation, ...selected.awaiting]) selectSourceErrors.pending(error, () => {
      if (!completedInvocations.has(node)) completedInvocations.set(node, pending.complete(walk.context));
      return completedInvocations.get(node)?.replacements.get(error.identity);
    }, pending.pendingErrors.has(error.identity) ? "completed" : "bound");
    budget.metadata(selected);
    genericInvocations.set(node, pending);
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
    const adapters = walk.context.records.objectLiteralMethodAdapter.get(expression);
    for (const dispatch of adapters?.dispatches ?? []) {
      budget.step();
      if (dispatch.adapterFallible) {
        effectsByDeclaration.set(dispatch.contractMethod, rustLocalErrorEffects);
      }
    }
  }
  for (const definition of walk.context.projectTypes.definitions) {
    budget.step();
    for (const adapter of walk.context.records.projectCallableAdapters.get(definition.declaration) ?? []) {
      budget.step();
      if (adapter.adapterFallible) effectsByDeclaration.set(adapter.contract, rustLocalErrorEffects);
    }
  }
  for (const expression of walk.objectLiteralMethodSpreadExpressions) {
    budget.step();
    const operation = walk.context.records.targetOperation.get(expression);
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
    const operation = walk.context.records.targetOperation.get(node);
    if (operation?.kind === "source-call" && operation.target.form === "structural-method") {
      const method = walk.context.structuralShapes.field(operation.target.receiverCarrier, operation.target.storageIndex)?.methodPlan;
      if (method?.kind === "fixed") return method.declaration;
    }
    if (operation?.kind === "source-call" && operation.target.form === "callable" &&
      rustCallableProtocol(operation.target.carrier)?.error !== undefined) return undefined;
    const selected = walk.context.records.selectedCall.get(node);
    const declaration = asSourceNode(
      selected?.sourceDeclaration,
      walk.context.ast,
    );
    if (declaration === undefined || !selectedDeclarationIsProjectSource(walk, declaration)) return undefined;
    if ((ast.is.IsClassDeclaration(declaration) || ast.is.IsClassExpression(declaration)) && isDeclaration(declaration)) return declaration;
    if (projectImplementations.has(declaration)) return declaration;
    // A contract member dispatched through fallible implementation adapters carries those effects itself (recorded
    // above from the adapter records); its calls take them even when no body implements the member directly.
    if (effectsByDeclaration.has(declaration)) return declaration;
    const selectedImplementation = walk.context.source.navigation.callableImplementation(declaration);
    return selectedImplementation.kind === "resolved" ? selectedImplementation.implementation.declaration : undefined;
  };
  const operationIsFallible = (node: Node, invocationEffectsSelected: boolean): boolean => {
    const operation = walk.context.records.targetOperation.get(node);
    const generatorOperand = operation?.kind === "iteration" && operation.iterationKind !== "for-in"
      ? Node_Expression(ast, node) : undefined;
    const generatorOperation = operation?.kind === "provider-operation"
      ? rustGeneratorSourceInvocationKind(operation.operationId) !== undefined
      : generatorOperand !== undefined && getRustGeneratorProtocol(
        walk.context.records.runtimeCarrier.get(generatorOperand)?.carrier) !== undefined;
    const bindingProjection = walk.context.records.bindingProjection.get(node);
    const contextualConversion = walk.context.records.contextualValueConversion.get(node);
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
    return !invocationEffectsSelected && !walk.preparedCallbackCalls.has(node) && walk.context.callableValues.native.callFor(node) === undefined &&
      !generatorOperation && rustTargetOperationIsFallible(
      operation,
      walk.context.structuralShapes,
      walk.context.projectFieldDispatch,
      walk.context.frozenDataWrites, walk.context.typeDefinitions,
    ) ||
      (operation?.kind === "provider-operation" || operation?.kind === "runtime-set") &&
        rustOperationAbiConversionsAreFallible(operation.abi) ||
      bindingProjectionIsFallible ||
      rustContextualValueConversionIsFallible(contextualConversion?.conversion, walk.context.typeDefinitions);
  };
  const selectedAccessorDeclarations = (node: Node): readonly Node[] => {
    const projected = rustPropertyProjectionGetters(node, walk.context);
    const operation = walk.context.records.targetOperation.get(node);
    if (operation?.kind !== "source-accessor") {
      return projected;
    }
    const selected = walk.context.records.selectedOperation.get(node);
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

  const { callbackExpression, callbackValueExpression, callbackValueAnalysis, preparedCallbackOperationEffects } =
    createRustCallbackEffectAnalysis({ walk, budget, isFallible, declarationEffects, expressionRegionEffects });
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
  const directEffects = createRustDirectErrorEffects({
    walk, budget, declarationEffects, operationIsFallible, preparedCallbackOperationEffects, isFallible,
    selectedAccessorDeclarations, selectedProjectDeclaration, genericInvocation, mergeEffects,
    sourceErrorEdges, selectSourceErrors, awaitSourceEdges, effectsByExpression,
  });
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
    const result = walk.context.records.asyncFunction.get(declaration)?.futureCarrier ??
      walk.context.records.sourceCallableReturn.get(declaration)?.returnCarrier;
    requireRustRecord(walk.context.requiredRecords, "sourceCallEffects", declaration,
      "source-callable", "recordFallibilityFacts");
    walk.context.records.sourceCallEffectPlans.selected(declaration,
      genericInvocationIsFallible(declaration) ? "fallible" : "infallible",
      !hasCompletion(result) ? "not-applicable" : genericAwaitIsFallible(declaration) ? "fallible" : "infallible");
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
    const finalized = finalizeRustPreparedCheckedCall(
      pending.request,
      pending.prepared,
      callbackAnalysis,
      rustOperationContext(walk, call),
      walk.operationOptions,
    );
    if (finalized.kind === "reject") {
      walk.context.diagnostics.push(rustPolicyTargetDiagnostic(finalized.diagnostic));
      continue;
    }
    const operation = walk.context.records.targetOperation.get(call);
    if (operation?.kind !== "provider-operation") failTargetAnalysisInvariant("tsonic-rust",
      "An admitted prepared callback requires its finalized native operation.", call);
    recordFinalizedOperationInputEffects(walk, call, operation);
    if (rustErrorEffectsAreFallible(callbackAnalysis.implementationEffects)) {
      for (const subject of callbackAnalysis.subjects) {
        fallibleSubjects.add(subject);
      }
    }
  }
  for (const declaration of new Set([...declarations, ...effectsByDeclaration.keys()])) {
    const effects = declarationEffects(declaration);
    budget.metadata(effects);
    effectsByDeclaration.set(declaration, effects);
    if (rustErrorEffectsAreFallible(effects)) fallibleSubjects.add(declaration);
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
    effectsByModule.set(sourceFile, effects);
    if (rustErrorEffectsAreFallible(effects)) {
      fallibleSubjects.add(sourceFile);
    }
  }
  for (const sourceFile of projectSourceFiles) {
    const visit = (node: Node): void => {
      if (!walk.context.isNativeNode(node)) return;
      budget.step();
      const kind = ast.kindName(node);
      if (kind === "KindArrowFunction" || kind === KindFunctionExpression) {
        const operation = walk.context.records.targetOperation.get(node);
        const body = ast.body(node);
        const effects = body === undefined ? undefined : expressionRegionEffects(body);
        if (operation?.kind === "closure" && effects !== undefined && rustErrorEffectsAreFallible(effects)) {
          if (rustGenericCallableValue(operation.resultCarrier) !== undefined || rustCallableProtocol(operation.resultCarrier) !== undefined ||
            operation.resultCarrier.kind === "closure" && operation.resultCarrier.fallible === true) {
            fallibleSubjects.add(node);
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
        const operation = walk.context.records.targetOperation.get(node);
        const selected = walk.context.records.selectedOperation.get(node);
        if (operation?.kind === "source-accessor") {
          const readDeclaration = asSourceNode(
            selected?.provenance?.sourceSelectedReadDeclaration,
            walk.context.ast,
          );
          const writeDeclaration = asSourceNode(
            selected?.provenance?.sourceSelectedWriteDeclaration,
            walk.context.ast,
          );
          requireRustRecord(walk.context.requiredRecords, "sourceAccessorEffects", node,
            "source-accessor", "recordFallibilityFacts");
          walk.context.records.sourceAccessorEffectPlans.selected(node,
            operation.read === undefined || readDeclaration === undefined ? undefined : isFallible(readDeclaration),
            operation.write === undefined || writeDeclaration === undefined ? undefined : isFallible(writeDeclaration));
        }
      } else if (kind === KindCallExpression || kind === KindNewExpression) {
        const operation = walk.context.records.targetOperation.get(node);
        if (operation?.kind === "source-call") {
          const declaration = selectedProjectDeclaration(node);
          const fixedMethod = operation.target.form === "structural-method" &&
            walk.context.structuralShapes.field(operation.target.receiverCarrier, operation.target.storageIndex)?.methodPlan?.kind === "fixed";
          const nativeCallable = operation.target.form === "callable" &&
            (operation.target.carrier.kind === "closure" || operation.target.carrier.kind === "function-pointer");
          const runtimeCallable = (operation.target.form === "callable" &&
              (rustCallableProtocol(operation.target.carrier) !== undefined ||
                operation.target.carrier.kind === "closure" && operation.target.carrier.fallible === true)) ||
            (!fixedMethod && operation.target.form === "structural-method" || operation.target.form === "constructor-value") &&
              rustCallableProtocol(operation.target.callableCarrier) !== undefined;
          const nativeInput = walk.context.callableValues.native.callFor(node);
          const generic = nativeInput === undefined &&
            rustGenericCallableValue(rustSourceCallCallableStorageCarrier(operation, walk.context.structuralShapes)) !== undefined;
          const invocation = generic ? genericInvocation(node) : undefined;
          // A body-less project contract member with no implementation in the program has no implementation that can
          // throw; its dispatch still needs its (infallible) invocation effects.
          const selectedContract = asSourceNode(walk.context.records.selectedCall.get(node)?.sourceDeclaration, walk.context.ast);
          const unimplementedContract = declaration === undefined && operation.target.form === "method" && selectedContract !== undefined &&
            selectedDeclarationIsProjectSource(walk, selectedContract) && ast.body(selectedContract) === undefined &&
            !projectImplementations.has(selectedContract);
          if (nativeInput === undefined && (nativeCallable || runtimeCallable || invocation !== undefined || declaration !== undefined ||
            unimplementedContract)) {
            const isAsync = hasCompletion(operation.resultCarrier);
            const unionBranches = operation.target.form === "union-method"
              ? operation.target.variants.map(variant => ({
                invocation: genericInvocationIsFallible(variant.declaration) ? "fallible" as const : "infallible" as const,
                awaiting: !isAsync ? "not-applicable" as const
                  : genericAwaitIsFallible(variant.declaration) ? "fallible" as const : "infallible" as const,
              }))
              : undefined;
            requireRustRecord(walk.context.requiredRecords, "sourceCallEffects", node,
              "source-call", "recordFallibilityFacts");
            walk.context.records.sourceCallEffectPlans.selected(node,
              invocation !== undefined ? invocation.effects.invocation
                : runtimeCallable || (unionBranches === undefined
                  ? declaration !== undefined && (operation.asyncBody?.maySuspend === false
                    ? isFallible(declaration) : genericInvocationIsFallible(declaration))
                  : unionBranches.some(branch => branch.invocation === "fallible"))
                ? "fallible"
                : "infallible",
              isAsync
                  ? invocation !== undefined ? invocation.effects.awaiting
                  : runtimeCallable || (unionBranches === undefined
                    ? declaration !== undefined && genericAwaitIsFallible(declaration)
                    : unionBranches.some(branch => branch.awaiting === "fallible")) ? "fallible" : "infallible"
                : "not-applicable", unionBranches);
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
  for (const subject of fallibleSubjects) {
    budget.step();
    requireRustRecord(walk.context.requiredRecords, "fallible", subject,
      "fallible-source", "recordFallibilityFacts");
    walk.context.records.fallibleSubjects.selected(subject);
  }
  for (const spawn of nativeTasks.spawns) {
    budget.step();
    const topology = rustAwaitSelection(walk.context.records.runtimeCarrier.get(spawn.operand)?.carrier, walk.context.typeDefinitions);
    const branches = topology === undefined ? [] : rustAwaitSelectionLeaves(topology).filter(branch =>
      branch.future !== undefined && rustFutureValueForSourceStorage(branch.carrier) === undefined);
    const source = selectRustAwaitSourceErrors(walk, spawn.operand, branches.map(branch => branch.carrier),
      declarationEffects, selectSourceErrors, budget);
    if (source.kind === "rejected") {
      appendRustDiagnostic(walk, "RUST_NATIVE_TASK_SOURCE_ERRORS_NOT_EXACT",
        `A native task requires its exact stored producer activations and existing deferred error correspondence. ${source.reason}`, spawn.node,
        ["target.capability=rust.native-tasks"]);
      return undefined;
    }
    const edges = source.branches;
    const selected = Object.freeze(edges.map(({ carrier, edge }) => Object.freeze({ carrier, edge })));
    awaitSourceEdges.set(spawn.node, selected);
    sourceErrorEdges.set(spawn.node, [...new Set(edges.map(source => source.edge))]);
  }
  const intrinsicEffects = new Map<Node, RustErrorEffectsFact>();
  for (const selections of [effectsByDeclaration, effectsByExpression, effectsByRegion, effectsByModule]) {
    for (const [subject, effects] of selections) {
      budget.step();
      const existing = intrinsicEffects.get(subject);
      if (existing !== undefined && !rustErrorEffectsEqual(existing, effects))
        throw new Error("One checked intrinsic effect subject cannot have contradictory completed source effects.");
      intrinsicEffects.set(subject, effects);
    }
  }
  return Object.freeze({ sourceErrors: selectSourceErrors, effectsFor: (subject: Node) => intrinsicEffects.get(subject),
    complete: createRustIntrinsicErrorEffectsPublication({ walk, budget, selectSourceErrors, effectsByDeclaration,
      effectsByModule, effectsByRegion, effectsByExpression, genericInvocations, completedInvocations,
      sourceErrorEdges, awaitSourceEdges, mergeEffects }),
  });
}
