import type { Node } from "@tsonic/tsts";
import type { RustGenericCallablePhysicalDefinition, RustGenericCallableIdentityComparison, RustGenericCallableIdentitySelection } from "../../../../target-model/records/callables/generic-callables.js";
import type { RustSourceCallableSpecializationIssue } from "../../../../target-model/records/callables/callable-issues.js";
import type { RustGenericCallableIdentityPlan } from "../../../../target-model/records/callables/generic-callable-identity.js";

export function sealRustGenericCallableIdentityPlan(comparisons: ReadonlyMap<Node, RustGenericCallableIdentityComparison>,
  definitions: ReadonlyMap<RustGenericCallablePhysicalDefinition, RustGenericCallableIdentitySelection>,
  issues: readonly RustSourceCallableSpecializationIssue[]): RustGenericCallableIdentityPlan {
  const byComparison = new WeakMap(comparisons);
  const byDefinition = new Map(definitions);
  return Object.freeze({ issues: Object.freeze([...issues]), forComparison: (node: Node) => byComparison.get(node),
    forDefinition: (definition: RustGenericCallablePhysicalDefinition) => byDefinition.get(definition) });
}
