import type { Node } from "@tsonic/tsts";
import { sourceDeclarationIsModuleScoped } from "@tsonic/target-api/source";
import type { TargetStageResult } from "@tsonic/target-api/artifacts";
import { rejectedTargetStage, resolvedTargetStage } from "@tsonic/target-api/artifacts";
import type { RustAnalysisContext } from "../program/context.js";
import type { RustFactWalk } from "../program/walk.js";
import { appendRustDiagnostic } from "../program/walk.js";
import type { RustModuleCycleSelection } from "../../target-model/records/module-initialization.js";
import { stronglyConnectedSourceFiles } from "../program/module-graph.js";
import { rustModuleInitializationIsStateIndependent } from "./independence.js";

export interface RustModuleCycleAnalysis {
  rejectActiveBinding(walk: RustFactWalk, declaration: Node): void;
  complete(): readonly RustModuleCycleSelection[];
}

export function analyzeRustModuleCycles(
  input: Pick<RustAnalysisContext, "ast" | "source" | "sourceFiles" | "records">,
): TargetStageResult<RustModuleCycleAnalysis> {
  const components = stronglyConnectedSourceFiles(input.source.navigation, new Set(input.sourceFiles));
  if (components.kind === "unresolved") return rejectedTargetStage([Object.freeze({
    code: "RUST_SOURCE_MODULE_GRAPH_NOT_PROVEN", category: "error", source: "tsonic-rust",
    message: components.reason, evidence: Object.freeze(["target.capability=rust.analysis.initialization-errors"]),
  })]);
  const cycles: RustModuleCycleSelection[] = [];
  for (const component of components.components) {
    const first = component[0];
    if (first === undefined || component.length === 1 && !input.source.navigation.moduleDependencies(first)
      .some(dependency => dependency.sourceFile === first)) continue;
    const names = component.map(file => input.ast.getFileName(file)).sort((left, right) => left.localeCompare(right, "en"));
    cycles.push(Object.freeze({ sourceFiles: Object.freeze([...component]), issue: Object.freeze({
      code: "RUST_UNSUPPORTED_RUNTIME_MODULE_CYCLE", category: "error", source: "tsonic-rust",
      sourceNode: first, message: `Runtime ES module dependency component '${names.join(" -> ")}' contains state-dependent module initialization and cannot be executed without finalized cyclic call, live-binding, and temporal-dead-zone evidence.`,
      evidence: Object.freeze(["target.capability=rust.analysis.initialization-errors"]),
    }) }));
  }
  const decisions = new Map<RustModuleCycleSelection, boolean>();
  const stateDependent = (cycle: RustModuleCycleSelection): boolean => {
    const selected = decisions.get(cycle);
    if (selected !== undefined) return selected;
    const members = new Set(cycle.sourceFiles);
    const dependent = !cycle.sourceFiles.every(file => rustModuleInitializationIsStateIndependent(input, file, members));
    decisions.set(cycle, dependent);
    return dependent;
  };
  let completed: readonly RustModuleCycleSelection[] | undefined;
  return resolvedTargetStage(Object.freeze({
    rejectActiveBinding(walk: RustFactWalk, declaration: Node): void {
      const { ast } = input;
      const sourceFile = ast.getSourceFile(declaration);
      if (sourceFile === undefined) return;
      const cycle = cycles.find(candidate => candidate.sourceFiles.includes(sourceFile));
      if (cycle === undefined || ![...walk.resolving].some(active => {
        const activeFile = ast.getSourceFile(active);
        return activeFile !== undefined && activeFile !== sourceFile && cycle.sourceFiles.includes(activeFile) &&
          ast.is.IsVariableDeclaration(active) && sourceDeclarationIsModuleScoped(active, ast);
      }) || !stateDependent(cycle)) return;
      if (!walk.context.diagnostics.some(issue => issue.code === cycle.issue.code && issue.sourceNode === cycle.issue.sourceNode))
        appendRustDiagnostic(walk, cycle.issue.code, cycle.issue.message, cycle.issue.sourceNode, cycle.issue.evidence);
    },
    complete(): readonly RustModuleCycleSelection[] {
      if (completed === undefined) completed = Object.freeze(cycles.filter(stateDependent));
      return completed;
    },
  }));
}
