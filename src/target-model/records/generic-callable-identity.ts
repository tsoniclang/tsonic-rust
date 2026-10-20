import type { Node } from "@tsonic/tsts";
import type { RustGenericCallablePhysicalDefinition, RustGenericCallableIdentityComparison, RustGenericCallableIdentitySelection } from "./generic-callables.js";
import type { RustSourceCallableSpecializationIssue } from "./callable-issues.js";

export interface RustGenericCallableIdentityPlan {
  readonly issues: readonly RustSourceCallableSpecializationIssue[];
  forComparison(node: Node): RustGenericCallableIdentityComparison | undefined;
  forDefinition(definition: RustGenericCallablePhysicalDefinition): RustGenericCallableIdentitySelection | undefined;
}
