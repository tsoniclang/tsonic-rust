import type { Node } from "@tsonic/tsts";
import type { RustProviderConstantArgument } from "../../../target-model/operations/model.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";
import type { RustFinalizedArrayInput, RustFinalizedSliceInput, RustFinalizedTaggedArrayInput,
  RustFinalizedConstantInput, RustFinalizedDispatchContextInput, RustFinalizedOperationAbi,
  RustFinalizedSourceInput, RustFinalizedTargetInput } from "../../../target-model/records/operations/finalized-operation.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustFinalizedInputPlanOverrides } from "../project/provider-evaluation-scope.js";
import type { RustDispatchContextInputScope } from "../project/dispatch-contexts.js";
import { registerAliasFromPath } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { rustTypeEmissionInContext, rustTypeFromCarrierInContext } from "../types/render.js";
import { applyRustLocalErrorBoundary } from "../types/error-boundary.js";
import { rustBottomExpression } from "../types/fallible-shape.js";
import { applyRustProviderEvaluationScope, planRustProviderEvaluationScope } from "../project/provider-evaluation-scope.js";
import { planRustDispatchContextInputScope } from "../project/dispatch-contexts.js";
import { planExpression } from "./entry.js";
import { applyFinalizedValueConversion } from "./value-conversions.js";
import { applyFinalizedRustArgumentMode } from "./input-shaping.js";
import { planRustBorrowedSingletonSlice, planRustRestAssembly } from "./calls/rest-assembly.js";
import { planRustFinalizedOperationForm } from "./finalized-operation-form.js";
import { rustAutoBorrowedReceiver } from "./auto-borrowed-receivers.js";
import { planRustSelectedSourceErrorPropagation } from "./calls/source-errors.js";

function providerConstantExpression(argument: RustProviderConstantArgument, context: RustPlanContext): RustExpr {
  switch (argument.kind) {
    case "integer": return { kind: "int-literal", text: String(argument.value) };
    case "float64": {
      const text = Object.is(argument.value, -0) ? "-0.0" : String(argument.value);
      return { kind: "float-literal", text: /[.eE]/u.test(text) ? text : `${text}.0` };
    }
    case "string": return { kind: "str-literal", value: argument.value };
    case "boolean": return { kind: "bool-literal", value: argument.value };
    case "none": {
      if (argument.element === undefined) return { kind: "none" };
      const element = rustTypeFromCarrierInContext(argument.element, context)
        ?? failRustPlannerInvariant("An admitted native None constant requires its rendered payload type.");
      return { kind: "associated-value", owner: { kind: "named", path: "core::option::Option",
        genericArguments: [{ kind: "type", type: element }] }, name: "None" };
    }
  }
}

export function planProviderOperationExpression(context: RustPlanContext,
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" | "runtime-set" }>,
  receiverNode: Node | undefined, argumentNodes: readonly (Node | undefined)[], operationNode: Node,
  options: { readonly overrides?: RustFinalizedInputPlanOverrides } &
    ({ readonly resultUse: "value" | "storage" }
      | { readonly resultUse: "scoped"; readonly consume: (expression: RustExpr) => RustExpr | undefined })): RustExpr | undefined {
  const form = context.input.program.records.providerForm.get(operationNode, fact.abi, context.promiseBody)
    ?? failRustPlannerInvariant("An admitted provider operation requires its sealed emission form.", operationNode);
  context = { ...context, providerCallbackBody: form.callbackBody };
  const evaluation = planRustProviderEvaluationScope(context, fact, operationNode, receiverNode, argumentNodes,
    planExpression, planProviderOperationExpression, options.overrides?.inputs,
    input => planFinalizedSourceInput(context, input, receiverNode, argumentNodes, operationNode, "target-argument", options.overrides));
  if (evaluation.kind === "failed") return undefined;
  const overrides = mergeOverrides(evaluation.kind === "selected" ? evaluation.overrides : undefined, options.overrides, operationNode);
  const receiver = fact.abi.targetReceiver.kind === "input"
    ? planFinalizedSourceInput(context, fact.abi.targetReceiver.input, receiverNode, argumentNodes, operationNode, "target-receiver", overrides) : undefined;
  if (fact.abi.targetReceiver.kind === "input" && receiver === undefined) return undefined;
  const dispatch = planRustDispatchContextInputScope(fact.abi.targetArguments.filter(isDispatchInput), operationNode, context);
  if (dispatch === undefined) return undefined;
  const args: RustExpr[] = [];
  for (const input of fact.abi.targetArguments) {
    const value = planFinalizedTargetInput(context, input, receiverNode, argumentNodes, operationNode, overrides, dispatch);
    if (value === undefined) return undefined;
    args.push(value);
  }
  const expression = planRustFinalizedOperationForm(context, fact.abi, receiver, args, operationNode,
    { resultUse: options.resultUse === "scoped" ? "storage" : options.resultUse, assignment: fact.kind === "runtime-set" });
  if (expression === undefined) return undefined;
  const dispatched = dispatch.apply(expression);
  const value = options.resultUse === "scoped" ? options.consume(dispatched) : dispatched;
  if (value === undefined) return undefined;
  return evaluation.kind === "selected" ? applyRustProviderEvaluationScope(value, evaluation) : value;
}

