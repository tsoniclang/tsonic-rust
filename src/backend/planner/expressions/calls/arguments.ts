import type { Node } from "@tsonic/tsts";
import type { RustTargetOperationFact } from "../../../../target-model/records/operations/operations.js";
import type { RustSourceCallFact, RustSourceCallInputEmission, RustSourceParameterEmission } from "../../../../target-model/records/calls/source-call-arguments.js";
import type { RustExpr, RustPattern, RustStmt } from "../../../target-ast/syntax/nodes.js";
import { rustValueBlock } from "../../../target-ast/syntax/value-block.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import { applyRustArgumentMode } from "../input-shaping.js";
import { planExpression } from "../entry.js";
import { planRustRestAssembly } from "./rest-assembly.js";
import { planRustSourceCallArgumentValue } from "./singleton-slices.js";
import { rustValueDestinationContext } from "../value-destinations.js";
import { planRustAbsentValue } from "../optional-storage.js";
import { lowerRustValueConversion } from "../value-conversions.js";

export interface RustSourceArgumentEvaluation {
  readonly arguments: readonly RustExpr[];
  readonly nodes: readonly Node[];
  readonly bindings: readonly RustStmt[];
  readonly borrowedInputs: ReadonlyMap<Node, RustExpr>;
  readonly elements: ReadonlyMap<number, ReadonlyMap<number, RustExpr>>;
}

export function shapeRustSourceCallParameters(plan: RustSourceArgumentEvaluation, fact: RustSourceCallFact,
  context: RustPlanContext): readonly RustExpr[] {
  const parameters = context.input.program.records.sourceCallParameters.get(fact)
    ?? failRustPlannerInvariant("An admitted source call requires its exact native parameter assembly.", context.callableDeclaration ?? context.sourceFile);
  return parameters.map(parameter => {
    if (parameter.form !== "rest") {
      const input = parameter.inputs[0];
      return input === undefined ? planRustAbsentValue(parameter.carrier, context) : shapeSourceInput(plan, input, context);
    }
    if (parameter.rest === "fixed") {
      if (parameter.inputs.length === 1 && parameter.inputs[0]?.sequence !== "value") return shapeSourceInput(plan, parameter.inputs[0]!, context);
      return { kind: "slice-literal", elements: parameter.inputs.map(input => shapeSourceInput(plan, input, context)) };
    }
    if (parameter.rest === "tuple") {
      if (parameter.inputs.length === 1 && parameter.inputs[0]?.sequence !== "value") return shapeSourceInput(plan, parameter.inputs[0]!, context);
      return { kind: "tuple-literal", elements: [...parameter.inputs.map(input => shapeSourceInput(plan, input, context)),
        ...parameter.omitted.map(carrier => planRustAbsentValue(carrier, context))] };
    }
    const sequence = parameter.inputs.some(input => input.sequence !== "value");
    if (sequence && parameter.inputs.length === 1) return shapeSourceInput(plan, parameter.inputs[0]!, context);
    const values = parameter.inputs.map(input => ({ value: shapeSourceInput(plan, input, context), sequence: input.sequence }));
    const array: RustExpr = !sequence ? { kind: "vec-literal", elements: values.map(input => input.value) }
      : planRustRestAssembly(values.map(input => ({ value: input.sequence === "js"
        ? { kind: "method-call", receiver: input.value, method: "iter_values", args: [] } : input.value,
      sequence: input.sequence !== "value" })), context)
        ?? failRustPlannerInvariant("An admitted native rest parameter requires its exact ordered sequence assembly.", context.callableDeclaration ?? context.sourceFile);
    return planSourceRestArray(array, parameter, context);
  });
}

function planSourceRestArray(value: RustExpr, parameter: RustSourceParameterEmission, context: RustPlanContext): RustExpr {
  if (parameter.rest === "native") return value;
  context.usedAliases?.add("js_abi");
  return { kind: "call", path: "js_abi::JsArray::from_dense", args: [value] };
}

function shapeSourceInput(plan: RustSourceArgumentEvaluation, input: RustSourceCallInputEmission, context: RustPlanContext): RustExpr {
  const node = plan.nodes[input.argumentIndex];
  let value = plan.arguments[input.argumentIndex];
  if (node === undefined || value === undefined) failRustPlannerInvariant("An admitted native parameter requires its exact evaluated argument.", context.callableDeclaration ?? context.sourceFile);
  const projection = input.projection;
  if (projection?.kind === "element") value = plan.elements.get(input.argumentIndex)?.get(projection.index)
    ?? failRustPlannerInvariant("An admitted consuming fixed spread requires its exact moved or borrowed element.", node);
  else if (projection !== undefined) {
    value = projection.kind === "fixed" ? { kind: "index", receiver: value, index: { kind: "int-literal", text: String(projection.index) } }
      : { kind: "field", receiver: value, name: String(projection.index) };
    if (projection.clone) value = { kind: "method-call", receiver: value, method: "clone", args: [] };
  }
  if (projection !== undefined && projection.conversion !== null) {
    const conversion = projection.conversion;
    const source = conversion.sourceMode === "ref" && projection.kind !== "element"
      ? applyRustArgumentMode(context, { stage: "finalized", expression: value }, "ref") : value;
    value = lowerRustValueConversion(conversion, source, context, node)
      ?? failRustPlannerInvariant("An admitted spread input requires its selected native projection conversion.", node);
  }
  if (input.passing === "value" || input.passing === "identity" || plan.borrowedInputs.get(node) === value) return value;
  return applyRustArgumentMode(context, projection !== undefined || plan.bindings.length !== 0
    ? { stage: "finalized", expression: value }
    : { stage: "source", expression: value, node }, input.passing);
}

