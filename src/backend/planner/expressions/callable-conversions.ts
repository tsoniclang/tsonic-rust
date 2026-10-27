import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustCallableConversion } from "../../../target-model/conversions/callable.js";
import type { RustCallablePhysicalValueConversion } from "../../../target-model/conversions/callable-physical.js";
import type { RustCallableConversionEmission, RustCallableOperandEmission } from "../../../target-model/records/callables/callable-conversions.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustCallableConstructionType } from "../types/constructions.js";

import { planRustSourceCallableValueConstruction } from "./source-callable-value.js";
import { planRustCallableExpressionBody } from "./callable.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planRustAbsentValue } from "./optional-storage.js";
import { lowerRustValueConversion } from "./value-conversions.js";

import { createRustSharedReferenceArgument, type RustArgumentValue } from "./input-shaping.js";
import { planRustNativeProtocolInvocation } from "./calls/native-input.js";
import { planRustNativeErrorJoin } from "../types/native-error-joins.js";
import { rustNativeErrorJoinIdentity } from "../../../target-model/types/native-error-joins.js";

export function planRustCallableInputProducer(
  argument: RustArgumentValue, source: TargetTypeRef, context: RustPlanContext,
  node?: Node,
): RustArgumentValue | undefined {
  if (node === undefined) return argument;
  const selected = context.input.program.records.callableOperand.get(node, source)
    ?? failRustPlannerInvariant("An admitted callable input requires its exact physical source operand.", node);
  const producer = planCallableOperand(selected, argument.expression, node, context);
  return producer.inline ? { stage: "finalized", expression: producer.value } : argument;
}

export function planRustCallableConversion(
  conversion: RustCallableConversion,
  expression: RustExpr,
  node: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  const selected = context.input.program.records.callableContract.get(node, conversion)
    ?? failRustPlannerInvariant("An admitted callable adapter requires its exact physical conversion contract.", node);
  const operand = context.input.program.records.callableOperand.get(node, conversion.source)
    ?? failRustPlannerInvariant("An admitted callable adapter requires its exact physical source operand.", node);
  const producer = planCallableOperand(operand, expression, node, context);
  return planSelectedRustCallableConversion(selected, producer.inline
    ? { stage: "finalized", expression: producer.value }
    : { stage: "source", expression: producer.value, node }, producer.inline, node, context);
}