function mergeOverrides(left: RustFinalizedInputPlanOverrides | undefined, right: RustFinalizedInputPlanOverrides | undefined,
  node: Node): RustFinalizedInputPlanOverrides | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  const sourceValues = new Map(left.sourceValues);
  const inputs = new Map(left.inputs);
  for (const [subject, value] of right.sourceValues) {
    if (sourceValues.has(subject)) failRustPlannerInvariant("One finalized provider source cannot be owned by two native evaluation regions.", node);
    sourceValues.set(subject, value);
  }
  for (const [input, value] of right.inputs) {
    if (inputs.has(input)) failRustPlannerInvariant("One finalized provider input cannot be owned by two native evaluation regions.", node);
    inputs.set(input, value);
  }
  return { sourceValues, inputs };
}

export function finishProviderOperationExpression(context: RustPlanContext, fact: { readonly abi: RustFinalizedOperationAbi },
  expression: RustExpr, node: Node): RustExpr | undefined {
  let raw = expression;
  const nativeResult = context.input.program.records.providerForm.get(node, fact.abi, context.promiseBody)?.nativeResult;
  if (nativeResult !== undefined) {
    const result = planRustSelectedSourceErrorPropagation(node, nativeResult, raw, context);
    if (result === undefined) return undefined;
    raw = result;
  } else if (fact.abi.effects.invocation === "fallible") {
    const region = context.fallibleBoundary
      ?? failRustPlannerInvariant("An admitted fallible operation requires its finalized native error context.", node);
    if (fact.abi.effects.errorBoundary === "none") failRustPlannerInvariant("An admitted fallible operation requires its exact native error boundary.", node);
    const error = fact.abi.effects.errorBoundary === "provider-native"
      ? rustTypeFromCarrierInContext(fact.abi.effects.errorCarrier, context) : undefined;
    if (fact.abi.effects.errorBoundary === "provider-native" && error === undefined)
      failRustPlannerInvariant("An admitted fallible provider operation requires its rendered error type.", node);
    const result = applyRustLocalErrorBoundary(raw, fact.abi.effects.errorBoundary, region, error);
    if (result === undefined) return undefined;
    raw = result;
  }
  if (fact.abi.result.kind === "async") return raw;
  const converted = applyFinalizedValueConversion(context, { stage: "finalized", expression: raw }, fact.abi.result.conversion, node);
  return converted === undefined || rustTypeEmissionInContext(fact.abi.result.carrier, context).completion !== "never"
    ? converted : rustBottomExpression(converted);
}

function isDispatchInput(input: RustFinalizedTargetInput): input is RustFinalizedDispatchContextInput {
  return input.source.kind === "dispatch-context";
}

function isConstantInput(input: RustFinalizedTargetInput): input is RustFinalizedConstantInput {
  return input.source.kind === "constant";
}

function isTaggedInput(input: RustFinalizedTargetInput): input is RustFinalizedTaggedArrayInput {
  return input.source.kind === "argument-tagged-array";
}

function isArrayInput(input: RustFinalizedTargetInput): input is RustFinalizedSliceInput | RustFinalizedArrayInput {
  return input.source.kind === "argument-slice" || input.source.kind === "argument-array";
}

function isSliceInput(input: RustFinalizedTargetInput): input is RustFinalizedSliceInput {
  return input.source.kind === "argument-slice";
}

