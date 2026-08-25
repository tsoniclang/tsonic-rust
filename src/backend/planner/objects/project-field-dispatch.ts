import type { RustProjectFieldDispatchPlan } from "../../../analysis/project-types/field-dispatch.js";
import type { RustReceiver, RustType } from "../../target-ast/nodes.js";
import { rustReferenceReceiver } from "../../target-ast/builders.js";
import { rustSharedSelfReceiver } from "./polymorphism/model.js";
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
      readonly receiver: RustReceiver;
      readonly fallible: false;
    }
  | {
      readonly receiver: RustReceiver;
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
  const fallible = plan.read.fallible || plan.write?.fallible === true;
  if (!fallible) {
    return {
      read: { receiver: projectFieldReceiver(plan.read), fallible: false },
      ...(plan.write === undefined
        ? {}
        : { write: { receiver: projectFieldReceiver(plan.write), fallible: false } }),
    };
  }
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
  const role = (
    value: RustProjectFieldDispatchPlan["read"],
  ): RustPlannedProjectFieldDispatchRole => value.fallible
      ? {
        receiver: projectFieldReceiver(value),
        fallible: true,
        resultErrorType,
        operandErrorType,
      }
    : { receiver: projectFieldReceiver(value), fallible: false };
  return {
    read: role(plan.read),
    ...(plan.write === undefined ? {} : { write: role(plan.write) }),
  };
}

export function projectFieldReceiver(
  role: RustProjectFieldDispatchPlan["read"],
): RustReceiver {
  return role.selfMode === "rc"
    ? rustSharedSelfReceiver()
    : rustReferenceReceiver(false);
}
