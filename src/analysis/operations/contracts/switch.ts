import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustSwitchComparison } from "../../../target-model/operations/switch.js";
import { isRustTargetTypeRef } from "../../../target-model/types/equality.js";
import { closedMetadataEquals } from "../../../target-model/metadata/closed-data.js";
import { selectRustSwitchComparison } from "../../../policy/operations/control-flow/switch.js";

export function rustSwitchComparisonMatches(
  left: TargetTypeRef,
  right: TargetTypeRef,
  comparison: RustSwitchComparison,
): boolean {
  if (!isRustTargetTypeRef(left) || !isRustTargetTypeRef(right)) return false;
  const selected = selectRustSwitchComparison(left, right);
  return selected !== undefined && closedMetadataEquals(selected, comparison);
}
