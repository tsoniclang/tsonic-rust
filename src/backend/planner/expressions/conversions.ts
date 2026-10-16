import {
  isRustNeverCarrier,
  rustOptionTargetType,
} from "../../../target-model/types/index.js";
import { isRustFinalizedArrayInput, isRustFinalizedConstantInput, isRustFinalizedDispatchContextInput, isRustFinalizedSliceInput, isRustFinalizedTaggedArrayInput } from "../../../analysis/operations/finalized-operation/conversions.js";
import { validateRustFinalizedOperationAbi } from "../../../analysis/operations/finalized-operation/validation.js";
import { applyRustLocalErrorBoundary } from "../types/error-boundary.js";
import { applyRustProviderEvaluationScope, planRustProviderEvaluationScope } from "../project/provider-evaluation-scope.js";
import { diagnosticInput, registerAliasFromPath } from "../program/plan-context.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { planExpression } from "./entry.js";
import { rustBottomExpression } from "../types/fallible-shape.js";
import { rustValueCarrierTransitionTarget } from "../../../analysis/conversions/value-carrier-queries.js";
import { rustFinalizedCarrierTransitionMatches } from "../../../analysis/operations/target-operation.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import {
  rustTypeFromCarrierInContext,
} from "../types/render.js";
import type { RustProviderConstantArgument } from "../../../target-model/operations/model.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations.js";
import type { Node } from "@tsonic/tsts";
import type {
  RustExpr,
} from "../../target-ast/syntax/nodes.js";
import type { RustFinalizedInputPlanOverrides } from "../project/provider-evaluation-scope.js";
import type { RustFinalizedOperationAbi, RustFinalizedSourceInput, RustFinalizedTargetInput } from "../../../target-model/records/finalized-operation.js";
import type { RustPlanContext } from "../program/plan-context.js";
import {
  applyFinalizedRustArgumentMode,
} from "./input-shaping.js";
import { applyFinalizedValueConversion } from "./value-conversions.js";
import { canBorrowRustSingletonSlice, planRustBorrowedSingletonSlice, planRustRestAssembly } from "./calls/rest-assembly.js";
import { rustCarrierHasCopyContract } from "../types/generic-requirements.js";
import { planRustDispatchContextInputScope } from "../project/dispatch-contexts.js";
import type { RustDispatchContextInputScope } from "../project/dispatch-contexts.js";
import { rustValueConversionContract } from "../../../target-model/conversions/contracts.js";
import { planRustFinalizedOperationForm } from "./finalized-operation-form.js";

function providerConstantExpression(argument: RustProviderConstantArgument, context: RustPlanContext): RustExpr | undefined {
  switch (argument.kind) {
    case "integer":
      return { kind: "int-literal", text: String(argument.value) };
    case "float64":
      return { kind: "float-literal", text: rustFloat64ConstantText(argument.value) };
    case "string":
      return { kind: "str-literal", value: argument.value };
    case "boolean":
      return { kind: "bool-literal", value: argument.value };
    case "none": {
      if (argument.element === undefined) return { kind: "none" };
      const owner = rustTypeFromCarrierInContext(rustOptionTargetType(argument.element), context);
      return owner === undefined ? undefined : { kind: "associated-value", owner, name: "None" };
    }
  }
}

function rustFloat64ConstantText(value: number): string {
  if (Object.is(value, -0)) {
    return "-0.0";
  }
  const text = String(value);
  return /[.eE]/u.test(text) ? text : `${text}.0`;
}

