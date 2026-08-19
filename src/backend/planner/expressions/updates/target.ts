import {
  KindElementAccessExpression,
  KindIdentifier,
  KindNumericLiteral,
  KindParenthesizedExpression,
  KindPropertyAccessExpression,
  ElementAccessExpression_ArgumentExpression,
  Node_Expression,
} from "@tsonic/target-api/source";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import { diagnosticInput, isValidRustIdentifier, rustSourceBindingPath } from "../../program/plan-context.js";
import { expressionCarrier } from "../fundamentals.js";
import { isRustCopyCarrier } from "../../../../policy/types/target-types.js";
import { isRustFinalizedSourceInput } from "../../../../analysis/facts/finalized-operation-abi.js";
import { missingFactDiagnostic } from "../../diagnostics.js";
import { mutateRustStoredObjectField } from "../../objects/project-storage.js";
import { planExpression } from "../entry.js";
import { planFinalizedTargetInput, planProviderOperationExpression } from "../conversions.js";
import { planRustNonConsumingValue, planRustSharedReceiver } from "../typed-locations.js";
import { readRustProjectDispatchedField, writeRustProjectDispatchedField } from "../../objects/project-objects.js";
import { rustSourceBindingFactKey, rustTargetOperationFactKey } from "../../../../analysis/facts/keys.js";
import { rustTargetOperationIsDirectLocation } from "../../../../analysis/facts/target-operation.js";
import { sourceFieldSelectedOperationMatches } from "../properties.js";
import type { Node } from "@tsonic/tsts";
import type { RustEffectiveExpressionOverride, RustPlanContext } from "../../program/plan-context.js";
import type { RustExpr } from "../../../rust-ast/nodes.js";
import type { RustFinalizedSourceInput } from "../../../../analysis/facts/finalized-operation-abi.js";
import type { RustTargetOperationFact } from "../../../../analysis/facts/keys.js";
import type { TargetTypeRef } from "../../../../policy/types/model.js";

