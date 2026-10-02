import type { Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import type { RustExpr } from "../../../target-ast/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { diagnosticInput } from "../../program/plan-context.js";
import { missingFactDiagnostic } from "../../diagnostics.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import { requireExpressionCarrier, rustOperationFact } from "../fundamentals.js";
import { planExpression } from "../entry.js";
import { planRustNonConsumingValue } from "../typed-locations.js";
import { planNativeRustArray } from "../native-arrays.js";
import { rustNativeArrayStorageKey } from "../../../../target-model/operations/native-memory.js";
import { rustJsArrayTargetType, rustOptionElementCarrier, rustVecTargetType } from "../../../../target-model/types/index.js";
import { rustValueConversionContract, type RustValueConversionContract } from "../../../../target-model/conversions/contracts.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { rustCarrierHasCloneContract } from "../../types/generic-requirements.js";
import { rustRestSequenceElements } from "../../../../target-model/operations/rest-assembly.js";
import { rustEffectiveValueCarrier } from "../../../../analysis/facts/value-carrier-queries.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { isDenseDataArray } from "../../../../target-model/metadata/closed-data.js";
import { applyRustArgumentMode } from "../input-shaping.js";
import { planRustSequenceAppend } from "../sequence-conversions.js";
import { lowerNestedRustValueConversion } from "../value-conversions.js";

type SpreadContract = Extract<RustValueConversionContract, { readonly lowering: "rest-sequence" }>;

export function planArrayLiteral(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if (fact?.kind !== "array-literal" && fact?.kind !== "tuple-literal") {
    return reject(node, context, "Array literals require a finalized Rust construction fact.");
  }
  if (!requireExpressionCarrier(node, fact.resultCarrier, context,
    fact.kind === "tuple-literal" ? "rust.backend.tuple-literal-carrier" : "rust.backend.array-literal-carrier")) return undefined;
  const sources = context.input.program.source.ast.elements(node);
  if (fact.kind === "tuple-literal") {
    const elements: RustExpr[] = [];
    for (const [index, source] of sources.entries()) {
      if (source === undefined || fact.resultCarrier.kind !== "tuple" || !rustTargetTypeRefEquals(
        context.expressionOverrides?.get(source)?.carrier ?? rustEffectiveValueCarrier(context.input.program.facts, source),
        fact.resultCarrier.elements[index])) {
        return reject(node, context, "Tuple contribution does not match its exact finalized destination storage.");
      }
      const value = source === undefined ? undefined : planExpression(source, context);
      if (value === undefined) return undefined;
      elements.push(value);
    }
    const tuple = fact.resultCarrier.kind === "tuple" ? fact.resultCarrier : undefined;
    if (tuple === undefined || elements.length + fact.omittedOptionalElementIndexes.length !== tuple.elements.length ||
      fact.omittedOptionalElementIndexes.some((index, offset) => index !== elements.length + offset ||
        rustOptionElementCarrier(tuple.elements[index]) === undefined)) {
      return reject(node, context, "Tuple omissions conflict with the finalized native tuple carrier.");
    }
    return { kind: "tuple-literal", elements: [...elements, ...fact.omittedOptionalElementIndexes.map((): RustExpr => ({ kind: "none" }))] };
  }
  if (!isDenseDataArray(fact.contributions) || sources.length !== fact.length || sources.length !== fact.contributions.length ||
    (fact.lane !== "js" && fact.lane !== "native") || !rustTargetTypeRefEquals(fact.resultCarrier,
      fact.lane === "js" ? rustJsArrayTargetType(fact.elementCarrier) : rustVecTargetType(fact.elementCarrier))) {
    return reject(node, context, "Array contributions conflict with the finalized source element count.");
  }
  const elements: RustExpr[] = [];
  const spreads: (SpreadContract | undefined)[] = [];
  for (const [index, source] of sources.entries()) {
    const contribution = fact.contributions[index]!;
    const spread = source !== undefined && context.input.program.source.ast.is.IsSpreadElement(source);
    const expression = spread ? Node_Expression(context.input.program.source.ast, source!) : source;
    if (expression === undefined || spread !== (contribution.kind === "spread") ||
      !spread && !rustTargetTypeRefEquals(contribution.carrier, fact.elementCarrier) ||
      !rustTargetTypeRefEquals(context.expressionOverrides?.get(expression)?.carrier ??
        rustEffectiveValueCarrier(context.input.program.facts, expression), contribution.carrier)) {
      return reject(node, context, "Array contribution does not match its exact finalized source expression.");
    }
    const sequence = contribution.kind === "spread" && contribution.conversion?.kind === "rest-sequence"
      ? rustValueConversionContract(contribution.conversion, context.input.program.typeDefinitions) : undefined;
    if (spread && (sequence?.lowering !== "rest-sequence" ||
      !rustTargetTypeRefEquals(sequence.source, contribution.carrier) ||
      !rustTargetTypeRefEquals(sequence.target, rustVecTargetType(fact.elementCarrier)) ||
      rustRestSequenceElements(contribution.carrier)?.elements.some(element => !rustCarrierHasCloneContract(element, context)))) {
      return reject(node, context, "Array spread requires one checked dense sequence and an exact native Clone contract.");
    }
    const value = planExpression(expression, context);
    if (value === undefined) return undefined;
    const input = spread ? planRustNonConsumingValue(expression, value, context) : value;
    elements.push(spread && sequence?.lowering === "rest-sequence" && sequence.collection !== "js-array"
      ? applyRustArgumentMode(context, input, "ref", expression) : input);
    spreads.push(sequence?.lowering === "rest-sequence" ? sequence : undefined);
  }
  const array = spreads.every(spread => spread === undefined)
    ? { kind: "vec-literal" as const, elements }
    : planSpreadArray(node, elements, spreads, fact.elementCarrier, context);
  if (array === undefined) return undefined;
  if (fact.length === 0) {
    const owner = rustTypeFromCarrierInContext(fact.resultCarrier, context);
    if (owner === undefined) return reject(node, context, "Empty array construction requires its exact native element storage type.");
    const empty: RustExpr = { kind: "associated-call", owner,
      method: fact.lane === "native" ? "new" : "from_dense", args: fact.lane === "native" ? [] : [array] };
    if (fact.lane === "js") { context.usedAliases?.add("js_abi"); return empty; }
    return context.input.program.facts.getFact(node, rustNativeArrayStorageKey) === undefined
      ? empty : planNativeRustArray(node, empty, context);
  }
  if (fact.lane === "native") return context.input.program.facts.getFact(node, rustNativeArrayStorageKey) === undefined
    ? array : planNativeRustArray(node, array, context);
  context.usedAliases?.add("js_abi");
  return { kind: "call", path: "js_abi::JsArray::from_dense", args: [array] };
}

function planSpreadArray(
  node: Node,
  elements: readonly RustExpr[],
  spreads: readonly (SpreadContract | undefined)[],
  elementCarrier: import("../../../../target-model/types/model.js").TargetTypeRef,
  context: RustPlanContext,
): RustExpr | undefined {
  if (context.syntheticNames === undefined) return undefined;
  const type = rustTypeFromCarrierInContext(rustVecTargetType(elementCarrier), context);
  if (type === undefined) return undefined;
  const name = allocateRustSyntheticName(context.syntheticNames, "array");
  const destination: RustExpr = { kind: "path", path: name };
  let value: RustExpr = destination;
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const source = elements[index]!;
    const spread = spreads[index];
    let effect: RustExpr;
    if (spread === undefined) {
      effect = { kind: "method-call", receiver: destination, method: "push", args: [source] };
    } else {
      const append = planRustSequenceAppend(spread, source, destination, context, node,
        (conversion, value) => lowerNestedRustValueConversion(conversion, value, context, node));
      if (append === undefined) return undefined;
      effect = append;
    }
    value = { kind: "evaluate-then", effect, discard: "unit", value };
  }
  return { kind: "block", bindings: [{ name, type, mutable: true, value: { kind: "vec-literal", elements: [] } }], value };
}

function reject(node: Node, context: RustPlanContext, message: string): undefined {
  context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node), "rust.backend.array-literal", message));
  return undefined;
}
