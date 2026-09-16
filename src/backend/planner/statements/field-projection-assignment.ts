import type { Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import type { RustExpr, RustStmt } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustAssignmentOperationPlan } from "./core.js";
import { planExpression, sourceFieldSelectedOperationMatches } from "../expressions/index.js";
import { findRustUpdateProjectField, planRustDirectStorage, planRustUpdateProjectionArguments } from "../expressions/updates/target.js";
import { planRustMutableProjectReceiver } from "../expressions/typed-locations.js";
import { mutateRustStoredObjectField } from "../objects/project-storage.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustCompoundAssignmentValue } from "./assignments.js";
import { rustArrayFieldMutationName } from "../objects/polymorphism/array-fields.js";

export function planRustFieldProjectionAssignment(
  left: Node,
  right: Node,
  assignment: RustAssignmentOperationPlan,
  context: RustPlanContext,
): readonly RustStmt[] | undefined {
  const field = findRustUpdateProjectField(left, context);
  if (field === undefined || field.expression === left || field.fact.kind !== "source-field" ||
    field.fact.valueSemantics.kind !== "stored" ||
    field.fact.resultCarrier.kind !== "array" || context.syntheticNames === undefined ||
    !sourceFieldSelectedOperationMatches(field.expression, field.fact, context)) return undefined;
  const rightEffects = context.input.program.sourceNavigation.expressionEffects(right);
  if (rightEffects.invokes || rightEffects.mutates || rightEffects.suspends) return undefined;
  let projectionNode: Node | undefined = left;
  while (projectionNode !== undefined && projectionNode !== field.expression) {
    const index = context.input.program.source.ast.as.AsElementAccessExpression(projectionNode)?.ArgumentExpression;
    if (index !== undefined) {
      const effects = context.input.program.sourceNavigation.expressionEffects(index);
      if (effects.invokes || effects.mutates || effects.suspends) return undefined;
    }
    projectionNode = Node_Expression(context.input.program.source.ast, projectionNode);
  }
  const receiverNode = Node_Expression(context.input.program.source.ast, field.expression);
  const plannedReceiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
  const projection = planRustUpdateProjectionArguments(left, field.expression, context);
  const value = planExpression(right, context);
  if (receiverNode === undefined || plannedReceiver === undefined || projection === undefined || value === undefined) return undefined;
  const ownerName = allocateRustSyntheticName(context.syntheticNames, "field_owner");
  const valueName = allocateRustSyntheticName(context.syntheticNames, "field_value");
  const dispatched = field.fact.dispatch !== undefined;
  const receiver = planRustMutableProjectReceiver(receiverNode, plannedReceiver, field.fact.receiverCarrier, context);
  const overrides = new Map(context.expressionOverrides ?? []);
  for (const override of projection.overrides) overrides.set(override.node, override.value);
  const mutate = (storage: RustExpr): RustExpr | undefined => {
    overrides.set(field.expression, { expression: storage, carrier: field.fact.resultCarrier, valueForm: "storage" });
    const selected = planRustDirectStorage(left, { ...context, expressionOverrides: overrides }, projection.inputOverrides);
    const takenValue: RustExpr = !dispatched
      ? { kind: "path", path: valueName }
      : { kind: "method-call", receiver: {
          kind: "method-call", receiver: { kind: "path", path: valueName }, method: "take", args: [],
        }, method: "expect", args: [{ kind: "str-literal", value: "field mutation consumes its value once" }] };
    const next = selected === undefined ? undefined : planRustCompoundAssignmentValue(assignment, selected,
      takenValue, left, context);
    return selected === undefined || next === undefined ? undefined : {
      kind: "assignment", operator: "=", target: selected, value: next,
    };
  };
  let mutation: RustExpr | undefined;
  if (field.fact.dispatch !== undefined) {
    const dispatch = field.fact.declaration === undefined ? undefined
      : context.input.program.projectFieldDispatch.planFor(field.fact.declaration);
    if (dispatch?.stored !== true || !dispatch.mutableContent) return undefined;
    const storageName = allocateRustSyntheticName(context.syntheticNames, "array_storage");
    const body = mutate({ kind: "path", path: storageName });
    mutation = body === undefined ? undefined : {
      kind: "method-call", receiver: { kind: "field", receiver: { kind: "path", path: ownerName }, name: "dispatch" },
      method: rustArrayFieldMutationName(field.fact.dispatch.read), args: [{
        kind: "reference", mutable: true, expr: { kind: "closure",
          params: [{ name: storageName, byRefCopy: false }], body,
        },
      }],
    };
  } else {
    mutation = mutateRustStoredObjectField(field.fact.storage, field.fact.receiverCarrier,
      { kind: "path", path: ownerName }, field.fact.storageIndex, mutate, context, "content");
  }
  return mutation === undefined ? undefined : [{ kind: "expr", expr: {
    kind: "block", bindings: [{ name: ownerName, value: receiver }, ...projection.bindings,
      { name: valueName, mutable: dispatched,
        value: dispatched ? { kind: "call", path: "Some", args: [value] } : value }], value: mutation,
  } }];
}
