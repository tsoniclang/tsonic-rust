import {
  isRustCopyCarrier,
  isRustNeverCarrier,
  rustCarrierSupportsClone,
  rustPrimitiveTypeName,
} from "../../../target-model/types/index.js";
import {
  isRustFinalizedArrayInput,
  isRustFinalizedConstantInput,
  isRustFinalizedSliceInput,
  isRustFinalizedTaggedArrayInput,
  validateRustFinalizedOperationAbi,
} from "../../../analysis/facts/finalized-operation-abi.js";
import { applyRustErrorBoundary } from "../types/error-boundary.js";
import { applyRustProviderEvaluationScope, planRustProviderEvaluationScope } from "../project/provider-evaluation-scope.js";
import { diagnosticInput, registerAliasFromPath, rustActiveErrorType } from "../program/plan-context.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { planExpression } from "./entry.js";
import { planRustNonConsumingValue } from "./typed-locations.js";
import { rustBinaryOperatorTraitPath } from "../../../target-model/syntax/tokens.js";
import { rustBottomExpression } from "../types/fallible-shape.js";
import { rustValueCarrierTransitionTarget } from "../../../analysis/facts/value-carrier-queries.js";
import { rustFinalizedCarrierTransitionMatches } from "../../../analysis/facts/target-operation.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import {
  rustTargetGenericArgumentToAstInContext,
  rustTypeFromCarrierInContext,
} from "../types/render.js";
import type {
  RustProviderConstantArgument,
  RustProviderChainStep,
  RustTargetOperationFact,
} from "../../../analysis/facts/keys.js";
import type { Node } from "@tsonic/tsts";
import type {
  RustCallGenericArgument,
  RustExpr,
  RustGenericArgument,
} from "../../target-ast/nodes.js";
import type { RustFinalizedInputPlanOverrides } from "../project/provider-evaluation-scope.js";
import type { RustFinalizedSourceInput, RustFinalizedTargetInput } from "../../../analysis/facts/finalized-operation-abi.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import {
  applyFinalizedRustArgumentMode,
} from "./input-shaping.js";
import { invokeRustStructuralObjectMethod } from "../objects/project-storage.js";
import { applyFinalizedValueConversion } from "./value-conversions.js";

