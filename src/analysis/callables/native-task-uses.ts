import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant, rejectedTargetStage, resolvedTargetStage, type TargetStageResult } from "@tsonic/target-api/artifacts";
import type { RustAnalysisContext } from "../program/context.js";
import type { RustNativeTaskGraph, RustNativeTaskCompletion } from "./native-tasks.js";
import type { RustAnalyzedErrorRegions } from "../errors/regions.js";
import type { RustInitializationErrorRecords } from "../../target-model/records/error-regions.js";
import type { RustNativeCapturePlan } from "../../target-model/records/native-captures.js";
import type { RustNativeTaskUse, RustNativeTaskScope } from "../../target-model/records/native-tasks.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustRuntimeTaskScopeTargetType } from "../../target-model/types/carriers/runtime-carriers.js";
import { rustPlaceholderLifetime, type RustLifetimeRef } from "../../target-model/lifetimes/index.js";
import { allocateRustGeneratedName } from "../../target-model/names/generated.js";

export function publishRustNativeTaskUses(input: {
  readonly context: RustAnalysisContext;
  readonly graph: RustNativeTaskGraph;
  readonly completions: readonly RustNativeTaskCompletion[];
  readonly captures: RustNativeCapturePlan;
  readonly regions: RustAnalyzedErrorRegions;
  readonly initialization: RustInitializationErrorRecords;
}): TargetStageResult<undefined> {
  if (input.graph.spawns.length === 0) return resolvedTargetStage(undefined);
  const { context, graph } = input;
  const entry = input.initialization.entrySourceFile;
  if (entry === undefined || graph.lifecycleOwner === undefined) return rejectedTargetStage([{
    code: "RUST_NATIVE_TASK_LIFECYCLE_OWNER_MISSING", category: "error", source: "tsonic-rust",
    message: "Native task scope requires its checked executable lifecycle entry.", evidence: ["target.capability=rust.native-tasks"],
  }]);
  const names = new Set<string>();
  for (const node of context.nativeNodes) {
    const name = context.names.nameForDeclaration(node);
    const functionName = context.names.functionNameForDeclaration(node);
    if (name !== undefined) names.add(name);
    if (functionName !== undefined) names.add(functionName);
  }
  const errorCarrier = input.initialization.binary.lifecycle.carrier;
  const carrier = rustRuntimeTaskScopeTargetType(errorCarrier);
  const scope: RustNativeTaskScope = Object.freeze({ name: allocateRustGeneratedName(names, "native_task_scope"), carrier, errorCarrier });
  const borrow = (lifetime: RustLifetimeRef = rustPlaceholderLifetime): TargetTypeRef => Object.freeze({ kind: "reference", mutable: false, referent: carrier, lifetime });
  const owners = new Map<Node, Extract<RustNativeTaskUse, { readonly kind: "owner" }>>();
  for (const declaration of graph.owners) {
    let selected: Extract<RustNativeTaskUse, { readonly kind: "owner" }>;
    if (graph.capturedOwners.has(declaration)) {
      const captures = input.captures.forDeclaration(declaration);
      if (captures.kind !== "resolved" || captures.taskScope === undefined || captures.taskScope.lifecycleOwner !== graph.lifecycleOwner)
        failTargetAnalysisInvariant("tsonic-rust", "A native task owner requires its one preselected scope capture layout.", declaration);
      selected = captures.taskScope.storage === "owned"
        ? Object.freeze({ kind: "owner", scope, binding: "owned-capture", inputCarrier: carrier })
        : Object.freeze({ kind: "owner", scope, binding: "borrowed-capture", inputCarrier: borrow(captures.taskScope.lifetime) });
    } else {
      const retained = context.retainedEnvironments.environmentFor(declaration);
      if (retained.kind === "unresolved") return rejectedTargetStage([{
        code: "RUST_NATIVE_TASK_RETENTION_NOT_CLOSED", category: "error", source: "tsonic-rust", sourceNode: declaration,
        message: retained.reason, evidence: ["target.capability=rust.native-tasks"],
      }]);
      const owned = context.retainedEnvironments.ownsRetainedInputs(declaration);
      selected = Object.freeze({ kind: "owner", scope, binding: owned ? "owned-parameter" : "borrowed-parameter",
        inputCarrier: owned ? carrier : borrow(retained.kind === "selected" ? retained.environment.lifetime : rustPlaceholderLifetime) });
    }
    owners.set(declaration, selected);
    context.records.nativeTaskPlans.use(declaration, selected);
  }
  const initializer = graph.entries.includes(entry) ? Object.freeze({ inputCarrier: borrow(), passing: "borrow" as const }) : undefined;
  context.records.nativeTaskPlans.use(entry, Object.freeze({ kind: "entry", scope, inputCarrier: carrier, initializer }));
  for (const file of graph.entries) if (file !== entry)
    context.records.nativeTaskPlans.use(file, Object.freeze({ kind: "initializer", scope, inputCarrier: borrow(), passing: "borrow" }));
  for (const call of graph.calls) {
    const targets = call.targets.map(target => owners.get(target));
    if (targets.some(target => target === undefined) || targets.length === 0)
      failTargetAnalysisInvariant("tsonic-rust", "A native task call requires its complete selected target scope ABI.", call.node);
    const owned = targets.some(target => target?.binding === "owned-parameter");
    if (targets.some(target => target?.binding !== (owned ? "owned-parameter" : "borrowed-parameter")))
      return rejectedTargetStage([{ code: "RUST_NATIVE_TASK_CALL_ABI_NOT_CLOSED", category: "error", source: "tsonic-rust", sourceNode: call.node,
        message: "Native task call alternatives require one exact scope passing ABI.", evidence: ["target.capability=rust.native-tasks"] }]);
    context.records.nativeTaskPlans.use(call.node, Object.freeze({ kind: "call", scope, passing: owned ? "clone" : "borrow" }));
  }
  for (const spawn of input.completions) {
    const completion = input.regions.taskCompletionFor(spawn.node);
    if (completion === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "A native task requires its original completion with the selected lifecycle error transport.", spawn.node);
    context.records.nativeTaskPlans.use(spawn.node, Object.freeze({ kind: "spawn", scope, operand: spawn.operand, completion }));
  }
  return resolvedTargetStage(undefined);
}
