import type { Node } from "@tsonic/tsts";
import type { RustFinalizedSourceInput } from "../../../target-model/records/finalized-operation.js";

import type { RustArgumentMode } from "../../../target-model/operations/model.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { failRustPlannerInvariant } from "../../invariants.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planExpression } from "./entry.js";
import { planRustSharedReceiver } from "./typed-locations.js";
import { rustErrorFieldSharedView, rustErrorFieldComparisonView } from "./error-field-borrows.js";
import { planArrayLiteral } from "./array-literals/planning.js";

export function planRustCallArguments(
  node: Node,
  context: RustPlanContext,
  planArgument: (argument: Node, context: RustPlanContext) => RustExpr | undefined = planExpression,
): readonly RustExpr[] | undefined {
  const arguments_: RustExpr[] = [];
  for (const argument of context.input.program.source.ast.arguments(node)) {
    if (argument === undefined) {
      return failRustPlannerInvariant("Call expression contains an undefined argument slot.", node);
    }
    const planned = planArgument(argument, context);
    if (planned === undefined) {
      return undefined;
    }
    arguments_.push(planned);
  }
  return arguments_;
}

export function applyRustArgumentMode(
  context: RustPlanContext,
  argument: RustExpr,
  mode: RustArgumentMode,
  node: Node | undefined,
): RustExpr {
  if (mode === "ref") {
    return createRustSharedReferenceArgument(context, argument, node);
  }
  if (mode === "mut-ref") {
    const sourceParameterAbi = node === undefined
      ? undefined
      : context.input.program.records.sourceParameterAbi.get(node);
    return sourceParameterAbi?.mode === "mut-ref"
      ? argument
      : createRustMutableReferenceArgument(context, argument, node);
  }
  return argument;
}

export function createRustMutableReferenceArgument(context: RustPlanContext, argument: RustExpr, node: Node | undefined): RustExpr {
  return {
    kind: "reference",
    expr: node !== undefined && context.expressionOverrides?.has(node) !== true && context.input.program.records.argumentView.get(node)?.slice === true
      ? planArrayLiteral(node, context, "slice")
      : argument,
    mutable: true,
  };
}

export function applyFinalizedRustArgumentMode(
  context: RustPlanContext,
  sourceNode: Node,
  expression: RustExpr,
  input: RustFinalizedSourceInput,
  sourceIsSharedReference: boolean,
): RustExpr {
  if (input.mode === "value") {
    return expression;
  }
  const passThrough = context.input.program.records.providerReference.get(sourceNode, input)
    ?? failRustPlannerInvariant("An admitted provider reference requires its exact source parameter and reborrow contract.", sourceNode);
  if (passThrough) return expression;
  if (sourceIsSharedReference && input.mode === "ref") {
    return createRustSharedReferenceArgument(context, expression, sourceNode);
  }
  return input.mode === "mut-ref"
    ? createRustMutableReferenceArgument(context, expression, sourceNode)
    : createRustSharedReferenceArgument(context, expression, sourceNode);
}

export function createRustSharedReferenceArgument(
  context: RustPlanContext,
  argument: RustExpr,
  node: Node | undefined,
): RustExpr {
  if (node !== undefined && context.input.program.records.readOwnership.get(node)?.sharedReference === true) return argument;
  const errorField = node === undefined ? undefined : rustErrorFieldSharedView(node, argument, context);
  if (errorField !== undefined) return errorField;
  const override = node === undefined ? undefined : context.expressionOverrides?.get(node);
  if (override?.valueForm === "shared-reference") {
    return argument;
  }
  if (node !== undefined && override === undefined) {
    const stringView = context.input.program.records.stringComparisonView.get(node);
    if (stringView !== undefined && stringView.kind !== "value") return rustErrorFieldComparisonView(node, argument, undefined, context);
    const selected = context.input.program.records.argumentView.get(node);
    if (selected?.slice === true) return { kind: "reference", expr: planArrayLiteral(node, context, "slice") };
    if (selected?.borrowedStorage === true) {
      const place = planExpression(node, context, "value", "shared-receiver")
        ?? failRustPlannerInvariant("An admitted borrowed operand requires its native storage view.", node);
      return planRustSharedReceiver(node, place, context);
    }
  }
  const sourceParameterAbi = node === undefined ? undefined : context.input.program.records.sourceParameterAbi.get(node);
  if (sourceParameterAbi?.mode === "ref" || sourceParameterAbi?.mode === "mut-ref") return argument;
  return node === undefined ? { kind: "reference", expr: argument } : planRustSharedReceiver(node, argument, context);
}