export function planRustSourceFieldUpdate(
  operand: Node,
  fieldExpression: Node,
  field: Extract<RustTargetOperationFact, { readonly kind: "source-field" }>,
  update: Extract<RustTargetOperationFact, { readonly kind: "operator-token" }>,
  step: RustExpr,
  returnsPrevious: boolean,
  context: RustPlanContext,
): RustExpr | undefined {
  if (!sourceFieldSelectedOperationMatches(fieldExpression, field, context)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, fieldExpression),
      "rust.backend.source-field-selected-evidence",
      "Project-source field update conflicts with the TSTS-selected property fact.",
    ));
    return undefined;
  }
  const receiverNode = Node_Expression(context.input.ast, fieldExpression);
  const plannedReceiver = receiverNode === undefined ? undefined : planExpression(receiverNode, context);
  const receiver = receiverNode === undefined || plannedReceiver === undefined
    ? plannedReceiver
    : planRustSharedReceiver(receiverNode, plannedReceiver, context);
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
          valueForm: "value",
        });
        const target = operand === fieldExpression
          ? storage
          : planRustDirectUpdateTarget(operand, {
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
    return {
      kind: "block",
      bindings: [
        { name: receiverName, value: receiver },
        ...projection.bindings,
      ],
      value: mutation,
    };
  }
  const dispatchPlan = field.declaration === undefined
    ? undefined
    : context.input.projectFieldDispatch.planFor(field.declaration);
  if (dispatchPlan?.write === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, fieldExpression),
      "rust.backend.project-field-dispatch-plan",
      "Project-source field update has no exact finalized writable dispatch plan.",
    ));
    return undefined;
  }
  const dispatchRoles = {
    read: dispatchPlan.read,
    write: dispatchPlan.write,
    errorDomain: context.errorDomain,
  };
  const fieldName = allocateRustSyntheticName(context.syntheticNames, "update_field");
  const fieldPath: RustExpr = { kind: "path", path: fieldName };
  const overrides = new Map(context.expressionOverrides ?? []);
  overrides.set(fieldExpression, {
    expression: fieldPath,
    carrier: field.resultCarrier,
    valueForm: "value",
  });
  for (const override of projection.overrides) {
    overrides.set(override.node, override.value);
  }
  const target = operand === fieldExpression
    ? fieldPath
    : planRustDirectUpdateTarget(operand, {
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
  return {
    kind: "block",
    bindings: [
      { name: receiverName, value: receiver },
      {
        name: fieldName,
        mutable: true,
        value: readRustProjectDispatchedField(receiverPath, field.dispatch.read, {
          ...dispatchPlan.read,
          errorDomain: context.errorDomain,
        }),
      },
      ...projection.bindings,
      { name: resultName, value: updated },
    ],
    value: {
      kind: "evaluate-then",
      effect: writeRustProjectDispatchedField(
        receiverPath,
        allocateRustSyntheticName(context.syntheticNames, "dispatch_receiver"),
        field.dispatch.read,
        field.dispatch.write,
        "=",
        fieldPath,
        dispatchRoles,
      ),
      discard: "unit",
      value: { kind: "path", path: resultName },
    },
  };
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
  let current: Node | undefined = operand;
  while (current !== undefined) {
    const fact = context.input.facts.getFact(current, rustTargetOperationFactKey);
    if (fact?.kind === "source-field" || fact?.kind === "source-union-field") {
      return { expression: current, fact };
    }
    const kind = context.input.ast.kindName(current);
    if (kind !== KindPropertyAccessExpression && kind !== KindElementAccessExpression &&
      kind !== KindParenthesizedExpression) {
      return undefined;
    }
    current = Node_Expression(context.input.ast, current);
  }
  return undefined;
}

export function planRustUpdateProjectionArguments(
  operand: Node,
  fieldExpression: Node,
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
  const projections: Node[] = [];
  let current: Node | undefined = operand;
  while (current !== undefined && current !== fieldExpression) {
    projections.push(current);
    current = Node_Expression(context.input.ast, current);
  }
  if (current !== fieldExpression) {
    return undefined;
  }
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
  for (const projection of projections.reverse()) {
    if (context.input.ast.kindName(projection) !== KindElementAccessExpression) {
      continue;
    }
    const argument = ElementAccessExpression_ArgumentExpression(context.input.ast, projection);
    const carrier = argument === undefined ? undefined : expressionCarrier(argument, context);
    const operation = context.input.facts.getFact(projection, rustTargetOperationFactKey);
    const candidateTargetInput = operation?.kind === "provider-operation" &&
        operation.abi.target.form === "index" &&
        operation.abi.targetArguments.length === 1
      ? operation.abi.targetArguments[0]
      : undefined;
    const targetInput = candidateTargetInput !== undefined &&
        isRustFinalizedSourceInput(candidateTargetInput)
      ? candidateTargetInput
      : undefined;
    const value = argument === undefined
      ? undefined
      : targetInput === undefined
        ? planExpression(argument, context)
        : planFinalizedTargetInput(
            context,
            targetInput,
            Node_Expression(context.input.ast, projection),
            [argument],
            projection,
          );
    if (argument === undefined || carrier === undefined || value === undefined) {
      return undefined;
    }
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
): RustExpr | undefined {
  if (context.syntheticNames === undefined) {
    return undefined;
  }
  const locationName = allocateRustSyntheticName(context.syntheticNames, "update_location");
  const locationPath: RustExpr = { kind: "path", path: locationName };
  return planRustUpdateValue({
    locationBindings: [{ name: locationName, value: location }],
    read: { kind: "method-call", receiver: locationPath, method: "load", args: [] },
    write: (value) => ({
      kind: "method-call",
      receiver: locationPath,
      method: "store",
      args: [value],
    }),
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
    read: isRustCopyCarrier(update.resultCarrier)
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
    preserve && !isRustCopyCarrier(options.update.resultCarrier)
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
  return {
    kind: "block",
    bindings: [
      ...options.locationBindings,
      { name: previousName, value: options.read },
      { name: nextName, value: nextValue },
    ],
    value: {
      kind: "evaluate-then",
      effect: write,
      discard: "unit",
      value: options.returnsPrevious ? previous : next,
    },
  };
}

export function planRustDirectUpdateTarget(
  operand: Node,
  context: RustPlanContext,
  inputOverrides?: ReadonlyMap<RustFinalizedSourceInput, RustExpr>,
): RustExpr | undefined {
  const { ast } = context.input;
  if (ast.kindName(operand) === KindIdentifier) {
    const binding = context.input.facts.getFact(operand, rustSourceBindingFactKey);
    const path = binding === undefined ? undefined : rustSourceBindingPath(context, binding);
    return path !== undefined && isValidRustIdentifier(path) ? { kind: "path", path } : undefined;
  }
  const fact = context.input.facts.getFact(operand, rustTargetOperationFactKey);
  if (!rustTargetOperationIsDirectLocation(fact)) {
    return undefined;
  }
  if (fact?.kind === "provider-operation") {
    if (fact.abi.result.kind !== "sync" || fact.abi.result.conversion.kind !== "identity" ||
      fact.abi.effects.invocation !== "infallible" ||
      (fact.abi.target.form !== "field" && fact.abi.target.form !== "index")) {
      return undefined;
    }
    const receiver = Node_Expression(ast, operand);
    const argument = ast.kindName(operand) === KindElementAccessExpression
      ? ElementAccessExpression_ArgumentExpression(ast, operand)
      : undefined;
    return planProviderOperationExpression(
      context,
      fact,
      receiver,
      argument === undefined ? [] : [argument],
      operand,
      inputOverrides === undefined
        ? undefined
        : { sourceValues: new Map(), inputs: inputOverrides },
    );
  }
  if (fact?.kind !== "tuple-index" && fact?.kind !== "fixed-index") {
    return undefined;
  }
  const receiverNode = Node_Expression(ast, operand);
  const indexNode = ElementAccessExpression_ArgumentExpression(ast, operand);
  const plannedReceiver = receiverNode === undefined
    ? undefined
    : planExpression(receiverNode, context);
  const receiver = receiverNode === undefined || plannedReceiver === undefined
    ? undefined
    : planRustNonConsumingValue(receiverNode, plannedReceiver, context);
  if (receiver === undefined || indexNode === undefined) {
    return undefined;
  }
  const target: RustExpr = fact.kind === "tuple-index"
    ? { kind: "field", receiver, name: String(fact.index) }
    : {
        kind: "index",
        receiver,
        index: { kind: "int-literal", text: String(fact.index) },
      };
  if (ast.kindName(indexNode) === KindNumericLiteral) {
    return target;
  }
  const effect = planExpression(indexNode, context);
  return effect === undefined
    ? undefined
    : { kind: "evaluate-then", effect, discard: "value", value: target };
}
