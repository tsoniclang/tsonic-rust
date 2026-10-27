import type { Node, SourceFile } from "@tsonic/tsts";
import { appendRustDiagnostic, type RustFactWalk } from "../../walk.js";
import { requireRustRecord } from "../objects/required-records.js";
import type { RustErrorEffectsFact } from "../../../../target-model/records/errors/error-effects.js";
import type { RustSourceErrorEffectEdge } from "../../../../target-model/records/errors/source-error-effects.js";
import type { RustAwaitSourceErrorBranch } from "../../../../target-model/records/callables/await-source-error-effects.js";
import type { RustSourceGenericCallableInvocation } from "../../../errors/generic-call-errors.js";
import type { RustSourceErrorEffectSelection } from "../../../errors/source-error-effects.js";
import type { RustEffectsWorkBudget } from "../../../errors/effects-work-budget.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";

export function createRustIntrinsicErrorEffectsPublication(input: {
  readonly walk: RustFactWalk;
  readonly budget: RustEffectsWorkBudget;
  readonly selectSourceErrors: RustSourceErrorEffectSelection;
  readonly effectsByDeclaration: ReadonlyMap<Node, RustErrorEffectsFact>;
  readonly effectsByModule: ReadonlyMap<SourceFile, RustErrorEffectsFact>;
  readonly effectsByRegion: ReadonlyMap<Node, RustErrorEffectsFact>;
  readonly effectsByExpression: ReadonlyMap<Node, RustErrorEffectsFact>;
  readonly genericInvocations: ReadonlyMap<Node, RustSourceGenericCallableInvocation>;
  readonly completedInvocations: Map<Node, ReturnType<RustSourceGenericCallableInvocation["complete"]>>;
  readonly sourceErrorEdges: ReadonlyMap<Node, readonly RustSourceErrorEffectEdge[]>;
  readonly awaitSourceEdges: ReadonlyMap<Node, readonly RustAwaitSourceErrorBranch[]>;
  readonly mergeEffects: (effects: readonly RustErrorEffectsFact[]) => RustErrorEffectsFact | undefined;
}): () => void {
  const { walk, budget, selectSourceErrors, effectsByDeclaration, effectsByModule, effectsByRegion,
    effectsByExpression, genericInvocations, completedInvocations, sourceErrorEdges, awaitSourceEdges, mergeEffects } = input;
  let published = false;
  return (): void => {
      if (published) throw new Error("Rust intrinsic error applications publish exactly once after physical binding.");
      const failure = budget.run(() => {
        const physical = walk.context.callableValues.nativeStorage;
        const completeError = (error: RustErrorEffectsFact["nativeErrors"][number]) => selectSourceErrors.complete(error, physical);
        const completedEdges = new Map<RustSourceErrorEffectEdge, RustSourceErrorEffectEdge>();
        const completeEffects = (effects: RustErrorEffectsFact): RustErrorEffectsFact => {
          const errors = effects.nativeErrors.map(completeError);
          const selected = errors.some(error => error === undefined) ? undefined : mergeEffects([{ localErrors: effects.localErrors,
            nativeErrors: errors as RustErrorEffectsFact["nativeErrors"] }]);
          if (selected === undefined) throw new Error("Rust pending intrinsic effects lost their exact physical payload correspondence.");
          return selected;
        };
        const completeEdge = (edge: RustSourceErrorEffectEdge): RustSourceErrorEffectEdge => {
          const previous = completedEdges.get(edge);
          if (previous !== undefined) return previous;
          const errors = edge.nativeErrors.map(channel => ({ source: completeError(channel.source), target: completeError(channel.target) }));
          if (errors.some(channel => channel.source === undefined || channel.target === undefined))
            throw new Error("Rust pending source error edge lost its exact physical payload correspondence.");
          const channels = new Map<string, RustSourceErrorEffectEdge["nativeErrors"][number]>();
          for (const channel of errors as RustSourceErrorEffectEdge["nativeErrors"]) {
            const previous = channels.get(channel.source.identity);
            if (previous !== undefined && (!rustTargetTypeRefEquals(previous.source.errorType, channel.source.errorType) ||
              previous.target.identity !== channel.target.identity || !rustTargetTypeRefEquals(previous.target.errorType, channel.target.errorType)))
              throw new Error("Rust final source error channels require one exact source-to-target correspondence.");
            channels.set(channel.source.identity, channel);
          }
          const selected = Object.freeze({ ...edge, effects: completeEffects(edge.effects), nativeErrors: Object.freeze([...channels.values()]) });
          completedEdges.set(edge, selected);
          return selected;
        };
        for (const [declaration, effects] of effectsByDeclaration) {
          requireRustRecord(walk.context.requiredRecords, "errorEffects", declaration, "source-callable", "recordFallibilityFacts");
          walk.context.records.errorEffectPlans.selected(declaration, completeEffects(effects));
        }
        for (const [sourceFile, effects] of effectsByModule) {
          requireRustRecord(walk.context.requiredRecords, "errorEffects", sourceFile, "module", "recordFallibilityFacts");
          walk.context.records.errorEffectPlans.selected(sourceFile, completeEffects(effects));
        }
        for (const [region, effects] of effectsByRegion) {
          budget.metadata(effects);
          requireRustRecord(walk.context.requiredRecords, "errorEffects", region,
            "error-region", "recordFallibilityFacts");
          walk.context.records.errorEffectPlans.selected(region, completeEffects(effects));
        }
        for (const [node, invocation] of genericInvocations) {
          if (!completedInvocations.has(node)) completedInvocations.set(node, invocation.complete(walk.context));
          const selected = completedInvocations.get(node)?.selection;
          if (selected === undefined) throw new Error("Rust generic invocation publication requires its final physical application.");
          budget.metadata(selected);
          requireRustRecord(walk.context.requiredRecords, "genericCallableInvocation", node,
            "generic-invocation", "recordFallibilityFacts");
          walk.context.records.genericCallableInvocations.selected(node, selected);
        }
        for (const [node, effects] of effectsByExpression) {
          budget.metadata(effects);
          requireRustRecord(walk.context.requiredRecords, "errorEffects", node,
            "expression", "recordFallibilityFacts");
          walk.context.records.errorEffectPlans.selected(node, completeEffects(effects));
        }
        for (const node of walk.preparedCallbackCalls.keys()) {
          budget.step();
          const attempt = walk.operationAttempts.get(node);
          if (attempt?.kind !== "checked-call" || attempt.prepared === undefined) continue;
          const callback = attempt.prepared.callbackEffects;
          const invocationEffects = completeEffects(callback.invocationEffects);
          const implementationEffects = completeEffects(callback.implementationEffects);
          budget.metadata(invocationEffects);
          budget.metadata(implementationEffects);
          walk.operationAttempts.set(node, { ...attempt, prepared: Object.freeze({ ...attempt.prepared,
            callbackEffects: Object.freeze({ invocationOwner: callback.invocationOwner, invocationEffects, implementationEffects }),
          }) });
        }
        for (const [node, edges] of sourceErrorEdges) {
          budget.step();
          for (const edge of edges) {
            budget.metadata(edge.effects);
            budget.metadata(edge.nativeErrors);
          }
          requireRustRecord(walk.context.requiredRecords, "sourceErrorEffects", node,
            "source-invocation", "recordFallibilityFacts");
          walk.context.records.sourceErrorEdges.invocation(node, Object.freeze(edges.map(completeEdge)));
        }
        for (const [node, branches] of awaitSourceEdges) {
          requireRustRecord(walk.context.requiredRecords, "awaitSourceErrorEffects", node,
            "await", "recordFallibilityFacts");
          walk.context.records.awaitSourceErrors.selected(node, Object.freeze(branches.map(branch => Object.freeze({ ...branch, edge: completeEdge(branch.edge) }))));
        }
      });
      if (failure !== undefined) appendRustDiagnostic(walk, failure.code, failure.message, undefined,
        ["target.capability=rust.native-error.bounded-effects"]);
      published = true;
  };
}