function providerConstantExpression(argument: RustProviderConstantArgument): RustExpr {
  switch (argument.kind) {
    case "integer":
      return { kind: "int-literal", text: String(argument.value) };
    case "float64":
      return { kind: "float-literal", text: rustFloat64ConstantText(argument.value) };
    case "string":
      return { kind: "str-literal", value: argument.value };
    case "boolean":
      return { kind: "bool-literal", value: argument.value };
    case "none":
      return { kind: "none" };
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
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>,
  receiverNode: Node | undefined,
  argumentNodes: readonly (Node | undefined)[],
  operationNode: Node,
  options: {
    readonly resultUse: "value" | "storage";
    readonly overrides?: RustFinalizedInputPlanOverrides;
  },
): RustExpr | undefined {
  if (!validateRustFinalizedOperationAbi(fact.abi)) {
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
  if (!rustTargetTypeRefEquals(fact.resultCarrier, abiResultCarrier)) {
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
    receiverNode,
    argumentNodes,
    planExpression,
    options.overrides?.inputs,
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
  const args: RustExpr[] = [];
  for (const input of fact.abi.targetArguments) {
    const planned = planFinalizedTargetInput(
      context,
      input,
      receiverNode,
      argumentNodes,
      operationNode,
      overrides,
    );
    if (planned === undefined) {
      return undefined;
    }
    args.push(planned);
  }
  const form = fact.abi.target;
  const receiverMode = fact.abi.targetReceiver.kind === "input"
    ? fact.abi.targetReceiver.input.mode
    : undefined;
  const targetGenericArguments = fact.abi.targetGenericArguments.flatMap((argument) => {
    if (argument.kind === "lifetime") return [];
    const planned = rustTargetGenericArgumentToAstInContext(argument, context);
    return planned === undefined ? [undefined] : [planned];
  });
  if (targetGenericArguments.some((argument) => argument === undefined)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, operationNode),
      "rust.backend.provider-target-generic-arguments",
      "Provider operation target generic arguments do not have exact Rust target forms.",
    ));
    return undefined;
  }
  const concreteTargetGenericArguments = targetGenericArguments.length === 0
    ? undefined
    : targetGenericArguments as readonly RustCallGenericArgument[];
  const scoped = (expression: RustExpr | undefined): RustExpr | undefined =>
    expression === undefined || evaluationScope.kind !== "selected"
      ? expression
      : applyRustProviderEvaluationScope(expression, evaluationScope);
  switch (form.form) {
    case "marker":
      return undefined;
    case "arg-method": {
      if (receiver === undefined || fact.abi.targetReceiver.kind !== "input") {
        return undefined;
      }
      const typedReceiver = typeNumericMethodReceiverLiteral(
        receiver,
        fact.abi.targetReceiver.input.parameterCarrier,
      );
      if (typedReceiver === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, operationNode),
          "rust.backend.arg-method-receiver-type",
          "Argument-method literal receiver requires an explicit finalized Rust numeric receiver carrier.",
        ));
        return undefined;
      }
      return scoped({
        kind: "method-call",
        receiver: typedReceiver,
        method: form.name,
        args,
        ...(concreteTargetGenericArguments === undefined ? {} : { genericArguments: concreteTargetGenericArguments }),
      });
    }
    case "call": {
      registerAliasFromPath(context, form.path);
      return scoped(applyProviderOperationChain({
        kind: "call",
        path: form.path,
        args,
        ...(concreteTargetGenericArguments === undefined ? {} : { genericArguments: concreteTargetGenericArguments }),
      }, form.chain));
    }
    case "call-c-variadic":
      registerAliasFromPath(context, form.path);
      return scoped({
        kind: "call",
        path: form.path,
        args,
        ...(concreteTargetGenericArguments === undefined ? {} : { genericArguments: concreteTargetGenericArguments }),
      });
    case "call-value-slice":
    case "call-value-array":
    case "call-str-slice":
    case "free-call-str-slice":
    case "free-call": {
      registerAliasFromPath(context, form.path);
      return scoped({ kind: "call", path: form.path, args });
    }
    case "path": {
      registerAliasFromPath(context, form.path);
      return scoped(args.length === 0 ? { kind: "path", path: form.path } : undefined);
    }
    case "static": {
      registerAliasFromPath(context, form.path);
      return scoped(args.length === 0 ? { kind: "path", path: form.path } : undefined);
    }
    case "method":
    case "arg-receiver-method":
    case "receiver-value-array":
    case "receiver-tagged-array":
      return scoped(receiver === undefined
        ? undefined
        : {
            kind: "method-call",
            receiver,
            method: form.name,
            args,
            ...(concreteTargetGenericArguments === undefined ? {} : { genericArguments: concreteTargetGenericArguments }),
            ...(receiverMode === undefined ? {} : { receiverMode }),
          });
    case "arg-structural-method": {
      if (receiver === undefined || fact.abi.targetReceiver.kind !== "input") {
        return undefined;
      }
      return scoped(invokeRustStructuralObjectMethod(
        fact.abi.targetReceiver.input.parameterCarrier,
        receiver,
        form.storageIndex,
        args,
        fact.resultCarrier,
        context,
      ));
    }
    case "receiver-method":
      return receiver === undefined
        ? undefined
        : scoped(applyProviderOperationChain(
            {
              kind: "method-call",
              receiver,
              method: form.name,
              args,
              ...(concreteTargetGenericArguments === undefined ? {} : { genericArguments: concreteTargetGenericArguments }),
              ...(receiverMode === undefined ? {} : { receiverMode }),
            },
            form.chain,
          ));
    case "field": {
      if (receiver === undefined || args.length !== 0) {
        return undefined;
      }
      const field: RustExpr = { kind: "field", receiver, name: form.name };
      if (options.resultUse === "storage") {
        return scoped(field);
      }
      if (isRustCopyCarrier(fact.resultCarrier)) {
        return scoped(field);
      }
      if (!rustCarrierSupportsClone(fact.resultCarrier)) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, operationNode),
          "rust.backend.provider-field-read-ownership",
          "A provider field read requires an exact Copy or Clone result-carrier contract.",
        ));
        return undefined;
      }
      return scoped({ kind: "method-call", receiver: field, method: "clone", args: [] });
    }
    case "index": {
      if (receiver === undefined || args.length !== 1) {
        return undefined;
      }
      const index = args[0];
      return scoped(index === undefined
        ? undefined
        : { kind: "index", receiver, index });
    }
    case "binary-operator": {
      const [left, right] = args;
      if (left === undefined || right === undefined || args.length !== 2) {
        return undefined;
      }
      if (rustBinaryOperatorTraitPath(form.operator) !== form.trait) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, receiverNode ?? argumentNodes[0] ?? context.sourceFile),
          "rust.backend.provider-operator-trait",
          "Provider binary operation does not carry the exact finalized Rust trait identity for its operator.",
        ));
        return undefined;
      }
      return scoped({ kind: "binary", operator: form.operator, left, right });
    }
    case "trait-call": {
      const owner = rustTypeFromCarrierInContext(form.owner, context);
      const traitGenericArguments = form.traitGenericArguments.map((argument) =>
        rustTargetGenericArgumentToAstInContext(argument, context));
      if (owner === undefined || traitGenericArguments.some((argument) => argument === undefined)) {
        return undefined;
      }
      registerAliasFromPath(context, form.traitPath);
      return scoped({
        kind: "associated-call",
        owner,
        trait: {
          kind: "named",
          path: form.traitPath,
          ...(traitGenericArguments.length === 0
            ? {}
            : {
                genericArguments: traitGenericArguments as readonly RustGenericArgument[],
              }),
        },
        method: form.method,
        args,
        ...(concreteTargetGenericArguments === undefined ? {} : { genericArguments: concreteTargetGenericArguments }),
      });
    }
    case "trait-associated-value": {
      const owner = rustTypeFromCarrierInContext(form.owner, context);
      const traitGenericArguments = form.traitGenericArguments.map((argument) =>
        rustTargetGenericArgumentToAstInContext(argument, context));
      if (owner === undefined || traitGenericArguments.some((argument) => argument === undefined) || args.length !== 0) {
        return undefined;
      }
      registerAliasFromPath(context, form.traitPath);
      return scoped({
        kind: "associated-value",
        owner,
        trait: {
          kind: "named",
          path: form.traitPath,
          ...(traitGenericArguments.length === 0
            ? {}
            : {
                genericArguments: traitGenericArguments as readonly RustGenericArgument[],
              }),
        },
        name: form.name,
      });
    }
    case "associated-value": {
      const owner = rustTypeFromCarrierInContext(form.owner, context);
      if (owner === undefined || args.length !== 0) {
        return undefined;
      }
      return scoped({
        kind: "associated-value",
        owner,
        name: form.name,
      });
    }
  }
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

