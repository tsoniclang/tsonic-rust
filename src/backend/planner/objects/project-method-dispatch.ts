import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { diagnosticInput } from "../program/plan-context.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { rustProjectObjectDispatchField } from "./project-objects.js";
import { rustProjectDispatchTraitType } from "./polymorphism/names.js";

export function planRustVirtualProjectMethodCall(
  subject: Node,
  receiver: RustExpr,
  ownerCarrier: TargetTypeRef,
  slot: string,
  args: readonly RustExpr[],
  context: RustPlanContext,
): RustExpr | undefined {
  if (context.syntheticNames === undefined ||
    rustProjectDispatchTraitType(ownerCarrier, context) === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, subject),
      "rust.backend.project-dispatch-temporary",
      "Project method dispatch requires a finalized owner trait and hygienic-name scope.",
    ));
    return undefined;
  }
  const receiverName = allocateRustSyntheticName(
    context.syntheticNames,
    "dispatch_receiver",
  );
  return {
    kind: "block",
    bindings: [{ name: receiverName, value: receiver }],
    value: {
      kind: "method-call",
      receiver: {
        kind: "method-call",
        receiver: {
          kind: "field",
          receiver: { kind: "path", path: receiverName },
          name: rustProjectObjectDispatchField,
        },
        method: "clone",
        args: [],
      },
      method: slot,
      args,
    },
  };
}

export function planRustExactProjectMethodCall(
  subject: Node,
  root: RustExpr | undefined,
  ownerCarrier: TargetTypeRef,
  slot: string,
  args: readonly RustExpr[],
  context: RustPlanContext,
): RustExpr | undefined {
  const trait = rustProjectDispatchTraitType(ownerCarrier, context);
  if (root === undefined || trait === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, subject),
      "rust.backend.project-exact-dispatch",
      "Exact project method dispatch has no finalized root receiver or owner trait.",
    ));
    return undefined;
  }
  return {
    kind: "associated-call",
    owner: { kind: "named", path: "Self" },
    trait,
    method: slot,
    args: [{
      kind: "method-call",
      receiver: root,
      method: "clone",
      args: [],
    }, ...args],
  };
}