export function planProviderOperationExpression(
  context: RustPlanContext,
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" | "runtime-set" }>,
  receiverNode: Node | undefined,
  argumentNodes: readonly (Node | undefined)[],
  operationNode: Node,
  options: {
    readonly resultUse: "value" | "storage";
    readonly overrides?: RustFinalizedInputPlanOverrides;
  },
): RustExpr | undefined {
  if (fact.kind === "provider-operation" && !validateRustFinalizedOperationAbi(fact.abi, context.input.program.typeDefinitions)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, operationNode),
      "rust.backend.provider-operation-abi",
      "Provider operation fact does not contain one valid total Rust operation ABI.",
    ));
    return undefined;
  }
  const abiResultCarrier = fact.abi.result.kind === "async"
    ? fact.abi.result.futureCarrier
    : fact.abi.result.carrier;
  if (fact.kind === "provider-operation" && !rustTargetTypeRefEquals(fact.resultCarrier, abiResultCarrier)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, operationNode),
      "rust.backend.provider-operation-result",
      "Provider operation result carrier conflicts with its finalized Rust operation ABI.",
    ));
    return undefined;
  }
  const evaluationScope = planRustProviderEvaluationScope(
    context,
    fact,
    operationNode,
    receiverNode,
    argumentNodes,
    planExpression,
    planProviderOperationExpression,
    options.overrides?.inputs,
    input => planFinalizedSourceInput(context, input, receiverNode, argumentNodes, operationNode,
      "target-argument", options.overrides),
  );
  if (evaluationScope.kind === "failed") {
    return undefined;
  }
  const overrides = mergeRustFinalizedInputOverrides(
    evaluationScope.kind === "selected" ? evaluationScope.overrides : undefined,
    options.overrides,
    operationNode,
    context,
  );
  if (overrides === false) {
    return undefined;
  }
  const receiver = fact.abi.targetReceiver.kind === "input"
    ? planFinalizedSourceInput(
        context,
        fact.abi.targetReceiver.input,
        receiverNode,
        argumentNodes,
        operationNode,
        "target-receiver",
        overrides,
      )
    : undefined;
  if (fact.abi.targetReceiver.kind === "input" && receiver === undefined) {
    return undefined;
  }
  const dispatchScope = planRustDispatchContextInputScope(
    fact.abi.targetArguments.filter(isRustFinalizedDispatchContextInput), operationNode, context,
  );
  if (dispatchScope === undefined) return undefined;
  const args: RustExpr[] = [];
  for (const input of fact.abi.targetArguments) {
    const planned = planFinalizedTargetInput(
      context,
      input,
      receiverNode,
      argumentNodes,
      operationNode,
      overrides,
      dispatchScope,
    );
    if (planned === undefined) {
      return undefined;
    }
    args.push(planned);
  }
  const expression = planRustFinalizedOperationForm(context, fact.abi, receiver, args, operationNode, {
    resultUse: options.resultUse, assignment: fact.kind === "runtime-set",
  });
  if (expression === undefined) return undefined;
  const dispatched = dispatchScope.apply(expression);
  return evaluationScope.kind !== "selected" ? dispatched
    : applyRustProviderEvaluationScope(dispatched, evaluationScope);
}

function mergeRustFinalizedInputOverrides(
  left: RustFinalizedInputPlanOverrides | undefined,
  right: RustFinalizedInputPlanOverrides | undefined,
  operationNode: Node,
  context: RustPlanContext,
): RustFinalizedInputPlanOverrides | undefined | false {
  if (left === undefined) {
    return right;
  }
  if (right === undefined) {
    return left;
  }
  const sourceValues = new Map(left.sourceValues);
  const inputs = new Map(left.inputs);
  if ([...right.sourceValues.keys()].some((node) => sourceValues.has(node)) ||
    [...right.inputs.keys()].some((input) => inputs.has(input))) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, operationNode),
      "rust.backend.provider-input-override-conflict",
      "One finalized provider input cannot be owned by two Rust evaluation regions.",
    ));
    return false;
  }
  for (const [node, value] of right.sourceValues) {
    sourceValues.set(node, value);
  }
  for (const [input, value] of right.inputs) {
    inputs.set(input, value);
  }
  return { sourceValues, inputs };
}

export function finishProviderOperationExpression(
  context: RustPlanContext,
  fact: { readonly abi: RustFinalizedOperationAbi },
  expression: RustExpr,
  node: Node,
): RustExpr | undefined {
  let raw = expression;
  if (fact.abi.effects.invocation === "fallible") {
    const region = context.fallibleBoundary;
    if (region === undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, node),
        "rust.error.call",
        "Fallible operations require a finalized fallible lowering context.",
      ));
      return undefined;
    }
    if (fact.abi.effects.errorBoundary === "none") {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.provider-error-boundary",
        "A finalized fallible Rust operation requires one exact error boundary.",
      ));
      return undefined;
    }
    const providerErrorType = fact.abi.effects.errorBoundary === "provider-native"
      ? rustTypeFromCarrierInContext(fact.abi.effects.errorCarrier, context) : undefined;
    if (fact.abi.effects.errorBoundary === "provider-native" && providerErrorType === undefined) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
        "rust.backend.provider-error-type", "Fallible provider operation requires its exact rendered native error type."));
      return undefined;
    }
    const propagated = applyRustLocalErrorBoundary(
      raw,
      fact.abi.effects.errorBoundary,
      region,
      providerErrorType,
    );
    if (propagated === undefined) return undefined;
    raw = propagated;
  }
  if (fact.abi.result.kind === "async") {
    return raw;
  }
  const converted = applyFinalizedValueConversion(
    context,
    raw,
    fact.abi.result.conversion,
    node,
  );
  return converted === undefined || !isRustNeverCarrier(fact.abi.result.carrier)
    ? converted
    : rustBottomExpression(converted);
}