export function planRustSourceCallArgumentEvaluation(call: Node, context: RustPlanContext): RustSourceArgumentEvaluation {
  const selected = context.input.program.records.sourceCallEvaluation.get(call)
    ?? failRustPlannerInvariant("An admitted source call requires its exact argument evaluation order and native destinations.", call);
  const borrowedInputs = new Map<Node, RustExpr>();
  const planned = selected.arguments.map(argument => {
    const input = rustValueDestinationContext(argument.source, argument.destination, context);
    const value = selected.spread ? planExpression(argument.expression, input)
      : planRustSourceCallArgumentValue(argument.expression, input, borrowedInputs);
    if (value === undefined) failRustPlannerInvariant("An admitted source argument requires its exact native expression.", argument.expression);
    return argument.borrow === "ref" || argument.borrow === "mut-ref"
      ? { kind: "reference" as const, expr: value, ...(argument.borrow === "mut-ref" ? { mutable: true } : {}) } : value;
  });
  const nodes = selected.arguments.map(argument => argument.source);
  if (!selected.spread) return { arguments: planned, nodes, bindings: [], borrowedInputs, elements: new Map() };
  const names = context.syntheticNames ?? failRustPlannerInvariant("An admitted source spread requires its hygienic native evaluation scope.", call);
  const values = planned.map(() => allocateRustSyntheticName(names, "spread_argument"));
  const bindings: RustStmt[] = planned.map((value, index) => ({ kind: "let", name: values[index]!,
    mutable: selected.arguments[index]!.mutable, init: value }));
  const elements = new Map<number, ReadonlyMap<number, RustExpr>>();
  for (const [argumentIndex, argument] of selected.arguments.entries()) {
    if (argument.elements.length === 0) continue;
    const selectedNames = new Map(argument.elements.map(element => [element.index, {
      name: allocateRustSyntheticName(names, "spread_element"), mode: element.mode,
    }]));
    const last = argument.elements[argument.elements.length - 1]!.index;
    const pattern: RustPattern = { kind: "slice", rest: true,
      elements: Array.from({ length: last + 1 }, (_unused, index): RustPattern => {
        const value = selectedNames.get(index);
        return value === undefined ? { kind: "wildcard" } : { kind: "binding", name: value.name,
          ...(value.mode === "value" ? {} : { borrow: value.mode }) };
      }) };
    bindings.push({ kind: "let-pattern", pattern, init: { kind: "path", path: values[argumentIndex]! } });
    elements.set(argumentIndex, new Map<number, RustExpr>([...selectedNames].map(([index, value]): [number, RustExpr] => [index, { kind: "path", path: value.name }])));
  }
  return { arguments: values.map(path => ({ kind: "path", path })), nodes, bindings, borrowedInputs, elements };
}

export function planRustSelectedSourceCallArguments(call: Node, context: RustPlanContext): {
  readonly arguments: readonly RustExpr[]; readonly statements: readonly RustStmt[];
} {
  const fact = context.input.program.records.targetOperation.get(call);
  if (fact?.kind !== "source-call") failRustPlannerInvariant("An admitted source construction requires its exact call ABI.", call);
  const plan = planRustSourceCallArgumentEvaluation(call, context);
  return { arguments: shapeRustSourceCallParameters(plan, fact, context), statements: plan.bindings };
}

export function planPromotedSourceMethodCall(node: Node, location: RustExpr, method: string,
  arguments_: readonly RustExpr[], context: RustPlanContext): RustExpr {
  const names = context.syntheticNames ?? failRustPlannerInvariant("An admitted promoted method requires its hygienic native argument scope.", node);
  const locationName = allocateRustSyntheticName(names, "location");
  const ownerName = allocateRustSyntheticName(names, "location_value");
  const argumentsBindings = arguments_.map((value, index) => ({ name: allocateRustSyntheticName(names, `location_argument_${index}`), value }));
  const receiver: RustExpr = arguments_.length === 0 ? location : { kind: "path", path: locationName };
  const call: RustExpr = { kind: "method-call", receiver: { kind: "path", path: ownerName }, method,
    args: argumentsBindings.map(binding => ({ kind: "path", path: binding.name })) };
  const mutation: RustExpr = { kind: "method-call", receiver, method: "with_mut", args: [{ kind: "closure",
    params: [{ name: ownerName, byRefCopy: false }], body: call }] };
  return arguments_.length === 0 ? mutation : rustValueBlock([{ name: locationName, value: location }, ...argumentsBindings], mutation);
}

export function requireProviderArgumentPassingFacts(context: RustPlanContext,
  fact: Extract<RustTargetOperationFact, { readonly kind: "provider-operation" }>, arguments_: readonly (Node | undefined)[]): boolean {
  if (context.input.program.records.providerArguments.get(fact.abi) !== true || arguments_.length !== fact.abi.sourceArguments.length ||
    arguments_.some(argument => argument === undefined))
    failRustPlannerInvariant("An admitted provider call requires its exact pre-seal source arity and native parameter passing.", arguments_.find(argument => argument !== undefined) ?? context.sourceFile);
  return true;
}
