import type { RustProjectFieldDispatchPlan } from "../../../analysis/project-types/field-dispatch.js";
import type { RustType } from "../../target-ast/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import {
  diagnosticInput,
  rustActiveErrorType,
  rustErrorBoundaryForProjectMember,
  rustErrorType,
  type RustPlanContext,
} from "../program/plan-context.js";

export type RustPlannedProjectFieldDispatchRole =
  | {
      readonly selfMode: "ref" | "rc";
      readonly fallible: false;
    }
  | {
      readonly selfMode: "ref" | "rc";
      readonly fallible: true;
      readonly resultErrorType: RustType;
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
  const resultErrorType = rustActiveErrorType(context);
  if (resultErrorType === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, plan.declaration),
      "rust.error.project-field-dispatch",
      "A fallible project field dispatch requires an exact enclosing error ABI.",
    ));
    return undefined;
  }
  const operandBoundary = rustErrorBoundaryForProjectMember(plan.declaration, context);
  if (operandBoundary === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, plan.declaration),
      "rust.backend.project-field-dispatch-error-boundary",
      "A fallible project field dispatch has no exact declaration-owned error ABI.",
    ));
    return undefined;
  }
  const operandErrorType = rustErrorType(operandBoundary);
  return {
    selfMode: selected.selfMode,
    fallible: true,
    resultErrorType,
    operandErrorType,
  };
}
