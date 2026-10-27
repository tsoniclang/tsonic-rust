import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant, rejectedTargetStage, resolvedTargetStage, type TargetStageResult } from "@tsonic/target-api/artifacts";
import type { RustAnalysisContext } from "../../program/context.js";
import type { RustNativeTaskCompletion } from "./native-tasks.js";
import type { SourceNativeTaskGraph } from "@tsonic/target-api/analysis";
import type { RustAnalyzedErrorRegions } from "../../errors/regions.js";
import type { RustInitializationErrorRecords } from "../../../target-model/records/errors/error-regions.js";
import type { RustNativeTaskUse, RustNativeTaskScope } from "../../../target-model/records/native/native-tasks.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustRuntimeTaskScopeTargetType } from "../../../target-model/types/carriers/runtime-carriers.js";
import { rustPlaceholderLifetime, type RustLifetimeRef } from "../../../target-model/lifetimes/index.js";
import { allocateRustGeneratedName } from "../../../target-model/names/generated.js";

export function publishRustNativeTaskUses(input: {
  readonly context: RustAnalysisContext;
  readonly graph: SourceNativeTaskGraph;
  readonly completions: readonly RustNativeTaskCompletion[];
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
  if (graph.entries.some(file => file !== entry)) return rejectedTargetStage([{
    code: "RUST_NATIVE_TASK_CONTEXT_UNSUPPORTED", category: "error", source: "tsonic-rust",
    sourceNode: graph.entries.find(file => file !== entry),
    message: "Native task spawning requires a direct ordinary function or the executable entry; captured callables and module initializers are unsupported.",
    evidence: ["target.capability=rust.native-tasks"],
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
    const definition = context.projectTypes.definitionContainingDeclaration(declaration);
    const virtual = context.ast.is.IsMethodDeclaration(declaration) && !context.ast.hasModifierKind(declaration, "static") &&
      definition !== undefined && context.projectTypes.isPolymorphic(definition);
    if (!graph.parameterOwners.has(declaration) || context.records.generator.get(declaration) !== undefined || virtual ||
      context.ast.is.IsConstructorDeclaration(declaration) || context.ast.is.IsGetAccessorDeclaration(declaration) ||
      context.ast.is.IsSetAccessorDeclaration(declaration))
      return rejectedTargetStage([{ code: "RUST_NATIVE_TASK_CONTEXT_UNSUPPORTED", category: "error", source: "tsonic-rust",
        sourceNode: declaration, message: "Native task spawning requires a direct ordinary function or non-virtual concrete method; constructor, virtual, accessor, generator and captured contexts are unsupported.",
        evidence: ["target.capability=rust.native-tasks"] }]);
    const retained = context.retainedEnvironments.environmentFor(declaration);
    if (retained.kind === "unresolved") return rejectedTargetStage([{
      code: "RUST_NATIVE_TASK_RETENTION_NOT_CLOSED", category: "error", source: "tsonic-rust", sourceNode: declaration,
      message: retained.reason, evidence: ["target.capability=rust.native-tasks"],
    }]);
    const inputs = context.ast.hasModifierKind(declaration, "async") ? context.retainedEnvironments.inputsFor(declaration)
      : Object.freeze({ kind: "resolved" as const, ownership: "borrowed" as const });
    if (inputs.kind === "unresolved") return rejectedTargetStage([{
      code: "RUST_NATIVE_TASK_RETENTION_NOT_CLOSED", category: "error", source: "tsonic-rust", sourceNode: declaration,
      message: inputs.reason, evidence: ["target.capability=rust.native-tasks"],
    }]);
    const owned = inputs.ownership === "owned";
    const selected = Object.freeze({ kind: "owner" as const, scope, binding: owned ? "owned-parameter" as const : "borrowed-parameter" as const,
      inputCarrier: owned ? carrier : borrow(retained.kind === "selected" ? retained.environment.lifetime : rustPlaceholderLifetime) });
    owners.set(declaration, selected);
    context.records.nativeTaskPlans.use(declaration, selected);
  }
  const initializer = graph.entries.includes(entry) ? Object.freeze({ inputCarrier: borrow(), passing: "borrow" as const }) : undefined;
  context.records.nativeTaskPlans.use(entry, Object.freeze({ kind: "entry", scope, inputCarrier: carrier, initializer }));
  for (const call of graph.calls) {
    const operation = context.records.targetOperation.get(call.node);
    if (operation?.kind !== "source-call" || operation.target.form !== "function" && operation.target.form !== "static-method" &&
      (operation.target.form !== "method" || operation.target.dispatch !== undefined))
      return rejectedTargetStage([{ code: "RUST_NATIVE_TASK_CONTEXT_UNSUPPORTED", category: "error", source: "tsonic-rust",
        sourceNode: call.node, message: "Native task scope arguments require a direct ordinary function or non-virtual concrete method call.",
        evidence: ["target.capability=rust.native-tasks"] }]);
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
