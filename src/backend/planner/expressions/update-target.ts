import { rustValueBlock } from "../../target-ast/syntax/value-block.js";
import { Node_Expression } from "@tsonic/target-api/source";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { rustCarrierHasCopyContract } from "../types/generic-requirements.js";
import { mutateRustStoredObjectField } from "../objects/project-storage.js";
import { planExpression } from "./entry.js";
import { planFinalizedTargetInput, planProviderOperationExpression } from "./conversions.js";
import { planRustMutableProjectReceiver } from "./typed-locations.js";
import { readRustProjectDispatchedField, writeRustProjectDispatchedField } from "../objects/project-objects.js";
import { planRustProjectFieldDispatchRoles } from "../objects/project-field-dispatch.js";

import type { Node } from "@tsonic/tsts";
import type { RustEffectiveExpressionOverride, RustPlanContext } from "../program/plan-context.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustFinalizedSourceInput } from "../../../target-model/records/operations/finalized-operation.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { planRustDirectStorageCore } from "./update-direct-storage.js";

export function planRustSourceFieldUpdate(
  operand: Node,
  fieldExpression: Node,
  field: Extract<RustTargetOperationFact, { readonly kind: "source-field" }>,
  update: Extract<RustTargetOperationFact, { readonly kind: "operator-token" }>,
  step: RustExpr,
  returnsPrevious: boolean,
  context: RustPlanContext,
): RustExpr | undefined {
  if (!(context.input.program.records.admittedField.get(fieldExpression) === field)) {
    failRustPlannerInvariant("An admitted project field update requires its sealed source field.", fieldExpression);
  }
  const receiverNode = Node_Expression(context.input.program.source.ast, fieldExpression);
  const plannedReceiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
  const receiver = receiverNode === undefined || plannedReceiver === undefined
    ? plannedReceiver
    : planRustMutableProjectReceiver(
        receiverNode,
        plannedReceiver,
        field.receiverCarrier,
        context,
      );
  if (receiver === undefined || context.syntheticNames === undefined) {
    return undefined;
  }
  const receiverName = allocateRustSyntheticName(context.syntheticNames, "update_receiver");
  const receiverPath: RustExpr = { kind: "path", path: receiverName };
  const projection = planRustUpdateProjectionArguments(
    operand,
    fieldExpression,
    context,
  );
  if (projection === undefined) {
    return undefined;
  }
  if (field.dispatch === undefined) {
    const overrides = new Map(context.expressionOverrides ?? []);
    for (const override of projection.overrides) {
      overrides.set(override.node, override.value);
    }
    const mutate = (storage: RustExpr): RustExpr | undefined => {
        overrides.set(fieldExpression, {
          expression: storage,
          carrier: field.resultCarrier,
          valueForm: "storage", storageForm: "plain",
        });
        const target = operand === fieldExpression
          ? storage
          : planRustDirectStorage(operand, {
              ...context,
              expressionOverrides: overrides,
            }, projection.inputOverrides);
        return target === undefined
          ? undefined
          : planRustBorrowedUpdateLocation(
              target,
              update,
              step,
              returnsPrevious,
              context,
            );
    };
    const mutation = mutateRustStoredObjectField(
      field.storage,
      field.receiverCarrier,
      receiverPath,
      field.storageIndex,
      mutate,
      context,
    );
    if (mutation === undefined) {
      return undefined;
    }
    return rustValueBlock([
        { name: receiverName, value: receiver },
        ...projection.bindings,
      ], mutation);
  }
  const dispatchPlan = field.declaration === undefined
    ? undefined
    : context.input.program.records.projectFieldDispatch.get(field.declaration);
  if (dispatchPlan?.write === undefined) {
    failRustPlannerInvariant("An admitted project field update requires its sealed writable dispatch plan.", fieldExpression);
  }
  const dispatchRoles = planRustProjectFieldDispatchRoles(dispatchPlan, context);
  if (dispatchRoles?.write === undefined) {
    return undefined;
  }
  const fieldName = allocateRustSyntheticName(context.syntheticNames, "update_field");
  const fieldPath: RustExpr = { kind: "path", path: fieldName };
  const overrides = new Map(context.expressionOverrides ?? []);
  overrides.set(fieldExpression, {
    expression: fieldPath,
    carrier: field.resultCarrier,
    valueForm: "storage", storageForm: "plain",
  });
  for (const override of projection.overrides) {
    overrides.set(override.node, override.value);
  }
  const target = operand === fieldExpression
    ? fieldPath
    : planRustDirectStorage(operand, {
        ...context,
        expressionOverrides: overrides,
      }, projection.inputOverrides);
  if (target === undefined) {
    return undefined;
  }
  const updated = planRustBorrowedUpdateLocation(
    target,
    update,
    step,
    returnsPrevious,
    context,
  );
  if (updated === undefined) {
    return undefined;
  }
  const resultName = allocateRustSyntheticName(context.syntheticNames, "update_result");
  const read = readRustProjectDispatchedField(receiverPath, field.dispatch.read, dispatchRoles.read);
  const write = writeRustProjectDispatchedField(receiverPath,
    allocateRustSyntheticName(context.syntheticNames, "dispatch_receiver"), field.dispatch.read,
    field.dispatch.write, "=", fieldPath, { read: dispatchRoles.read, write: dispatchRoles.write });
  if (read === undefined || write === undefined) return undefined;
  return rustValueBlock([
      { name: receiverName, value: receiver },
      {
        name: fieldName,
        mutable: true,
        value: read,
      },
      ...projection.bindings,
      { name: resultName, value: updated },
    ], {
      kind: "evaluate-then",
      effect: write,
      discard: "unit",
      value: { kind: "path", path: resultName },
    });
}

