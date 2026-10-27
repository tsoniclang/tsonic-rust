import type { RustCheckedProjectProjectionPolicyInput } from "../../model/checked-project-projections.js";
import type { RustCheckedProjectProjectionEmission } from "../../../target-model/records/program/project-emission.js";

export function selectRustCheckedProjectProjection(input: RustCheckedProjectProjectionPolicyInput): RustCheckedProjectProjectionEmission | undefined {
  if (input.structural) return input.hasDispatch ? Object.freeze({ kind: "structural" }) : undefined;
  return input.project ? Object.freeze({ kind: input.lifetimeParameters ? "excluded" : "project" }) : undefined;
}
