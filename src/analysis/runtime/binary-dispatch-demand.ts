import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustBinaryHookPlan } from "./hooks.js";
import type { RustDispatchContextDemandPlan } from "./dispatch-demand.js";
import type { AnalyzeRustDispatchContextResult, RustDispatchContextAccess, RustDispatchContextCatalog } from "./dispatch-contexts.js";
import type { RustSourcePackageComponentClassifications } from "../program/source-package-components.js";
import { snapshotClosedMetadata } from "../../target-model/metadata/closed-data.js";
import type { RustDispatchContextGroupInput } from "../../target-model/operations/dispatch-contexts.js";

export interface RustBinaryDispatchComponent {
  readonly componentId: string;
  readonly children: readonly string[];
  readonly access?: RustDispatchContextAccess;
}

export interface RustBinaryDispatchGroup {
  readonly input: RustDispatchContextGroupInput;
  readonly components: readonly RustBinaryDispatchComponent[];
}

export interface RustBinaryDispatchDemandPlan {
  readonly linkedComponentIds: readonly string[];
  forHook(hookId: string): readonly RustBinaryDispatchGroup[] | undefined;
}

export function analyzeRustBinaryDispatchDemand(
  hooks: readonly RustBinaryHookPlan[],
  components: RustSourcePackageComponentClassifications,
  contexts: RustDispatchContextCatalog,
  demand: RustDispatchContextDemandPlan,
): AnalyzeRustDispatchContextResult<RustBinaryDispatchDemandPlan> {
  const rootId = components.rootComponentId;
  const order = [rootId];
  const visited = new Set(order);
  const children = new Map<string, readonly string[]>();
  for (let index = 0; index < order.length; index += 1) {
    const componentId = order[index]!;
    const component = components.forComponent(componentId);
    if (component === undefined) return rejected("Binary dispatch has no exact source-package component.");
    const selected: string[] = [];
    for (const childId of component.dependencyComponentIds) {
      if (components.forComponent(childId) === undefined) return rejected("Binary dispatch has an unknown source-package dependency.");
      if (!visited.has(childId)) {
        visited.add(childId);
        order.push(childId);
        selected.push(childId);
      }
    }
    children.set(componentId, Object.freeze(selected));
  }
  const linked = new Set<string>();
  const byHook = new Map<string, readonly RustBinaryDispatchGroup[]>();
  for (const hook of hooks) {
    const groups: RustBinaryDispatchGroup[] = [];
    for (const input of hook.dispatchGroups) {
      if (contexts.declaration(input.contextId) === undefined) return rejected("Binary dispatch selects an unavailable native context identity.");
      const selectedComponents = new Map<string, RustBinaryDispatchComponent>();
      const postorder: RustBinaryDispatchComponent[] = [];
      for (let index = order.length - 1; index >= 0; index -= 1) {
        const componentId = order[index]!;
        const selection = demand.forComponent(componentId);
        if (selection === undefined) return rejected("Binary dispatch has no sealed component context demand.");
        const access = selection.access(input.contextId);
        const selectedChildren = children.get(componentId)!.filter(childId => selectedComponents.has(childId));
        if (access === undefined && selectedChildren.length === 0) continue;
        const selected = snapshotClosedMetadata({ componentId, children: selectedChildren,
          ...(access === undefined ? {} : { access }) });
        selectedComponents.set(componentId, selected);
        postorder.push(selected);
        if (componentId !== rootId && (access !== undefined || components.forComponent(componentId)?.errorDomain === "project")) {
          linked.add(componentId);
        }
      }
      groups.push(Object.freeze({ input, components: Object.freeze(postorder) }));
    }
    byHook.set(hook.id, Object.freeze(groups));
  }
  return { kind: "resolved", plan: Object.freeze({
    linkedComponentIds: Object.freeze([...linked]),
    forHook: (hookId: string) => byHook.get(hookId),
  }) };
}

function rejected(message: string): AnalyzeRustDispatchContextResult<never> {
  const diagnostic: TargetDiagnostic = { code: "RUST_BINARY_DISPATCH_DEMAND_INVALID", category: "error",
    source: "tsonic-rust", message, evidence: ["rust.runtime.binary-dispatch-demand"] };
  return { kind: "rejected", diagnostics: Object.freeze([diagnostic]) };
}