export function findRustUpdateProjectField(
  operand: Node,
  context: RustPlanContext,
): {
  readonly expression: Node;
  readonly fact: Extract<
    RustTargetOperationFact,
    { readonly kind: "source-field" | "source-union-field" }
  >;
} | undefined {
  const selected = context.input.program.records.updateProjectField.get(operand);
  if (selected === undefined) failRustPlannerInvariant("An admitted update requires its sealed source field query.", operand);
  return selected === null ? undefined : selected;
}

export function planRustUpdateProjectionArguments(
  operand: Node,
  fieldExpression: Node | undefined,
  context: RustPlanContext,
): {
  readonly bindings: readonly { readonly name: string; readonly value: RustExpr }[];
  readonly overrides: readonly {
    readonly node: Node;
    readonly value: RustEffectiveExpressionOverride;
  }[];
  readonly inputOverrides: ReadonlyMap<RustFinalizedSourceInput, RustExpr>;
} | undefined {
  if (context.syntheticNames === undefined) {
    return undefined;
  }
  const plan = context.input.program.records.updateProjection.get(operand)
    ?? failRustPlannerInvariant("An admitted update projection requires its sealed ordered native arguments.", operand);
  const offset = fieldExpression === undefined ? plan.complete ? 0 : undefined : plan.fieldOffsets.get(fieldExpression);
  if (offset === undefined)
    failRustPlannerInvariant("An admitted update projection requires its exact native argument boundary.", operand);
  const bindings: { name: string; value: RustExpr }[] = [];
  const overrides: {
    node: Node;
    value: {
      expression: RustExpr;
      carrier: TargetTypeRef;
      valueForm: "value";
    };
  }[] = [];
  const inputOverrides = new Map<RustFinalizedSourceInput, RustExpr>();
  for (const projection of plan.arguments.slice(offset)) {
    const { argument, carrier, targetInput } = projection;
    const value = targetInput === undefined
        ? planExpression(argument, context)
        : planFinalizedTargetInput(
            context,
            targetInput,
            projection.receiver,
            [argument],
            projection.projection,
          );
    if (value === undefined) failRustPlannerInvariant("An admitted update projection requires its native index argument.", argument);
    const name = allocateRustSyntheticName(context.syntheticNames, "update_index");
    bindings.push({ name, value });
    if (targetInput !== undefined) {
      inputOverrides.set(targetInput, { kind: "path", path: name });
      continue;
    }
    overrides.push({
      node: argument,
      value: {
        expression: { kind: "path", path: name },
        carrier,
        valueForm: "value",
      },
    });
  }
  return { bindings, overrides, inputOverrides };
}

