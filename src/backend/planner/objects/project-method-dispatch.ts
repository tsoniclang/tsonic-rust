import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { cloneRustExpression } from "../../target-ast/syntax/expressions.js";
import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
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
    failRustPlannerInvariant("Project method dispatch requires a finalized owner trait and hygienic-name scope.", subject);
  }
  const receiverName = allocateRustSyntheticName(
    context.syntheticNames,
    "dispatch_receiver",
  );
  // A receiver planned as the place behind a temporary pointer (`*match value.as_ref() { .. }`) binds that temporary
  // itself, not `&*temporary` (clippy::borrow_deref_ref); a pointer that is a place stays borrowed, so it is not moved.
  const borrowed: RustExpr = receiver.kind === "dereference" && receiver.pointer.kind !== "path" && receiver.pointer.kind !== "field"
    ? receiver.pointer : { kind: "reference", expr: receiver };
  return rustValueBlock([{ name: receiverName, value: borrowed }], {
      kind: "method-call",
      receiver: cloneRustExpression({
          kind: "field",
          receiver: { kind: "path", path: receiverName },
          name: rustProjectObjectDispatchField,
      }),
      receiverMode: "value",
      method: slot,
      args,
    });
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
    failRustPlannerInvariant("Exact project method dispatch has no finalized root receiver or owner trait.", subject);
  }
  return {
    kind: "associated-call",
    owner: { kind: "named", path: "Self" },
    trait,
    method: slot,
    args: [cloneRustExpression(root), ...args],
  };
}
