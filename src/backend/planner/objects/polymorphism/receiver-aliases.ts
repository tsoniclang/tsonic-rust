import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { failRustPlannerInvariant } from "../../../invariants.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import type { RustExpr } from "../../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { cloneRustExpression as cloneExpression } from "../../../target-ast/syntax/expressions.js";
import { cloneField } from "./model.js";
import { rustProjectObjectDispatchField, rustProjectObjectIdentityField } from "../project-objects.js";

export function planRustReceiverAlias(
  receiver: RustExpr,
  receiverCarrier: TargetTypeRef,
  resultCarrier: TargetTypeRef,
  context: RustPlanContext,
  nativeRoot = false,
): RustExpr | undefined {
  const selected = context.input.program.records.receiverAlias.get(receiverCarrier, resultCarrier);
  const resultType = rustTypeFromCarrierInContext(resultCarrier, context);
  if (selected === undefined || resultType?.kind !== "named") failRustPlannerInvariant("An admitted native receiver alias requires its exact sealed relationship and named target.", context.sourceFile);
  if (!nativeRoot && selected.same) return receiver;
  if (!selected.polymorphic) failRustPlannerInvariant("An admitted native root alias requires its sealed polymorphic relationship.", context.sourceFile);
  return renderRustReceiverAlias(receiver, resultType, nativeRoot);
}

export function renderRustReceiverAlias(
  receiver: RustExpr,
  resultType: Extract<import("../../../target-ast/syntax/nodes.js").RustType, { readonly kind: "named" }>,
  nativeRoot: boolean,
): RustExpr {
  return { kind: "struct-literal", path: resultType.path, fields: [
    { name: rustProjectObjectIdentityField, value: cloneField(receiver, rustProjectObjectIdentityField) },
    { name: rustProjectObjectDispatchField, value: nativeRoot ? receiver : cloneExpression({
      kind: "field", receiver, name: rustProjectObjectDispatchField,
    }) },
  ] };
}
