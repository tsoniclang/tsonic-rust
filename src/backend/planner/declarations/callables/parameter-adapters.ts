import type { Node } from "@tsonic/tsts";
import type { RustCallableParameterAbi, RustCallableParameterAdapter, RustCallableRestSegment } from "../../../../analysis/facts/callable-adapters.js";
import { callableRestElement, selectRustCallableParameterAdapters, rustCallableValueAdapterIsFallible } from "../../../../analysis/callables/adapters.js";
import { closedMetadataEquals } from "../../../../target-model/metadata/closed-data.js";
import { isRustCopyCarrier, isRustJsArrayCarrier, isRustStringCarrier, rustCarrierSupportsClone, rustOptionTargetType, rustVecTargetType } from "../../../../target-model/types/index.js";
import type { RustExpr, RustFunctionParam, RustStmt, RustType } from "../../../target-ast/nodes.js";
import { planRustAbsentValue } from "../../expressions/optional-storage.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../../names/synthetic.js";
import { rustActiveErrorType, type RustPlanContext } from "../../program/plan-context.js";
import { rustTargetRuntimeErrorType } from "../../types/error-boundary.js";
import { requireRustCarrierRequirements } from "../../types/generic-requirements.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { applyRustCallableValueAdapter, applyRustCallableValueAdapterRaw } from "./adapters.js";
import { planRustParameterEntryValue } from "./parameter-entry-conversion.js";