export function planFinalizedTargetInput(
  context: RustPlanContext,
  input: RustFinalizedTargetInput,
  receiverNode: Node | undefined,
  argumentNodes: readonly (Node | undefined)[],
  operationNode: Node,
  overrides?: RustFinalizedInputPlanOverrides,
  dispatchScope?: RustDispatchContextInputScope,
): RustExpr | undefined {
  if (isRustFinalizedDispatchContextInput(input)) return dispatchScope?.input(input);
  if (isRustFinalizedConstantInput(input)) {
    return providerConstantExpression(input.source.value, context);
  }
  if (isRustFinalizedTaggedArrayInput(input)) {
    const elements: RustExpr[] = [];
    for (const element of input.elements) {
      const planned = planFinalizedSourceInput(
        context,
        element.input,
        receiverNode,
        argumentNodes,
        operationNode,
        "target-argument",
        overrides,
      );
      if (planned === undefined) {
        return undefined;
      }
      registerAliasFromPath(context, element.constructorPath);
      elements.push({ kind: "call", path: element.constructorPath, args: [planned] });
    }
    return { kind: "slice-literal", elements };
  }
  if (isRustFinalizedSliceInput(input) || isRustFinalizedArrayInput(input)) {
    const elements: RustExpr[] = [];
    for (const element of input.elements) {
      const singletonSource = element.source.kind === "receiver"
        ? receiverNode : argumentNodes[element.source.sourceIndex];
      const later = argumentNodes.slice(element.source.kind === "receiver" ? 0 : element.source.sourceIndex + 1)
        .filter((node): node is Node => node !== undefined);
      if (isRustFinalizedSliceInput(input) && input.elements.length === 1 &&
        element.mode === "value" && element.conversion.kind === "identity" &&
        rustTargetTypeRefEquals(element.sourceCarrier, input.elementCarrier) &&
        !rustCarrierHasCopyContract(input.elementCarrier, context) && singletonSource !== undefined &&
        overrides?.inputs.has(element) !== true && overrides?.sourceValues.has(singletonSource) !== true &&
        canBorrowRustSingletonSlice(singletonSource, context, later)) {
        return planRustBorrowedSingletonSlice(singletonSource, context);
      }
      const planned = planFinalizedSourceInput(
        context,
        element,
        receiverNode,
        argumentNodes,
        operationNode,
        "target-argument",
        overrides,
      );
      if (planned === undefined) {
        return undefined;
      }
      const asTargetElement = element.parameterCarrier.kind === "reference" &&
        element.parameterCarrier.referent.kind === "target-named" &&
        element.parameterCarrier.referent.id === "rust.std.String"
        ? planned.kind === "string-literal"
          ? { kind: "str-literal", value: planned.value } as RustExpr
          : planned.kind === "reference"
            ? { kind: "method-call", receiver: planned.expr, method: "as_str", args: [] } as RustExpr
            : planned
        : planned;
      elements.push(asTargetElement);
    }
    const sequenceFlags = input.elements.map(element => element.conversion.kind === "semantic" &&
      element.conversion.conversion.kind === "rest-sequence");
    if (sequenceFlags.some(Boolean)) {
      const value = planRustRestAssembly(elements.map((value, index) => ({ value, sequence: sequenceFlags[index]! })), context);
      return value === undefined ? undefined : isRustFinalizedSliceInput(input) ? { kind: "reference", expr: value } : value;
    }
    return isRustFinalizedSliceInput(input)
      ? { kind: "reference", expr: { kind: "slice-literal", elements } }
      : { kind: "slice-literal", elements };
  }
  return planFinalizedSourceInput(
    context,
    input,
    receiverNode,
    argumentNodes,
    operationNode,
    "target-argument",
    overrides,
  );
}

