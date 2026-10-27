import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr, RustStmt } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustAssignmentOperationPlan } from "../../../target-model/records/operations/operator-selection.js";
import { planExpression } from "../expressions/index.js";
import { planRustDirectStorage, planRustUpdateProjectionArguments } from "../expressions/update-target.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planRustMutableProjectReceiver } from "../expressions/typed-locations.js";
import { mutateRustStoredObjectField } from "../objects/project-storage.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustCompoundAssignmentValue } from "./assignments.js";
import { rustArrayFieldMutationName } from "../objects/polymorphism/array-fields.js";

export function planRustFieldProjectionAssignment(
  expression: Node,
  left: Node,
  right: Node,
  assignment: RustAssignmentOperationPlan,
  context: RustPlanContext,
): readonly RustStmt[] {
  const selected = context.input.program.records.fieldProjectionAssignment.get(expression);
  if (selected === undefined || context.syntheticNames === undefined)
    failRustPlannerInvariant("An admitted field-projection write requires its sealed native field and name scope.", expression);
  const field = { expression: selected.expression, fact: selected.field };
  const receiverNode = selected.receiver;
  const plannedReceiver = planExpression(receiverNode, context);
  const projection = planRustUpdateProjectionArguments(left, field.expression, context);
  const value = planExpression(right, context);
  if (plannedReceiver === undefined || projection === undefined || value === undefined)
    failRustPlannerInvariant("An admitted field-projection write requires its native receiver, indices and value plans.", expression);
  const ownerName = allocateRustSyntheticName(context.syntheticNames, "field_owner");
  const valueName = allocateRustSyntheticName(context.syntheticNames, "field_value");
  const dispatched = field.fact.dispatch !== undefined;
  const receiver = planRustMutableProjectReceiver(receiverNode, plannedReceiver, field.fact.receiverCarrier, context);
  const overrides = new Map(context.expressionOverrides ?? []);
  for (const override of projection.overrides) overrides.set(override.node, override.value);
  const mutate = (storage: RustExpr): RustExpr | undefined => {
    overrides.set(field.expression, { expression: storage, carrier: field.fact.resultCarrier, valueForm: "storage", storageForm: "plain" });
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
  if (mutation === undefined) failRustPlannerInvariant("An admitted field-projection write requires its native mutation plan.", expression);
  return [{ kind: "expr", expr: rustValueBlock([{ name: ownerName, value: receiver }, ...projection.bindings,
      { name: valueName, mutable: dispatched,
        value: dispatched ? { kind: "call", path: "Some", args: [value] } : value }], mutation) }];
}
