import type { Node } from "@tsonic/tsts";
import type { RustFinalizedSourceInput } from "../../../target-model/records/finalized-operation.js";

import type { RustArgumentMode } from "../../../target-model/operations/model.js";
import type { RustSourceParameterAbiFact } from "../../../target-model/records/callables-and-resources.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustValueReferenceReborrow } from "../../../analysis/conversions/value-carrier-queries.js";
import { rustBorrowedStringView } from "../../target-ast/syntax/expressions.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { failRustPlannerInvariant } from "../../invariants.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planExpression } from "./entry.js";
import { planRustSharedReceiver } from "./typed-locations.js";
import { rustErrorFieldSharedView } from "./error-field-borrows.js";

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
      : createRustMutableReferenceArgument(argument);
  }
  return argument;
}

export function createRustMutableReferenceArgument(argument: RustExpr): RustExpr {
  return {
    kind: "reference",
    expr: argument.kind === "vec-literal"
      ? { kind: "slice-literal", elements: argument.elements }
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
  const sourceParameterAbi = context.input.program.records.sourceParameterAbi.get(sourceNode);
  if (sourceParameterMatches(input, sourceParameterAbi)) {
    return expression;
  }
  if (sourceReferenceReborrowMatches(context, sourceNode, input)) {
    return expression;
  }
  const override = context.expressionOverrides?.get(sourceNode);
  if (input.mode === "ref" && input.conversion.kind === "identity" &&
    input.parameterCarrier.kind === "reference" && !input.parameterCarrier.mutable &&
    rustTargetTypeRefEquals(input.parameterCarrier.referent, input.sourceCarrier) &&
    override?.valueForm === "storage" && expression === override.expression &&
    expression.kind === "dereference") {
    return { kind: "reference", expr: expression.pointer };
  }
  if (sourceIsSharedReference && input.mode === "ref") {
    return createRustSharedReferenceArgument(context, expression, sourceNode);
  }
  return input.mode === "mut-ref"
    ? createRustMutableReferenceArgument(expression)
    : createRustSharedReferenceArgument(context, expression, sourceNode);
}

function sourceReferenceReborrowMatches(
  context: RustPlanContext,
  sourceNode: Node,
  input: RustFinalizedSourceInput,
): boolean {
  const conversion = rustValueReferenceReborrow(context.input.program.records, sourceNode,
    context.input.program.typeDefinitions);
  return conversion !== undefined &&
    rustTargetTypeRefEquals(conversion.target, input.sourceCarrier) &&
    (input.mode === "ref" || input.mode === "mut-ref" && conversion.source.mutable);
}

function sourceParameterMatches(
  input: RustFinalizedSourceInput,
  sourceParameterAbi: RustSourceParameterAbiFact | undefined,
): boolean {
  return sourceParameterAbi?.mode === input.mode &&
    rustTargetTypeRefEquals(sourceParameterAbi.parameterCarrier, input.parameterCarrier);
}

export function createRustSharedReferenceArgument(
  context: RustPlanContext,
  argument: RustExpr,
  node: Node | undefined,
): RustExpr {
  if (node !== undefined && context.input.program.ownership.reads.get(node)?.sharedReference === true) return argument;
  const errorField = node === undefined ? undefined : rustErrorFieldSharedView(node, argument, context);
  if (errorField !== undefined) return errorField;
  const borrowedString = rustBorrowedStringView(argument);
  if (borrowedString !== argument) {
    return borrowedString;
  }
  const override = node === undefined ? undefined : context.expressionOverrides?.get(node);
  if (override?.valueForm === "shared-reference") {
    return argument;
  }
  const sourceParameterAbi = node === undefined
    ? undefined
    : context.input.program.records.sourceParameterAbi.get(node);
  if (sourceParameterAbi?.mode === "ref" || sourceParameterAbi?.mode === "mut-ref") {
    return argument;
  }
  if (argument.kind === "string-literal") {
    return { kind: "str-literal", value: argument.value };
  }
  if (argument.kind === "vec-literal") {
    return { kind: "reference", expr: { kind: "slice-literal", elements: argument.elements } };
  }
  return node === undefined ? { kind: "reference", expr: argument } : planRustSharedReceiver(node, argument, context);
}