export function planFinalizedSourceInput(
  context: RustPlanContext,
  input: RustFinalizedSourceInput,
  receiverNode: Node | undefined,
  argumentNodes: readonly (Node | undefined)[],
  operationNode: Node,
  position: "target-argument" | "target-receiver" = "target-argument",
  overrides?: RustFinalizedInputPlanOverrides,
): RustExpr | undefined {
  const occurrence = input.source.kind === "receiver"
    ? receiverNode
    : argumentNodes[input.source.sourceIndex];
  const sequence = input.conversion.kind === "semantic" && input.conversion.conversion.kind === "rest-sequence";
  const sourceNode = sequence
    ? occurrence !== undefined && context.input.program.source.ast.is.IsSpreadElement(occurrence)
      ? context.input.program.source.ast.as.AsSpreadElement(occurrence)?.Expression : undefined
    : occurrence;
  if (sourceNode === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, operationNode),
      "rust.backend.provider-operation-input",
      "Finalized Rust operation input has no corresponding source node.",
    ));
    return undefined;
  }
  const expressionOverride = context.expressionOverrides?.get(sourceNode);
  const originalCarrier = context.input.program.records.runtimeCarrier.get(sourceNode)?.carrier;
  const sourceCarrier = expressionOverride?.carrier ?? originalCarrier;
  const convertedCarrier = rustValueCarrierTransitionTarget(context.input.program.records, sourceNode, sourceCarrier);
  if (sourceCarrier === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, sourceNode),
      "rust.backend.provider-operation-source-carrier",
      "Finalized Rust operation input has no independent source carrier fact.",
    ));
    return undefined;
  }
  const directCarrierMatch = rustFinalizedCarrierTransitionMatches(
    sourceCarrier,
    convertedCarrier,
    input.sourceCarrier,
  );
  if (!directCarrierMatch && convertedCarrier !== undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, sourceNode),
      "rust.backend.provider-operation-input-carrier",
      "Finalized Rust operation input conflicts with its independent source or selected call-argument carrier fact.",
    ));
    return undefined;
  }
  const inputOverride = overrides?.inputs.get(input);
  if (inputOverride !== undefined) {
    return inputOverride;
  }
  const sourceValueOverride = overrides?.sourceValues.get(sourceNode);
  const firstConversion = input.conversion.kind === "sequence" ? input.conversion.steps[0]! : input.conversion;
  const sharedConversion = firstConversion.kind === "semantic" &&
    rustValueConversionContract(firstConversion.conversion, context.input.program.typeDefinitions)?.sourceMode === "ref";
  const sharedInput = sourceValueOverride === undefined &&
    (expressionOverride === undefined || expressionOverride.valueForm === "shared-reference") &&
    (input.conversion.kind === "identity" && input.mode === "ref" || sharedConversion);
  const plannedExpression = sourceValueOverride ??
    planExpression(sourceNode, context, "value", sharedInput
      ? position === "target-receiver" && !sharedConversion ? "shared-receiver" : "shared-reference" : "value");
  if (plannedExpression === undefined) {
    return undefined;
  }
  const directStorage = sourceValueOverride === undefined &&
      expressionOverride?.valueForm === "storage" &&
      input.conversion.kind === "identity" &&
      (position === "target-receiver" || input.mode !== "value")
    ? expressionOverride.expression
    : undefined;
  const rawExpression = input.conversion.kind === "identity" &&
      (position === "target-receiver" || input.mode !== "value")
    ? directStorage ?? plannedExpression
    : plannedExpression;
  if (!directCarrierMatch) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, sourceNode),
      "rust.backend.provider-operation-flow-read",
      "Finalized Rust operation input requires a missing exact source-value transition.",
    ));
    return undefined;
  }
  if (sharedInput && input.conversion.kind === "identity") return rawExpression;
  const converted = applyFinalizedValueConversion(context, rawExpression, input.conversion, sourceNode, sharedInput);
  return converted === undefined
    ? undefined
    : position === "target-receiver"
      ? converted
      : applyFinalizedRustArgumentMode(
          context,
          sourceNode,
          converted,
          input,
          expressionOverride?.valueForm === "shared-reference",
        );
}
