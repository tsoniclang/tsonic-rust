import type { Node } from "@tsonic/tsts";
import type { RustFinalizedSourceInput } from "../../../target-model/records/operations/finalized-operation.js";

import type { RustArgumentMode } from "../../../target-model/operations/model.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planExpression, rustValueProjectionFor } from "./entry.js";
import { planRustSharedReceiver } from "./typed-locations.js";
import { rustErrorFieldSharedView, rustErrorFieldComparisonView } from "./error-field-borrows.js";
import { planArrayLiteral } from "./array-literals/planning.js";

export type RustArgumentValue =
  | { readonly stage: "source"; readonly expression: RustExpr; readonly node: Node }
  | { readonly stage: "finalized"; readonly expression: RustExpr };

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
  argument: RustArgumentValue,
  mode: RustArgumentMode,
): RustExpr {
  if (mode === "ref") {
    return createRustSharedReferenceArgument(context, argument);
  }
  if (mode === "mut-ref") {
    const node = rustSourceStorageView(argument, context);
    const sourceParameterAbi = node === undefined
      ? undefined
      : context.input.program.records.sourceParameterAbi.get(node);
    return sourceParameterAbi?.mode === "mut-ref"
      ? argument.expression
      : createRustMutableReferenceArgument(context, argument);
  }
  return argument.expression;
}

export function createRustMutableReferenceArgument(context: RustPlanContext, argument: RustArgumentValue): RustExpr {
  const node = rustSourceStorageView(argument, context);
  return {
    kind: "reference",
    expr: node !== undefined && context.expressionOverrides?.has(node) !== true && context.input.program.records.argumentView.get(node)?.slice === true
      ? planArrayLiteral(node, context, "slice")
      : argument.expression,
    mutable: true,
  };
}

export function applyFinalizedRustArgumentMode(
  context: RustPlanContext,
  sourceNode: Node,
  expression: RustExpr,
  input: RustFinalizedSourceInput,
  sourceIsSharedReference: boolean,
  stabilized = false,
): RustExpr {
  if (input.mode === "value") {
    return expression;
  }
  const passThrough = context.input.program.records.providerReference.get(sourceNode, input)
    ?? failRustPlannerInvariant("An admitted provider reference requires its exact source parameter and reborrow contract.", sourceNode);
  if (passThrough && !stabilized) return expression;
  const argument: RustArgumentValue = stabilized || input.conversion.kind !== "identity"
    ? { stage: "finalized", expression }
    : { stage: "source", expression, node: sourceNode };
  if (sourceIsSharedReference && input.mode === "ref") {
    return createRustSharedReferenceArgument(context, argument);
  }
  return input.mode === "mut-ref"
    ? createRustMutableReferenceArgument(context, argument)
    : createRustSharedReferenceArgument(context, argument);
}

export function createRustSharedReferenceArgument(
  context: RustPlanContext,
  value: RustArgumentValue,
): RustExpr {
  const argument = value.expression;
  const node = rustSourceStorageView(value, context);
  if (node !== undefined && context.input.program.records.readOwnership.get(node)?.sharedReference === true) return argument;
  const errorField = node === undefined ? undefined : rustErrorFieldSharedView(node, argument, context);
  if (errorField !== undefined) return errorField;
  const override = node === undefined ? undefined : context.expressionOverrides?.get(node);
  if (override?.valueForm === "shared-reference") {
    return argument;
  }
  // A ref or mut-ref source parameter is already a reference; its string and argument views would borrow it again.
  const sourceParameterAbi = node === undefined ? undefined : context.input.program.records.sourceParameterAbi.get(node);
  if (sourceParameterAbi?.mode === "ref" || sourceParameterAbi?.mode === "mut-ref") return argument;
  if (node !== undefined && override === undefined) {
    const stringView = context.input.program.records.stringComparisonView.get(node);
    if (stringView !== undefined && stringView.kind !== "value" && stringView.kind !== "native-str-reference")
      return rustErrorFieldComparisonView(node, argument, undefined, context);
    const selected = context.input.program.records.argumentView.get(node);
    if (selected?.slice === true) return { kind: "reference", expr: planArrayLiteral(node, context, "slice") };
    // A by-reference parameter read is already a shared reference; borrowing its storage again is a needless borrow.
    if (selected?.borrowedStorage !== undefined && !rustReadsReferenceParameter(node, context)) {
      const place = planExpression(node, context, "value", "shared-receiver")
        ?? failRustPlannerInvariant("An admitted borrowed operand requires its native storage view.", node);
      return planRustSharedReceiver(node, place, context);
    }
  }
  if (node !== undefined && rustReadsReferenceParameter(node, context)) return argument;
  return value.stage === "finalized" ? { kind: "reference", expr: argument }
    : planRustSharedReceiver(value.node, argument, context);
}

export function rustSourceStorageView(
  value: { readonly stage: "source"; readonly node: Node } | { readonly stage: "finalized" },
  context: RustPlanContext,
): Node | undefined {
  if (value.stage === "finalized") return undefined;
  const node = value.node;
  const projection = rustValueProjectionFor(node, context.expressionOverrides?.get(node)?.carrier, context)
    ?? failRustPlannerInvariant("An admitted native source view requires its sealed projection composition.", node);
  return projection.exits || projection.flow !== undefined || projection.upcast !== undefined ||
    projection.downcast !== undefined || projection.object !== undefined || projection.option !== undefined ||
    projection.contextual !== undefined && !projection.contextualIdentity ||
    context.input.program.records.callableJoinWrite.get(node) !== undefined ? undefined : node;
}

// The read carries its parameter's ABI; when its carrier was selected before the parameter reference was resolved, the
// identifier's binding declaration (the parameter) carries it.
function rustReadsReferenceParameter(node: Node, context: RustPlanContext): boolean {
  const { records, source } = context.input.program;
  const declaration = context.expressionOverrides?.has(node) === true || !source.ast.is.IsIdentifier(node) ? undefined
    : records.sourceBinding.get(node)?.sourceDeclaration;
  const abi = records.sourceParameterAbi.get(node) ??
    (declaration !== undefined && source.ast.is.IsParameterDeclaration(declaration) ? records.sourceParameterAbi.get(declaration) : undefined);
  return abi?.mode === "ref" || abi?.mode === "mut-ref";
}