function planSelectedRustCallableConversion(
  emission: RustCallableConversionEmission,
  argument: RustArgumentValue,
  inline: boolean,
  node: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  const { physical: conversion, source, fileName } = emission;
  const native = emission.target === "closure";
  const input = emission.target === "input";
  const targetType = native || input ? undefined : rustCallableConstructionType(conversion.carrier, context);
  // A native closure target takes its arguments as separate parameters; only a runtime callable takes the tuple.
  const argumentsType = native ? undefined : rustTypeFromCarrierInContext({ kind: "tuple", elements: conversion.parameters }, context);
  const errorType = rustTypeFromCarrierInContext(conversion.error, context);
  if (!native && argumentsType === undefined || errorType === undefined || !native && !input && targetType === undefined)
    failRustPlannerInvariant("An admitted callable conversion requires its rendered native argument, result and error types.", node);
  const arity = conversion.errors.length;
  const joinName = context.input.program.records.nativeErrorJoinName.get(fileName, arity);
  const errorSources = conversion.errors.map(error => {
    const errorType = rustTypeFromCarrierInContext(error.errorType, context);
    return errorType === undefined ? undefined : { ...error, errorType };
  });
  const join = joinName === undefined || errorSources.some(error => error === undefined) ? undefined : planRustNativeErrorJoin({
    identity: rustNativeErrorJoinIdentity(fileName, arity), name: joinName, visibility: "public", resultShape: "result",
    ...(arity > 1 && errorType.kind === "named" ? { referencePath: errorType.path } : {}),
    sources: errorSources as NonNullable<typeof errorSources[number]>[],
  });
  if (join?.errorType === undefined) failRustPlannerInvariant("An admitted callable conversion requires its sealed native error join.", node);
  const names = context.syntheticNames ?? failRustPlannerInvariant("An admitted callable conversion requires its hygienic name scope.", node);
  const callable = allocateRustSyntheticName(names, "callable");
  const argumentsName = allocateRustSyntheticName(names, source.signature.parameters.length === 0 ? "_arguments" : "arguments");
  const nativeParameters = native ? conversion.parameters.map((type, index) => ({
    name: allocateRustSyntheticName(names, `argument${index}`), byRefCopy: false,
    type: rustTypeFromCarrierInContext(type, context),
  })) : [];
  if (nativeParameters.some(parameter => parameter.type === undefined)) return undefined;
  const borrowed = input && !inline;
  const arguments_: RustExpr[] = [];
  for (const [index, parameter] of conversion.arguments.entries()) {
    const value = lowerValue(parameter, native ? { kind: "path", path: nativeParameters[index]!.name } : {
      kind: "field", receiver: { kind: "path", path: argumentsName }, name: String(index),
    });
    if (value === undefined) return undefined;
    arguments_.push(value);
  }
  const tuple: RustExpr = { kind: "tuple-literal", elements: arguments_ };
  const invoked: RustExpr | undefined = source.input !== undefined
    ? planRustNativeProtocolInvocation(source.input, borrowed ? { kind: "path", path: callable }
      : { kind: "reference", expr: { kind: "path", path: callable } }, arguments_, undefined, context)
    : inline
    ? { kind: "invoke", callee: { kind: "path", path: callable }, args: [tuple] }
    : { kind: "method-call", receiver: { kind: "path", path: callable },
        method: emission.invocation, args: [tuple] };
  if (invoked === undefined) return undefined;
  let invocation: RustExpr = invoked;
  if (conversion.eliminatedInvokeError === true) {
    const errorName = allocateRustSyntheticName(names, "error");
    // The eliminated error has no value, so the mapped error type is named for inference.
    invocation = { kind: "method-call", receiver: invoked, method: "map_err",
      genericArguments: [{ kind: "type", type: errorType }, { kind: "type", type: { kind: "infer" } }], args: [{
      kind: "closure", params: [{ name: errorName, byRefCopy: false }],
      body: { kind: "match", expression: { kind: "path", path: errorName }, arms: [] },
    }] };
  } else if (conversion.errorPlan !== undefined) {
    const errorName = allocateRustSyntheticName(names, "error");
    const converted = lowerRustValueConversion(conversion.errorPlan, { kind: "path", path: errorName }, context, node);
    if (converted === undefined) return undefined;
    invocation = { kind: "method-call", receiver: invoked, method: "map_err", args: [{
      kind: "closure", params: [{ name: errorName, byRefCopy: false }], body: converted,
    }] };
  }
  const resultName = allocateRustSyntheticName(names,
    conversion.resultPlan.kind === "absence" || conversion.resultPlan.kind === "discard" ? "_result" : "result");
  const result = conversion.resultPlan.kind === "absence" ? planRustAbsentValue(conversion.result, context)
    : conversion.resultPlan.kind === "discard" ? { kind: "tuple-literal" as const, elements: [] }
      : lowerValue(conversion.resultPlan, { kind: "path", path: resultName });
  if (result === undefined) return undefined;
  let body: RustExpr;
  if (arity === 1) body = conversion.resultPlan.kind === "identity" ? invocation : {
      kind: "method-call", receiver: invocation, method: "map", args: [{
        kind: "closure", params: [{ name: resultName, byRefCopy: false }], body: result,
      }],
    };
  else {
    const invoked = join.propagate(errorSources[0]!, invocation);
    if (invoked === undefined) return undefined;
    body = { kind: "block", body: { statements: [
      { kind: "let", mutable: false, name: resultName, init: invoked },
      { kind: "tail", expr: { kind: "call", path: "Ok", genericArguments: [
        { kind: "type", type: { kind: "infer" } }, { kind: "type", type: errorType },
      ], args: [result] } },
    ] } };
  }
  const closure: RustExpr = {
    kind: "closure", move: true, params: native || argumentsType === undefined ? nativeParameters : [{ name: argumentsName, byRefCopy: false, type: argumentsType }], body,
  };
  const value = borrowed
    ? createRustSharedReferenceArgument(context, argument)
    : argument.expression;
  const adapted: RustExpr = { kind: "block", body: { statements: [{
    kind: "let", mutable: false, name: callable, init: value,
  }, { kind: "tail", expr: native || input ? closure : {
    kind: "associated-call", owner: targetType!, method: "new", args: [closure],
  } }] } };
  return input ? { kind: "reference", expr: adapted } : adapted;

  function lowerValue(selected: RustCallablePhysicalValueConversion, value: RustExpr): RustExpr | undefined {
    if (selected.kind === "identity") return value;
    if (selected.kind === "borrow") return { kind: "reference", expr: value };
    if (selected.kind === "callable") {
      const nested = emission.nested.get(selected.conversion)
        ?? failRustPlannerInvariant("An admitted nested callable conversion requires its exact native contract.", node);
      return planSelectedRustCallableConversion(nested, { stage: "finalized", expression: value }, false, node, { ...context, syntheticNames: names });
    }
    if (selected.kind !== "value") return undefined;
    const converted = lowerRustValueConversion(selected.contract, value, context, node);
    if (converted === undefined || selected.errorIdentity === undefined) return converted;
    const error = errorSources.find(error => error?.identity === selected.errorIdentity);
    return error === undefined ? undefined : join!.propagate(error, converted);
  }
}

function planCallableOperand(
  selected: RustCallableOperandEmission, expression: RustExpr, node: Node, context: RustPlanContext,
): { readonly value: RustExpr; readonly inline: boolean } {
  if (selected.inline === undefined || context.expressionOverrides?.has(node) === true) return { value: expression, inline: false };
  const value = selected.inline.kind === "named"
    ? planRustSourceCallableValueConstruction(selected.inline.value, context, "producer")
    : planRustCallableExpressionBody(node, context, "value", "producer")?.expression;
  if (value === undefined) failRustPlannerInvariant("An admitted direct callable producer requires its native closure syntax.", node);
  return { value, inline: true };
}
