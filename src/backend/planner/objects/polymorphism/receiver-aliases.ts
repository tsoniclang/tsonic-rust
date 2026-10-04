import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import type { RustExpr } from "../../../target-ast/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { cloneExpression, cloneField } from "./model.js";
import { rustProjectObjectDispatchField, rustProjectObjectIdentityField } from "../project-objects.js";

export function planRustReceiverAlias(
  receiver: RustExpr,
  receiverCarrier: TargetTypeRef,
  resultCarrier: TargetTypeRef,
  context: RustPlanContext,
  nativeRoot = false,
): RustExpr | undefined {
  const receiverDefinition = context.input.program.projectTypes.definitionForCarrier(receiverCarrier);
  const resultDefinition = context.input.program.projectTypes.definitionForCarrier(resultCarrier);
  const relation = resultDefinition === undefined ? undefined
    : context.input.program.projectTypes.relationship(receiverCarrier, resultDefinition);
  const resultType = rustTypeFromCarrierInContext(resultCarrier, context);
  if (receiverDefinition === undefined || relation?.kind !== "related" ||
    !rustTargetTypeRefEquals(relation.targetType, resultCarrier) || resultType?.kind !== "named") return undefined;
  if (!nativeRoot && rustTargetTypeRefEquals(receiverCarrier, resultCarrier)) return receiver;
  if (!context.input.program.projectTypes.isPolymorphic(receiverDefinition) ||
    !context.input.program.projectTypes.isPolymorphic(resultDefinition!)) return undefined;
  return { kind: "struct-literal", path: resultType.path, fields: [
    { name: rustProjectObjectIdentityField, value: cloneField(receiver, rustProjectObjectIdentityField) },
    { name: rustProjectObjectDispatchField, value: nativeRoot ? receiver : cloneExpression({
      kind: "field", receiver, name: rustProjectObjectDispatchField,
    }) },
  ] };
}
