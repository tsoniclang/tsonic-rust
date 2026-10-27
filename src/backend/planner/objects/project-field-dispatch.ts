import type { RustProjectFieldDispatchPlan } from "../../../target-model/records/storage/field-writes.js";
import type { RustType } from "../../target-ast/syntax/nodes.js";
import { rustLocalErrorOwner, type RustFallibleBoundary, rustErrorType } from "../program/fallible-boundaries.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { rustErrorBoundaryForProjectMember, type RustPlanContext } from "../program/plan-context.js";

export type RustPlannedProjectFieldDispatchRole =
  | {
      readonly selfMode: "ref" | "rc";
      readonly fallible: false;
    }
  | {
      readonly selfMode: "ref" | "rc";
      readonly fallible: true;
      readonly region: RustFallibleBoundary;
      readonly operandErrorType: RustType;
    };

export interface RustPlannedProjectFieldDispatchRoles {
  readonly read: RustPlannedProjectFieldDispatchRole;
  readonly write?: RustPlannedProjectFieldDispatchRole;
}

export function planRustProjectFieldDispatchRoles(
  plan: RustProjectFieldDispatchPlan,
  context: RustPlanContext,
): RustPlannedProjectFieldDispatchRoles | undefined {
  const read = planRustProjectFieldDispatchRole(plan, "read", context);
  const write = plan.write === undefined ? undefined : planRustProjectFieldDispatchRole(plan, "write", context);
  return read === undefined || plan.write !== undefined && write === undefined
    ? undefined : { read, ...(write === undefined ? {} : { write }) };
}

export function planRustProjectFieldDispatchRole(
  plan: RustProjectFieldDispatchPlan,
  access: "read" | "write",
  context: RustPlanContext,
): RustPlannedProjectFieldDispatchRole | undefined {
  const selected = plan[access];
  if (selected === undefined) return undefined;
  if (!selected.fallible) return { selfMode: selected.selfMode, fallible: false };
  const region = context.fallibleBoundary;
  if (region === undefined || rustLocalErrorOwner(region) === undefined) {
    failRustPlannerInvariant("An admitted fallible project field dispatch requires its exact enclosing error ABI.", plan.declaration);
  }
  const operandBoundary = rustErrorBoundaryForProjectMember(plan.declaration, context);
  if (operandBoundary === undefined) {
    failRustPlannerInvariant("An admitted fallible project field dispatch requires its exact declaration-owned error ABI.", plan.declaration);
  }
  const operandErrorType = rustErrorType(operandBoundary);
  return {
    selfMode: selected.selfMode,
    fallible: true,
    region,
    operandErrorType,
  };
}