export function planRustOwnedUpdateLocation(
  location: RustExpr,
  update: Extract<RustTargetOperationFact, { readonly kind: "operator-token" }>,
  step: RustExpr,
  returnsPrevious: boolean,
  context: RustPlanContext,
  methods: Pick<import("./binding-storage.js").RustBindingStorageOperations, "read" | "write">,
): RustExpr | undefined {
  if (context.syntheticNames === undefined) {
    return undefined;
  }
  const locationName = allocateRustSyntheticName(context.syntheticNames, "update_location");
  const locationPath: RustExpr = { kind: "path", path: locationName };
  return planRustUpdateValue({
    locationBindings: [{ name: locationName, value: location }],
    read: methods.read(locationPath),
    write: (value) => methods.write(locationPath, value),
    update,
    step,
    returnsPrevious,
    context,
  });
}

export function planRustBorrowedUpdateLocation(
  target: RustExpr,
  update: Extract<RustTargetOperationFact, { readonly kind: "operator-token" }>,
  step: RustExpr,
  returnsPrevious: boolean,
  context: RustPlanContext,
): RustExpr | undefined {
  if (context.syntheticNames === undefined) {
    return undefined;
  }
  const locationName = allocateRustSyntheticName(context.syntheticNames, "update_location");
  const locationPath: RustExpr = { kind: "path", path: locationName };
  const dereference: RustExpr = { kind: "dereference", pointer: locationPath };
  return planRustUpdateValue({
    locationBindings: [{
      name: locationName,
      value: { kind: "reference", expr: target, mutable: true },
    }],
    read: rustCarrierHasCopyContract(update.resultCarrier, context)
      ? dereference
      : { kind: "method-call", receiver: dereference, method: "clone", args: [] },
    write: (value) => ({
      kind: "assignment",
      operator: "=",
      target: dereference,
      value,
    }),
    update,
    step,
    returnsPrevious,
    context,
  });
}

export function planRustUpdateValue(options: {
  readonly locationBindings: readonly { readonly name: string; readonly value: RustExpr }[];
  readonly read: RustExpr;
  readonly write: (value: RustExpr) => RustExpr | undefined;
  readonly update: Extract<RustTargetOperationFact, { readonly kind: "operator-token" }>;
  readonly step: RustExpr;
  readonly returnsPrevious: boolean;
  readonly context: RustPlanContext;
}): RustExpr | undefined {
  if (options.context.syntheticNames === undefined ||
    (options.update.operator !== "+=" && options.update.operator !== "-=")) {
    return undefined;
  }
  const previousName = allocateRustSyntheticName(options.context.syntheticNames, "update_previous");
  const nextName = allocateRustSyntheticName(options.context.syntheticNames, "update_next");
  const previous: RustExpr = { kind: "path", path: previousName };
  const next: RustExpr = { kind: "path", path: nextName };
  const reusable = (value: RustExpr, preserve: boolean): RustExpr =>
    preserve && !rustCarrierHasCopyContract(options.update.resultCarrier, options.context)
      ? { kind: "method-call", receiver: value, method: "clone", args: [] }
      : value;
  const nextValue: RustExpr = {
    kind: "binary",
    operator: options.update.operator === "+=" ? "+" : "-",
    left: reusable(previous, options.returnsPrevious),
    right: options.step,
  };
  const write = options.write(reusable(next, !options.returnsPrevious));
  if (write === undefined) {
    return undefined;
  }
  return rustValueBlock([
      ...options.locationBindings,
      { name: previousName, value: options.read },
      { name: nextName, value: nextValue },
    ], {
      kind: "evaluate-then",
      effect: write,
      discard: "unit",
      value: options.returnsPrevious ? previous : next,
    });
}

export function planRustDirectStorage(
  operand: Node,
  context: RustPlanContext,
  inputOverrides?: ReadonlyMap<RustFinalizedSourceInput, RustExpr>,
): RustExpr | undefined {
  return planRustDirectStorageCore(
    operand,
    context,
    inputOverrides,
    planExpression,
    planProviderOperationExpression,
  );
}
