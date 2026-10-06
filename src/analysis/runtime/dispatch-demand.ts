import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import { rustTargetOperationFactKey } from "../facts/keys.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { RustSourcePackageComponentClassifications } from "../program/source-package-components.js";
import type { AnalyzeRustDispatchContextResult, RustDispatchContextCatalog, RustDispatchContextComposition } from "./dispatch-contexts.js";

export interface RustDispatchContextDemandPlan {
  forComponent(componentId: string): RustDispatchContextComposition | undefined;
}

export function analyzeRustDispatchContextDemand(
  ast: AstReader,
  sourceFiles: readonly SourceFile[],
  facts: RustPlanQueries,
  components: RustSourcePackageComponentClassifications,
  catalog: RustDispatchContextCatalog,
): AnalyzeRustDispatchContextResult<RustDispatchContextDemandPlan> {
  const demand = new Map<string, Set<string>>();
  for (const sourceFile of sourceFiles) {
    const component = components.componentForFile(ast.getFileName(sourceFile));
    if (component === undefined) return rejected("Native dispatch demand has no exact source-package component.");
    const pending: Node[] = [sourceFile];
    while (pending.length > 0) {
      const node = pending.pop()!;
      const operation = facts.getFact(node, rustTargetOperationFactKey);
      if (operation?.kind === "provider-operation") {
        for (const input of operation.abi.dispatchInputs) {
          const selected = catalog.resolveInput({
            contextId: input.contextId, view: input.view,
            targetArgumentIndex: input.targetArgumentIndex, mode: input.mode,
          });
          if (selected === undefined || !rustTargetTypeRefEquals(selected.carrier, input.carrier)) {
            return rejected("Native dispatch input disagrees with its exact declaration owner.");
          }
          const selectedContexts = demand.get(component.componentId) ?? new Set<string>();
          selectedContexts.add(input.contextId);
          demand.set(component.componentId, selectedContexts);
        }
      }
      ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
    }
  }
  const plans = new Map<string, RustDispatchContextComposition>();
  for (const component of components.components) {
    const selected = catalog.compose([...(demand.get(component.componentId) ?? [])]);
    if (selected.kind === "rejected") return selected;
    plans.set(component.componentId, selected.plan);
  }
  return { kind: "resolved", plan: Object.freeze({
    forComponent: (componentId: string) => plans.get(componentId),
  }) };
}

function rejected(message: string): AnalyzeRustDispatchContextResult<never> {
  return { kind: "rejected", diagnostics: Object.freeze([{
    code: "RUST_DISPATCH_CONTEXT_DEMAND_INVALID", category: "error", source: "tsonic-rust", message,
    evidence: ["rust.runtime.dispatch-context-demand"],
  }]) };
}
