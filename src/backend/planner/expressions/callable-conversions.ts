import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustCallableConversion } from "../../../target-model/conversions/callable.js";
import { rustCallableConversionPhysical, type RustCallablePhysicalConversion,
  type RustCallablePhysicalValueConversion } from "../../../target-model/conversions/callable-physical.js";
import { rustCallableInputProtocol } from "../../../target-model/types/index.js";
import { rustTypeEquals } from "../../target-ast/inspection/type-equality.js";
import type { RustExpr, RustStmt, RustType } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustCallableConstructionType } from "./fundamentals.js";
import { rustDirectCallableReferenceFactKey } from "../../../analysis/facts/keys.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { planRustSourceCallableValue } from "./source-callable-value.js";
import { planRustAbsentValue } from "./optional-storage.js";
import { lowerRustValueConversion } from "./value-conversions.js";
import { rustModuleCallableStorageFactKey } from "../../../analysis/callables/module-values.js";
import { planRustNonConsumingValue } from "./typed-locations.js";
import { rustNativeCallableOperand, type RustNativeCallablePhysicalSource } from "../../../analysis/callables/native-conversions.js";
import { planRustNativeProtocolInvocation } from "./calls/native-input.js";
import { planRustNativeErrorJoin } from "../types/native-error-joins.js";
import { rustNativeErrorJoinIdentity } from "../../../target-model/types/native-error-joins.js";

export function planRustCallableInputProducer(
  expression: RustExpr, source: TargetTypeRef, context: RustPlanContext,
  node?: Node,
): RustExpr | undefined {
  const reference = node === undefined ? undefined : context.input.program.facts.getFact(node, rustDirectCallableReferenceFactKey);
  if (reference !== undefined && context.input.program.facts.getFact(reference.sourceDeclaration, rustModuleCallableStorageFactKey)?.kind === "inline") {
    if (!rustTargetTypeRefEquals(reference.carrier, source)) return undefined;
    const selected = planRustSourceCallableValue(reference, context);
    if (selected === undefined) return undefined;
    expression = selected;
  }
  if (node === undefined) return expression;
  const physical = physicalCallableSource(source, node, context);
  const sourceType = physical === undefined ? undefined : rustCallableConstructionType(physical.carrier, context);
  if (sourceType === undefined) return undefined;
  const producer = inlineCallableProducer(expression, sourceType);
  return producer.inline ? { kind: "block", body: { statements: [...producer.statements, { kind: "tail", expr: producer.value }] } } : expression;
}

export function planRustCallableConversion(
  conversion: RustCallableConversion,
  expression: RustExpr,
  node: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  const reference = context.input.program.facts.getFact(node, rustDirectCallableReferenceFactKey);
  if (reference !== undefined && !rustTargetTypeRefEquals(reference.carrier, conversion.source)) return undefined;
  const selected = reference === undefined ? expression : planRustSourceCallableValue(reference, context);
  const source = physicalCallableSource(conversion.source, node, context);
  const file = context.input.program.source.ast.getSourceFile(node);
  const fileName = file === undefined ? undefined : context.input.program.source.ast.getFileName(file);
  const physical = source === undefined || fileName === undefined ? undefined :
    rustCallableConversionPhysical(conversion, source.signature, fileName, context.input.program.typeDefinitions);
  return selected === undefined || source === undefined || physical === undefined || fileName === undefined ? undefined
    : planSelectedRustCallableConversion(physical, source, selected, fileName, node, context);
}