function typeNumericMethodReceiverLiteral(
  expression: RustExpr,
  carrier: TargetTypeRef,
): RustExpr | undefined {
  if (expression.kind === "unary" && expression.operator === "-") {
    const operand = typeNumericMethodReceiverLiteral(expression.operand, carrier);
    return operand === undefined ? undefined : { ...expression, operand };
  }
  if (expression.kind !== "float-literal" && expression.kind !== "int-literal") {
    return expression;
  }
  if (carrier.kind !== "source-primitive") {
    return undefined;
  }
  const suffix = rustPrimitiveTypeName(carrier.name);
  return suffix === undefined
    ? undefined
    : { ...expression, text: `${expression.text}${suffix}` };
}

function applyProviderOperationChain(
  expression: RustExpr,
  chain: readonly RustProviderChainStep[] | undefined,
): RustExpr | undefined {
  let result = expression;
  for (const step of chain ?? []) {
    if (step.kind !== "method") {
      return undefined;
    }
    result = { kind: "method-call", receiver: result, method: step.name, args: [] };
  }
  return result;
}

export function finishProviderOperationExpression(
  context: RustPlanContext,
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>,
  expression: RustExpr,
  node: Node,
): RustExpr | undefined {
  let raw = expression;
  if (fact.abi.effects.invocation === "fallible") {
    const activeErrorType = rustActiveErrorType(context);
    if (activeErrorType === undefined) {
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
    raw = applyRustErrorBoundary(
      raw,
      fact.abi.effects.errorBoundary,
      activeErrorType,
      rustTypeFromCarrierInContext(fact.abi.effects.errorCarrier, context),
    );
  }
  if (fact.abi.result.kind === "async") {
    return raw;
  }
  const converted = applyFinalizedValueConversion(
    context,
    raw,
    fact.abi.result.conversion,
    node,
    "operation-result",
  );
  return converted === undefined || !isRustNeverCarrier(fact.resultCarrier)
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
): RustExpr | undefined {
  if (isRustFinalizedConstantInput(input)) {
    return providerConstantExpression(input.source.value);
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
  const sourceNode = input.source.kind === "receiver"
    ? receiverNode
    : argumentNodes[input.source.sourceIndex];
  if (sourceNode === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, operationNode),
      "rust.backend.provider-operation-input",
      "Finalized Rust operation input has no corresponding source node.",
    ));
    return undefined;
  }
  const expressionOverride = context.expressionOverrides?.get(sourceNode);
  const sourceCarrier = expressionOverride?.carrier ??
    context.input.program.facts.getRuntimeCarrierFact(sourceNode)?.carrier;
  const convertedCarrier = expressionOverride === undefined
    ? rustValueCarrierTransitionTarget(context.input.program.facts, sourceNode)
    : undefined;
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
  const plannedExpression = sourceValueOverride ??
    planExpression(sourceNode, context);
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
    ? directStorage ?? planRustNonConsumingValue(sourceNode, plannedExpression, context)
    : plannedExpression;
  if (!directCarrierMatch) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, sourceNode),
      "rust.backend.provider-operation-flow-read",
      "Finalized Rust operation input requires a missing exact source-value transition.",
    ));
    return undefined;
  }
  const converted = applyFinalizedValueConversion(context, rawExpression, input.conversion, sourceNode, "source-input");
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
