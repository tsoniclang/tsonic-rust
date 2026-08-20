import type { Node } from "@tsonic/tsts";
import type { RustFinalizedSourceInput } from "../../../analysis/facts/finalized-operation-abi.js";
import {
  rustSourceParameterAbiFactKey,
  type RustArgumentMode,
  type RustSourceParameterAbiFact,
} from "../../../analysis/facts/keys.js";
import { rustTargetTypeRefEquals } from "../../../policy/types/equality.js";
import { rustBorrowedStringView } from "../../target-ast/expressions.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import { missingFactDiagnostic } from "../diagnostics.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { diagnosticInput } from "../program/plan-context.js";
import { planExpression } from "./entry.js";

export function planRustCallArguments(
  node: Node,
  context: RustPlanContext,
): readonly RustExpr[] | undefined {
  const arguments_: RustExpr[] = [];
  for (const argument of context.input.program.source.ast.arguments(node)) {
    if (argument === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.call-argument",
        "Call expression contains an undefined argument slot.",
      ));
      return undefined;
    }
    const planned = planExpression(argument, context);
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
      : context.input.program.facts.getFact(node, rustSourceParameterAbiFactKey);
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
  const sourceParameterAbi = context.input.program.facts.getFact(
    sourceNode,
    rustSourceParameterAbiFactKey,
  );
  if (sourceParameterMatches(input, sourceParameterAbi)) {
    return expression;
  }
  if (sourceIsSharedReference && input.mode === "ref") {
    return expression;
  }
  return input.mode === "mut-ref"
    ? createRustMutableReferenceArgument(expression)
    : createRustSharedReferenceArgument(context, expression, sourceNode);
}

function sourceParameterMatches(
  input: RustFinalizedSourceInput,
  sourceParameterAbi: RustSourceParameterAbiFact | undefined,
): boolean {
  return sourceParameterAbi?.mode === input.mode &&
    rustTargetTypeRefEquals(sourceParameterAbi.parameterCarrier, input.parameterCarrier);
}

function createRustSharedReferenceArgument(
  context: RustPlanContext,
  argument: RustExpr,
  node: Node | undefined,
): RustExpr {
  const borrowedString = rustBorrowedStringView(argument);
  if (borrowedString !== argument) {
    return borrowedString;
  }
  if (node !== undefined &&
    context.expressionOverrides?.get(node)?.valueForm === "shared-reference") {
    return argument;
  }
  const sourceParameterAbi = node === undefined
    ? undefined
    : context.input.program.facts.getFact(node, rustSourceParameterAbiFactKey);
  if (sourceParameterAbi?.mode === "ref" || sourceParameterAbi?.mode === "mut-ref") {
    return argument;
  }
  if (argument.kind === "string-literal") {
    return { kind: "str-literal", value: argument.value };
  }
  if (argument.kind === "vec-literal") {
    return { kind: "reference", expr: { kind: "slice-literal", elements: argument.elements } };
  }
  return { kind: "reference", expr: argument };
}