export function planRustCallableArguments(
  input: {
    readonly declaration: Node;
    readonly parameters: readonly RustFunctionParam[];
    readonly parameterAbis: readonly RustCallableParameterAbi[];
    readonly parameterAdapters: readonly RustCallableParameterAdapter[];
  },
  context: RustPlanContext,
): { readonly statements: readonly RustStmt[]; readonly adaptedArguments: readonly RustExpr[] } | undefined {
  const definitions = context.input.program.typeDefinitions;
  const expected = selectRustCallableParameterAdapters(input.parameterAbis,
    input.parameterAdapters.map(adapter => adapter.target), context.input.program.projectTypes, definitions);
  if (input.parameters.length !== input.parameterAbis.length || expected === undefined ||
    !closedMetadataEquals(expected, input.parameterAdapters)) return undefined;
  const statements: RustStmt[] = [];
  const adaptedArguments: RustExpr[] = [];
  const names = context.syntheticNames ?? createRustSyntheticNameState(
    context.input.program.source.ast, input.declaration, input.parameters.map(parameter => parameter.name));
  const parameter = (index: number): RustExpr | undefined => input.parameters[index] === undefined
    ? undefined : { kind: "path", path: input.parameters[index]!.name };
  const iterators = new Map<number, string>();
  const iterator = (index: number): RustExpr | undefined => {
    const existing = iterators.get(index);
    if (existing !== undefined) return { kind: "path", path: existing };
    const abi = input.parameterAbis[index];
    const source = parameter(index);
    const element = abi === undefined ? undefined : callableRestElement(abi.parameterCarrier);
    if (abi === undefined || source === undefined || element === undefined) return undefined;
    const shared = isRustJsArrayCarrier(abi.parameterCarrier);
    if (shared && !rustCarrierSupportsClone(element, definitions) &&
      !requireRustCarrierRequirements(element, ["clone"], input.declaration, context)) return undefined;
    const sequence: RustExpr = shared ? { kind: "method-call", receiver: source, method: "into_values", args: [] } : source;
    const name = allocateRustSyntheticName(names, "rest_values");
    const extracted = input.parameterAdapters.some(adapter => adapter.kind === "rest-element" && adapter.contractParameterIndex === index);
    statements.push({ kind: "let", name, mutable: extracted,
      init: { kind: "method-call", receiver: sequence, method: "into_iter", args: [] } });
    iterators.set(index, name);
    return { kind: "path", path: name };
  };
  for (const adapter of input.parameterAdapters) {
    if (adapter.kind === "omitted") {
      adaptedArguments.push(planRustAbsentValue(adapter.target.parameterCarrier, context));
      continue;
    }
    if (adapter.kind === "rest") {
      const value = planRest(adapter);
      if (value === undefined) return undefined;
      adaptedArguments.push(value);
      continue;
    }
    const source = parameter(adapter.contractParameterIndex);
    if (source === undefined) return undefined;
    if (adapter.kind === "runtime-value") {
      const value = applyRustCallableValueAdapter(source, adapter.adapter, input.declaration, context);
      if (value === undefined) return undefined;
      adaptedArguments.push(value);
      continue;
    }
    const optional = adapter.target.form === "optional" || adapter.target.form === "default";
    let value: RustExpr | undefined;
    if (adapter.kind === "rest-element") {
      const sequence = iterator(adapter.contractParameterIndex);
      if (sequence === undefined) return undefined;
      const next: RustExpr = { kind: "method-call", receiver: sequence, receiverMode: "mut-ref", method: "next", args: [] };
      const elementName = allocateRustSyntheticName(names, "rest_value");
      const element = applyRustCallableValueAdapter({ kind: "path", path: elementName }, adapter.adapter, input.declaration, context);
      if (element === undefined) return undefined;
      if (optional) {
        value = adapter.adapter.kind === "identity" ? next : applyRustCallableValueAdapter(next, {
          kind: "option-map", sourceCarrier: rustOptionTargetType(adapter.adapter.sourceCarrier),
          targetCarrier: adapter.target.parameterCarrier, element: adapter.adapter,
        }, input.declaration, context);
      } else {
        statements.push({ kind: "let", name: elementName, mutable: false,
          init: { kind: "method-call", receiver: next, method: "expect",
            args: [{ kind: "str-literal", value: "A required native argument is absent" }] } });
        value = element;
      }
    } else {
      const logical = readLogicalParameter(source, adapter.source, context);
      const selected = logical === undefined ? undefined : applyRustCallableValueAdapter(logical, adapter.adapter, input.declaration, context);
      value = selected === undefined ? undefined : optional ? { kind: "call", path: "Some", args: [selected] } : selected;
    }
    if (value === undefined) return undefined;
    if (adapter.kind === "rest-element" || adapter.target.mode === "mut-ref") {
      const name = allocateRustSyntheticName(names, "adapted_argument");
      statements.push({ kind: "let", name, mutable: adapter.target.mode === "mut-ref", init: value });
      value = { kind: "path", path: name };
    }
    adaptedArguments.push(adapter.target.mode === "value" ? value : {
      kind: "reference", expr: value, ...(adapter.target.mode === "mut-ref" ? { mutable: true } : {}),
    });
  }
  return { statements: Object.freeze(statements), adaptedArguments: Object.freeze(adaptedArguments) };

  function planRest(adapter: Extract<RustCallableParameterAdapter, { readonly kind: "rest" }>): RustExpr | undefined {
    const element = callableRestElement(adapter.target.parameterCarrier);
    const vector = element === undefined ? undefined : rustTypeFromCarrierInContext(rustVecTargetType(element), context);
    const target = rustTypeFromCarrierInContext(adapter.target.parameterCarrier, context);
    if (vector === undefined || target === undefined) return undefined;
    const fallible = adapter.segments.some(segment => rustCallableValueAdapterIsFallible(segment.adapter, definitions));
    const prefix: RustExpr[] = [];
    let sequence: RustExpr | undefined;
    for (const segment of adapter.segments) {
      if (segment.kind === "value") {
        const source = parameter(segment.contractParameterIndex);
        const logical = source === undefined ? undefined : readLogicalParameter(source, segment.source, context);
        const value = logical === undefined ? undefined : mappedValue(logical, segment, fallible);
        if (value === undefined) return undefined;
        prefix.push(value);
      } else {
        const source = iterator(segment.contractParameterIndex);
        if (source === undefined) return undefined;
        if (!fallible && segment.adapter.kind === "identity") sequence = source;
        else {
          const name = allocateRustSyntheticName(names, "rest_element");
          const value = mappedValue({ kind: "path", path: name }, segment, fallible);
          if (value === undefined) return undefined;
          sequence = { kind: "method-call", receiver: source, method: "map",
            args: [{ kind: "closure", params: [{ name, byRefCopy: false }], body: value }] };
        }
      }
    }
    let value: RustExpr;
    if (sequence === undefined && !fallible) value = { kind: "vec-literal", elements: prefix };
    else {
      const fixed: RustExpr = { kind: "method-call", receiver: { kind: "slice-literal", elements: prefix }, method: "into_iter", args: [] };
      const iterated: RustExpr = sequence === undefined ? fixed : prefix.length === 0 ? sequence : {
        kind: "method-call", receiver: fixed, method: "chain", args: [sequence],
      };
      const collectedType: RustType = fallible ? { kind: "named", path: "Result", genericArguments: [
        { kind: "type", type: vector }, { kind: "type", type: rustTargetRuntimeErrorType },
      ] } : vector;
      value = { kind: "method-call", receiver: iterated, method: "collect",
        genericArguments: [{ kind: "type", type: collectedType }], args: [] };
      if (fallible) {
        const errorType = rustActiveErrorType(context);
        if (errorType === undefined) return undefined;
        context.usedAliases?.add("rt");
        value = { kind: "try", expr: value, resultErrorType: errorType, operandErrorType: rustTargetRuntimeErrorType };
      }
    }
    return isRustJsArrayCarrier(adapter.target.parameterCarrier)
      ? { kind: "associated-call", owner: target, method: "from_dense", args: [value] } : value;
  }

  function mappedValue(value: RustExpr, segment: RustCallableRestSegment, fallible: boolean): RustExpr | undefined {
    const converted = applyRustCallableValueAdapterRaw(value, segment.adapter, input.declaration, context);
    return converted === undefined ? undefined : fallible && !converted.fallible
      ? { kind: "call", path: "Ok", args: [converted.expression] } : converted.expression;
  }
}

function readLogicalParameter(expression: RustExpr, abi: RustCallableParameterAbi, context: RustPlanContext): RustExpr | undefined {
  if (abi.mode === "value") return planRustParameterEntryValue(abi, expression, undefined, context);
  if (isRustStringCarrier(abi.valueCarrier)) return { kind: "owned-string-from-borrowed-str", expression };
  const value: RustExpr = { kind: "dereference", pointer: expression };
  return isRustCopyCarrier(abi.valueCarrier) ? value : rustCarrierSupportsClone(abi.valueCarrier, context.input.program.typeDefinitions)
    ? { kind: "method-call", receiver: value, method: "clone", args: [] } : undefined;
}
