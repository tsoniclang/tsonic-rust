import type { Node } from "@tsonic/tsts";
import { rustCallableConversionMatches, type RustCallableConversion, type RustCallableValueConversion } from "../../../target-model/conversions/callable.js";
import { rustValueConversionContract } from "../../../target-model/conversions/contracts.js";
import { rustCallableProtocol, rustClosureProtocol } from "../../../target-model/types/index.js";
import { rustTypeEquals } from "../../target-ast/inspection/type-equality.js";
import type { RustExpr, RustStmt, RustType } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { rustTargetRuntimeErrorType } from "../types/error-boundary.js";
import { rustCallableConstructionType } from "./fundamentals.js";
import { rustDirectCallableReferenceFactKey } from "../../../analysis/facts/keys.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { planRustSourceCallableValue } from "./source-callable-value.js";
import { planRustAbsentValue } from "./optional-storage.js";
import { lowerRustValueConversion } from "./value-conversions.js";

export function planRustCallableConversion(
  conversion: RustCallableConversion,
  expression: RustExpr,
  node: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  const definitions = context.input.program.typeDefinitions;
  if (!rustCallableConversionMatches(conversion, conversion.source, conversion.target, definitions)) return undefined;
  const source = rustCallableProtocol(conversion.source)!;
  const native = conversion.target.kind === "closure";
  const target = rustCallableProtocol(conversion.target) ?? rustClosureProtocol(conversion.target);
  if (target === undefined) return undefined;
  const sourceType = rustCallableConstructionType(conversion.source, context);
  const targetType = rustCallableConstructionType(conversion.target, context);
  const argumentsType = rustTypeFromCarrierInContext({ kind: "tuple", elements: source.parameters }, context);
  if (sourceType === undefined || !native && targetType === undefined || argumentsType === undefined) return undefined;
  const names = context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []);
  const callable = allocateRustSyntheticName(names, "callable");
  const argumentsName = allocateRustSyntheticName(names, source.parameters.length === 0 ? "_arguments" : "arguments");
  const nativeParameters = native ? target.parameters.map((type, index) => ({
    name: allocateRustSyntheticName(names, `argument${index}`), byRefCopy: false,
    type: rustTypeFromCarrierInContext(type, context),
  })) : [];
  if (nativeParameters.some(parameter => parameter.type === undefined)) return undefined;
  const reference = context.input.program.facts.getFact(node, rustDirectCallableReferenceFactKey);
  if (reference !== undefined && !rustTargetTypeRefEquals(reference.carrier, conversion.source)) return undefined;
  const selected = reference === undefined ? expression : planRustSourceCallableValue(reference, context);
  if (selected === undefined) return undefined;
  const producer = inlineCallableProducer(selected, sourceType, argumentsType);
  const arguments_: RustExpr[] = [];
  for (const [index, parameter] of conversion.parameters.entries()) {
    const value = lowerValue(parameter, native ? { kind: "path", path: nativeParameters[index]!.name } : {
      kind: "field", receiver: { kind: "path", path: argumentsName }, name: String(index),
    });
    if (value === undefined) return undefined;
    arguments_.push(value);
  }
  const tuple: RustExpr = { kind: "tuple-literal", elements: arguments_ };
  const invocation: RustExpr = producer.inline
    ? { kind: "invoke", callee: { kind: "path", path: callable }, args: [tuple] }
    : { kind: "method-call", receiver: { kind: "path", path: callable }, method: "call", args: [tuple] };
  const resultName = allocateRustSyntheticName(names,
    conversion.result.kind === "absence" || conversion.result.kind === "discard" ? "_result" : "result");
  const result = conversion.result.kind === "absence" ? planRustAbsentValue(target.result, context)
    : conversion.result.kind === "discard" ? { kind: "tuple-literal" as const, elements: [] }
      : lowerValue(conversion.result, { kind: "path", path: resultName });
  if (result === undefined) return undefined;
  const fallibleResult = conversion.result.kind === "value" &&
    rustValueConversionContract(conversion.result.conversion, definitions)?.fallible === true;
  const body: RustExpr = conversion.result.kind === "identity" ? invocation : {
    kind: "method-call", receiver: invocation, method: fallibleResult ? "and_then" : "map", args: [{
      kind: "closure", params: [{ name: resultName, byRefCopy: false }],
      body: fallibleResult ? { kind: "call", path: "Ok", args: [result] } : result,
    }],
  };
  const closure: RustExpr = {
    kind: "closure", move: true, params: native ? nativeParameters : [{ name: argumentsName, byRefCopy: false }], body,
  };
  return { kind: "block", body: { statements: [...producer.statements, {
    kind: "let", mutable: false, name: callable, init: producer.value,
  }, { kind: "tail", expr: native ? closure : {
    kind: "associated-call", owner: targetType!, method: "new", args: [closure],
  } }] } };

  function lowerValue(selected: RustCallableValueConversion, value: RustExpr): RustExpr | undefined {
    if (selected.kind === "identity") return value;
    if (selected.kind === "borrow") return { kind: "reference", expr: value };
    if (selected.kind !== "value") return undefined;
    const contract = rustValueConversionContract(selected.conversion, definitions);
    const converted = contract === undefined ? undefined : lowerRustValueConversion(contract, value, context, node);
    return converted === undefined || contract === undefined ? undefined : contract.fallible
      ? { kind: "try", expr: converted, resultErrorType: rustTargetRuntimeErrorType, operandErrorType: rustTargetRuntimeErrorType }
      : converted;
  }
}

function inlineCallableProducer(
  expression: RustExpr,
  sourceType: RustType,
  argumentsType: RustType,
): { readonly statements: readonly RustStmt[]; readonly value: RustExpr; readonly inline: boolean } {
  if (expression.kind === "block") {
    const terminal = expression.body.statements[expression.body.statements.length - 1];
    if (terminal?.kind !== "tail" || (terminal.attrs?.length ?? 0) !== 0 ||
      (expression.body.innerAttrs?.length ?? 0) !== 0) return { statements: [], value: expression, inline: false };
    const selected = inlineCallableProducer(terminal.expr, sourceType, argumentsType);
    return selected.inline ? { ...selected, statements: [...expression.body.statements.slice(0, -1), ...selected.statements] }
      : { statements: [], value: expression, inline: false };
  }
  const body = expression.kind === "associated-call" && expression.method === "new" &&
    expression.trait === undefined && expression.genericArguments === undefined &&
    rustTypeEquals(expression.owner, sourceType) && expression.args.length === 1 ? expression.args[0] : undefined;
  return (body?.kind === "closure" || body?.kind === "closure-block") && body.params.length === 1
    ? { statements: [], inline: true, value: { ...body, params: body.params.map(parameter => ({ ...parameter, type: argumentsType })) } }
    : { statements: [], value: expression, inline: false };
}