function planSelectedRustCallableConversion(
  conversion: RustCallablePhysicalConversion,
  source: RustNativeCallablePhysicalSource,
  expression: RustExpr,
  fileName: string,
  node: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  const native = conversion.logical.target.kind === "closure";
  const input = rustCallableInputProtocol(conversion.logical.target) !== undefined;
  const sourceType = rustCallableConstructionType(source.carrier, context);
  const targetType = native || input ? undefined : rustCallableConstructionType(conversion.carrier, context);
  const argumentsType = rustTypeFromCarrierInContext({ kind: "tuple", elements: conversion.parameters }, context);
  const errorType = rustTypeFromCarrierInContext(conversion.error, context);
  if (sourceType === undefined || argumentsType === undefined || errorType === undefined) return undefined;
  if (!native && !input && targetType === undefined) return undefined;
  const arity = conversion.errors.length;
  const joinName = arity === 1 ? "NativeErrors1" : context.input.errorRegions.nameFor(fileName, arity);
  const errorSources = conversion.errors.map(error => {
    const errorType = rustTypeFromCarrierInContext(error.errorType, context);
    return errorType === undefined ? undefined : { ...error, errorType };
  });
  const join = joinName === undefined || errorSources.some(error => error === undefined) ? undefined : planRustNativeErrorJoin({
    identity: rustNativeErrorJoinIdentity(fileName, arity), name: joinName, visibility: "public",
    ...(arity > 1 && errorType.kind === "named" ? { referencePath: errorType.path } : {}),
    sources: errorSources as NonNullable<typeof errorSources[number]>[],
  });
  if (join?.errorType === undefined || !rustTypeEquals(join.errorType, errorType)) return undefined;
  const names = context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []);
  const callable = allocateRustSyntheticName(names, "callable");
  const argumentsName = allocateRustSyntheticName(names, source.signature.parameters.length === 0 ? "_arguments" : "arguments");
  const nativeParameters = native ? conversion.parameters.map((type, index) => ({
    name: allocateRustSyntheticName(names, `argument${index}`), byRefCopy: false,
    type: rustTypeFromCarrierInContext(type, context),
  })) : [];
  if (nativeParameters.some(parameter => parameter.type === undefined)) return undefined;
  const producer = inlineCallableProducer(expression, sourceType);
  const arguments_: RustExpr[] = [];
  for (const [index, parameter] of conversion.arguments.entries()) {
    const value = lowerValue(parameter, native ? { kind: "path", path: nativeParameters[index]!.name } : {
      kind: "field", receiver: { kind: "path", path: argumentsName }, name: String(index),
    });
    if (value === undefined) return undefined;
    arguments_.push(value);
  }
  const tuple: RustExpr = { kind: "tuple-literal", elements: arguments_ };
  const invocation: RustExpr | undefined = source.input !== undefined
    ? planRustNativeProtocolInvocation(source.input, { kind: "path", path: callable }, arguments_, undefined, context)
    : producer.inline
    ? { kind: "invoke", callee: { kind: "path", path: callable }, args: [tuple] }
    : { kind: "method-call", receiver: { kind: "path", path: callable },
        method: rustCallableInputProtocol(conversion.logical.source) === undefined ? "call" : "invoke", args: [tuple] };
  if (invocation === undefined) return undefined;
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
    kind: "closure", move: true, params: native ? nativeParameters : [{ name: argumentsName, byRefCopy: false, type: argumentsType }], body,
  };
  const value = input && !producer.inline
    ? { kind: "reference" as const, expr: source.input === undefined
      ? planRustNonConsumingValue(node, producer.value, context) : producer.value }
    : producer.value;
  const adapted: RustExpr = { kind: "block", body: { statements: [...producer.statements, {
    kind: "let", mutable: false, name: callable, init: value,
  }, { kind: "tail", expr: native || input ? closure : {
    kind: "associated-call", owner: targetType!, method: "new", args: [closure],
  } }] } };
  return input ? { kind: "reference", expr: adapted } : adapted;

  function lowerValue(selected: RustCallablePhysicalValueConversion, value: RustExpr): RustExpr | undefined {
    if (selected.kind === "identity") return value;
    if (selected.kind === "borrow") return { kind: "reference", expr: value };
    if (selected.kind === "callable") {
      return planSelectedRustCallableConversion(selected.conversion, { carrier: source.signature.result,
        signature: selected.conversion.source }, value, fileName, node, { ...context, syntheticNames: names });
    }
    if (selected.kind !== "value") return undefined;
    const converted = lowerRustValueConversion(selected.contract, value, context, node);
    if (converted === undefined || selected.errorIdentity === undefined) return converted;
    const error = errorSources.find(error => error?.identity === selected.errorIdentity);
    return error === undefined ? undefined : join!.propagate(error, converted);
  }
}

function physicalCallableSource(
  source: TargetTypeRef,
  node: Node,
  context: RustPlanContext,
): RustNativeCallablePhysicalSource | undefined {
  const program = context.input.program;
  return rustNativeCallableOperand(source, node, { facts: program.facts,
    storage: program.callableValues.nativeStorage, producers: program.callableValues.nativeProducers,
    definitions: program.typeDefinitions });
}

function inlineCallableProducer(
  expression: RustExpr,
  sourceType: RustType,
): { readonly statements: readonly RustStmt[]; readonly value: RustExpr; readonly inline: boolean } {
  if (expression.kind === "block") {
    const terminal = expression.body.statements[expression.body.statements.length - 1];
    if (terminal?.kind !== "tail" || (terminal.attrs?.length ?? 0) !== 0 ||
      (expression.body.innerAttrs?.length ?? 0) !== 0) return { statements: [], value: expression, inline: false };
    const selected = inlineCallableProducer(terminal.expr, sourceType);
    return selected.inline ? { ...selected, statements: [...expression.body.statements.slice(0, -1), ...selected.statements] }
      : { statements: [], value: expression, inline: false };
  }
  const body = expression.kind === "closure" || expression.kind === "closure-block" ? expression
    : expression.kind === "associated-call" && expression.method === "new" &&
    expression.trait === undefined && expression.genericArguments === undefined &&
    rustTypeEquals(expression.owner, sourceType) && expression.args.length === 1 ? expression.args[0] : undefined;
  return (body?.kind === "closure" || body?.kind === "closure-block") && body.params.length === 1
    ? { statements: [], inline: true, value: body }
    : { statements: [], value: expression, inline: false };
}