export function planFinalizedTargetInput(context: RustPlanContext, input: RustFinalizedTargetInput,
  receiverNode: Node | undefined, argumentNodes: readonly (Node | undefined)[], operationNode: Node,
  overrides?: RustFinalizedInputPlanOverrides, dispatch?: RustDispatchContextInputScope): RustExpr | undefined {
  if (isDispatchInput(input)) return dispatch?.input(input)
    ?? failRustPlannerInvariant("An admitted dispatch operand requires its native scope.", operationNode);
  if (isConstantInput(input)) return providerConstantExpression(input.source.value, context);
  if (isTaggedInput(input)) {
      const elements: RustExpr[] = [];
      for (const element of input.elements) {
        const value = planFinalizedSourceInput(context, element.input, receiverNode, argumentNodes, operationNode, "target-argument", overrides);
        if (value === undefined) return undefined;
        registerAliasFromPath(context, element.constructorPath);
        elements.push({ kind: "call", path: element.constructorPath, args: [value] });
      }
      return { kind: "slice-literal", elements };
  }
  if (isArrayInput(input)) {
    const slice = isSliceInput(input);
    const selected = isSliceInput(input) ? context.input.program.records.providerSlice.get(operationNode, input)
      ?? failRustPlannerInvariant("An admitted provider slice requires its exact source borrow and literal plan.", operationNode) : undefined;
    const singleton = selected?.singleton;
    const first = input.elements[0];
    if (singleton !== undefined && first !== undefined &&
      !context.expressionOverrides?.has(singleton) && overrides?.inputs.has(first) !== true && overrides?.sourceValues.has(singleton) !== true)
      return planRustBorrowedSingletonSlice(singleton, context);
    const elements: RustExpr[] = [];
    const sequences: boolean[] = [];
    for (const element of input.elements) {
      const literal = selected?.literals.get(element);
      const occurrence = element.source.kind === "receiver" ? receiverNode : argumentNodes[element.source.sourceIndex];
      const directLiteral = literal !== undefined && overrides?.inputs.has(element) !== true &&
        (occurrence === undefined || overrides?.sourceValues.has(occurrence) !== true && context.expressionOverrides?.has(occurrence) !== true);
      const value = directLiteral ? { kind: "str-literal" as const, value: literal }
        : planFinalizedSourceInput(context, element, receiverNode, argumentNodes, operationNode, "target-argument", overrides);
      if (value === undefined) return undefined;
      elements.push(element.elementView === "str" && !directLiteral
        ? { kind: "method-call", receiver: rustAutoBorrowedReceiver(value), method: "as_str", args: [] } : value);
      sequences.push(element.conversion.kind === "semantic" && element.conversion.conversion.kind === "rest-sequence");
    }
    if (sequences.some(Boolean)) {
      const value = planRustRestAssembly(elements.map((value, index) => ({ value, sequence: sequences[index]! })), context);
      return value === undefined ? undefined : slice ? { kind: "reference", expr: value } : value;
    }
    const value: RustExpr = { kind: "slice-literal", elements };
    return slice ? { kind: "reference", expr: value } : value;
  }
  return planFinalizedSourceInput(context, input, receiverNode, argumentNodes, operationNode, "target-argument", overrides);
}

export function planFinalizedSourceInput(context: RustPlanContext, input: RustFinalizedSourceInput,
  receiverNode: Node | undefined, argumentNodes: readonly (Node | undefined)[], operationNode: Node,
  position: "target-argument" | "target-receiver" = "target-argument", overrides?: RustFinalizedInputPlanOverrides): RustExpr | undefined {
  const occurrence = input.source.kind === "receiver" ? receiverNode : argumentNodes[input.source.sourceIndex];
  const sequence = input.conversion.kind === "semantic" && input.conversion.conversion.kind === "rest-sequence";
  const ast = context.input.program.source.ast;
  const source = sequence ? occurrence !== undefined && ast.is.IsSpreadElement(occurrence)
    ? ast.as.AsSpreadElement(occurrence)?.Expression : undefined : occurrence;
  if (source === undefined) failRustPlannerInvariant("An admitted native operation input requires its exact source node.", operationNode);
  const override = context.expressionOverrides?.get(source);
  const prepared = overrides?.inputs.get(input);
  if (prepared !== undefined) return prepared;
  const sourceValue = overrides?.sourceValues.get(source);
  const shared = sourceValue === undefined && (override === undefined || override.valueForm === "shared-reference") &&
    (input.conversion.kind === "identity" && input.mode === "ref" || input.sharedConversion);
  const expression = sourceValue ?? planExpression(source, context, "value", shared
    ? position === "target-receiver" && !input.sharedConversion ? "shared-receiver" : "shared-reference" : "value");
  if (expression === undefined) return undefined;
  const direct = sourceValue === undefined && override?.valueForm === "storage" && input.conversion.kind === "identity" &&
    (position === "target-receiver" || input.mode !== "value") ? override.expression : expression;
  if (shared && input.conversion.kind === "identity") return direct;
  const value = applyFinalizedValueConversion(context, sourceValue === undefined
    ? { stage: "source", expression: direct, node: source }
    : { stage: "finalized", expression: direct }, input.conversion, source, shared);
  return value === undefined || position === "target-receiver" ? value
    : applyFinalizedRustArgumentMode(context, source, value, input, override?.valueForm === "shared-reference", sourceValue !== undefined);
}
