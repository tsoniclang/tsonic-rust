import type { Node } from "@tsonic/tsts";
import type { RustCallableParameterAbi, RustCallableParameterAdapter, RustCallableParameterRead,
  RustCallableRestIteration, RustCallableRestSegment } from "../../../../target-model/records/callables/callable-adapters.js";
import { rustVecTargetType } from "../../../../target-model/types/index.js";
import type { RustExpr, RustFunctionParam, RustStmt, RustType } from "../../../target-ast/syntax/nodes.js";
import { planRustAbsentValue } from "../../expressions/optional-storage.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../../names/synthetic.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { rustPropagateLocalError } from "../../program/fallible-boundaries.js";
import { rustTargetRuntimeErrorType } from "../../types/error-boundary.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { applyRustCallableValueAdapter, applyRustCallableValueAdapterRaw } from "./adapters.js";
import { planRustParameterEntryValue } from "./parameter-entry-conversion.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { rustLintAttributes } from "../../../target-ast/normalization/lint-policy.js";

export function planRustCallableArguments(
  input: {
    readonly declaration: Node;
    readonly parameters: readonly RustFunctionParam[];
    readonly parameterAbis: readonly RustCallableParameterAbi[];
    readonly parameterAdapters: readonly RustCallableParameterAdapter[];
  },
  context: RustPlanContext,
): { readonly statements: readonly RustStmt[]; readonly adaptedArguments: readonly RustExpr[];
  readonly parameters: readonly RustFunctionParam[] } {
  function missingPlan(): never { return failRustPlannerInvariant("An admitted callable adapter requires its complete native argument adaptation.", input.declaration); }
  if (input.parameters.length !== input.parameterAbis.length) failRustPlannerInvariant(
    "An admitted callable adapter requires its complete rendered parameter vector.", input.declaration);
  const statements: RustStmt[] = [];
  const adaptedArguments: RustExpr[] = [];
  const names = context.syntheticNames ?? createRustSyntheticNameState(
    context.input.program.source.ast, input.declaration, input.parameters.map(parameter => parameter.name));
  const parameter = (index: number): RustExpr | undefined => input.parameters[index] === undefined
    ? undefined : { kind: "path", path: input.parameters[index]!.name };
  const iterators = new Map<number, string>();
  const iterator = (index: number, iteration: RustCallableRestIteration): RustExpr | undefined => {
    const existing = iterators.get(index);
    if (existing !== undefined) return { kind: "path", path: existing };
    const source = parameter(index);
    if (source === undefined) missingPlan();
    const sequence: RustExpr = iteration.collection === "js-array"
      ? { kind: "method-call", receiver: source, method: "into_values", args: [] } : source;
    const name = allocateRustSyntheticName(names, "rest_values");
    statements.push({ kind: "let", name, mutable: iteration.mutable,
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
      if (value === undefined) missingPlan();
      adaptedArguments.push(value);
      continue;
    }
    const source = parameter(adapter.contractParameterIndex);
    if (source === undefined) missingPlan();
    if (adapter.kind === "runtime-value") {
      const value = applyRustCallableValueAdapter(source, adapter.adapter, input.declaration, context);
      if (value === undefined) missingPlan();
      adaptedArguments.push(value);
      continue;
    }
    const optional = adapter.target.form === "optional" || adapter.target.form === "default";
    let value: RustExpr | undefined;
    if (adapter.kind === "rest-element") {
      const sequence = iterator(adapter.contractParameterIndex, adapter.iteration);
      if (sequence === undefined) missingPlan();
      const next: RustExpr = { kind: "method-call", receiver: sequence, receiverMode: "mut-ref", method: "next", args: [] };
      const elementName = allocateRustSyntheticName(names, "rest_value");
      const element = applyRustCallableValueAdapter({ kind: "path", path: elementName }, adapter.adapter, input.declaration, context);
      if (element === undefined) missingPlan();
      if (optional) {
        value = adapter.optionalAdapter === undefined ? next
          : applyRustCallableValueAdapter(next, adapter.optionalAdapter, input.declaration, context);
      } else {
        statements.push({ kind: "let", name: elementName, mutable: false,
          init: { kind: "method-call", receiver: next, method: "expect",
            args: [{ kind: "str-literal", value: "A required native argument is absent" }] } });
        value = element;
      }
    } else {
      const logical = readLogicalParameter(source, adapter.source, adapter.read, context);
      const selected = logical === undefined ? undefined : applyRustCallableValueAdapter(logical, adapter.adapter, input.declaration, context);
      value = selected === undefined ? undefined : optional ? { kind: "call", path: "Some", args: [selected] } : selected;
    }
    if (value === undefined) missingPlan();
    if (adapter.kind === "rest-element" || adapter.target.mode === "mut-ref") {
      const name = allocateRustSyntheticName(names, "adapted_argument");
      statements.push({ kind: "let", name, mutable: adapter.target.mode === "mut-ref", init: value });
      value = { kind: "path", path: name };
    }
    adaptedArguments.push(adapter.target.mode === "value" ? value : {
      kind: "reference", expr: value, ...(adapter.target.mode === "mut-ref" ? { mutable: true } : {}),
    });
  }
  // A contract parameter that no adapter reads (a surplus argument the implementation ignores) is unused by design.
  const used = new Set(input.parameterAdapters.flatMap(adapter => adapter.kind === "rest"
    ? adapter.segments.map(segment => segment.contractParameterIndex)
    : adapter.kind === "omitted" ? [] : [adapter.contractParameterIndex]));
  const parameters = input.parameters.map((selected, index) => used.has(index) ? selected
    : { ...selected, attrs: [...selected.attrs ?? [], rustLintAttributes.unusedVariables] });
  return { statements: Object.freeze(statements), adaptedArguments: Object.freeze(adaptedArguments), parameters: Object.freeze(parameters) };

  function planRest(adapter: Extract<RustCallableParameterAdapter, { readonly kind: "rest" }>): RustExpr {
    const vector = rustTypeFromCarrierInContext(rustVecTargetType(adapter.elementCarrier), context);
    const target = rustTypeFromCarrierInContext(adapter.target.parameterCarrier, context);
    if (vector === undefined || target === undefined) missingPlan();
    const fallible = adapter.fallible;
    const prefix: RustExpr[] = [];
    let sequence: RustExpr | undefined;
    for (const segment of adapter.segments) {
      if (segment.kind === "value") {
        const source = parameter(segment.contractParameterIndex);
        const logical = source === undefined ? undefined : readLogicalParameter(source, segment.source, segment.read, context);
        const value = logical === undefined ? undefined : mappedValue(logical, segment, fallible);
        if (value === undefined) missingPlan();
        prefix.push(value);
      } else {
        const source = iterator(segment.contractParameterIndex, segment.iteration);
        if (source === undefined) missingPlan();
        if (!fallible && segment.adapter.kind === "identity") sequence = source;
        else {
          const name = allocateRustSyntheticName(names, "rest_element");
          const value = mappedValue({ kind: "path", path: name }, segment, fallible);
          if (value === undefined) missingPlan();
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
        const region = context.fallibleBoundary;
        if (region === undefined) missingPlan();
        context.usedAliases?.add("rt");
        const propagated = rustPropagateLocalError(region, rustTargetRuntimeErrorType, value);
        if (propagated === undefined) missingPlan();
        value = propagated;
      }
    }
    return adapter.collection === "js-array"
      ? { kind: "associated-call", owner: target, method: "from_dense", args: [value] } : value;
  }

  function mappedValue(value: RustExpr, segment: RustCallableRestSegment, fallible: boolean): RustExpr {
    const converted = applyRustCallableValueAdapterRaw(value, segment.adapter, input.declaration, context);
    if (converted === undefined) missingPlan();
    return fallible && !converted.fallible
      ? { kind: "call", path: "Ok", args: [converted.expression] } : converted.expression;
  }
}

function readLogicalParameter(expression: RustExpr, abi: RustCallableParameterAbi,
  read: RustCallableParameterRead, context: RustPlanContext): RustExpr | undefined {
  if (read === "value") return planRustParameterEntryValue(abi, expression, undefined, context);
  if (read === "owned-string") return { kind: "owned-string-from-borrowed-str", expression };
  const value: RustExpr = { kind: "dereference", pointer: expression };
  return read === "copy" ? value : { kind: "method-call", receiver: value, method: "clone", args: [] };
}
