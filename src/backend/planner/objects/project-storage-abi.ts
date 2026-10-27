import type { Node } from "@tsonic/tsts";
import type { RustVisibility } from "../../target-ast/syntax/nodes.js";
import type { RustNativeMemberVisibilityRecords } from "../../../target-model/records/native/native-member-names.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function rustProjectImplementationVisibility(
  publiclyReachable: boolean,
): RustVisibility {
  return publiclyReachable ? "public" : "crate";
}

export function rustProjectMemberStorageVisibility(
  records: RustNativeMemberVisibilityRecords,
  declaration: Node,
  publiclyReachable: boolean,
): RustVisibility {
  const selected = records.nativeMemberVisibility.get(declaration, publiclyReachable);
  if (selected === undefined) failRustPlannerInvariant("An admitted native member requires its sealed storage visibility.", declaration);
  return selected;
}
