import { rustValueBlock } from "../../../target-ast/value-block.js";
import type { Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import type { RustExpr } from "../../../target-ast/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { diagnosticInput } from "../../program/plan-context.js";
import { missingFactDiagnostic } from "../../diagnostics.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import { requireExpressionCarrier, rustOperationFact } from "../fundamentals.js";
import { planExpression } from "../entry.js";
import { planNativeRustArray } from "../native-arrays.js";
import { rustNativeArrayStorageKey } from "../../../../target-model/operations/native-memory.js";
import { rustJsArrayTargetType, rustOptionElementCarrier, rustVecTargetType } from "../../../../target-model/types/index.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import { rustEffectiveValueCarrier } from "../../../../analysis/facts/value-carrier-queries.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { hasExactObjectKeys, isDenseDataArray, isMetadataRecord } from "../../../../target-model/metadata/closed-data.js";
import type { RustBorrowedSequenceInput } from "../../../../analysis/facts/operations/borrowed-sequences.js";
import { planRustBorrowedSequenceAppend } from "./borrowed-sequences.js";

type Contribution = { readonly kind: "value"; readonly value: RustExpr }
  | { readonly kind: "spread"; readonly input: RustBorrowedSequenceInput };

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
  const contributions: Contribution[] = [];
  for (const [index, source] of sources.entries()) {
    const contribution = fact.contributions[index]!;
    if (!isMetadataRecord(contribution) ||
      !(hasExactObjectKeys(contribution, ["kind", "input"]) && contribution.kind === "spread" ||
        hasExactObjectKeys(contribution, ["kind", "carrier"]) && contribution.kind === "value")) {
      return reject(node, context, "Array contributions require their exact finalized data shape.");
    }
    const spread = source !== undefined && context.input.program.source.ast.is.IsSpreadElement(source);
    const expression = spread ? Node_Expression(context.input.program.source.ast, source!) : source;
    if (expression === undefined || spread !== (contribution.kind === "spread")) {
      return reject(node, context, "Array contribution does not match its exact finalized source expression.");
    }
    if (contribution.kind === "spread") {
      if (!isMetadataRecord(contribution.input) ||
        !hasExactObjectKeys(contribution.input, ["expression", "controlNodes", "inputs"]) ||
        expression !== contribution.input.expression) return reject(node, context, "Borrowed spread must retain its exact source expression.");
      contributions.push({ kind: "spread", input: contribution.input });
      continue;
    }
    if (!rustTargetTypeRefEquals(contribution.carrier, fact.elementCarrier) ||
      !rustTargetTypeRefEquals(context.expressionOverrides?.get(expression)?.carrier ??
        rustEffectiveValueCarrier(context.input.program.facts, expression), contribution.carrier)) {
      return reject(node, context, "Array value contribution lost its finalized source and destination carriers.");
    }
    const value = planExpression(expression, context);
    if (value === undefined) return undefined;
    contributions.push({ kind: "value", value });
  }
  const array = contributions.every(contribution => contribution.kind === "value")
    ? { kind: "vec-literal" as const, elements: contributions.map(contribution => contribution.value) }
    : planSpreadArray(node, contributions, fact.elementCarrier, context);
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
  contributions: readonly Contribution[],
  elementCarrier: import("../../../../target-model/types/model.js").TargetTypeRef,
  context: RustPlanContext,
): RustExpr | undefined {
  if (context.syntheticNames === undefined) return undefined;
  const type = rustTypeFromCarrierInContext(rustVecTargetType(elementCarrier), context);
  if (type === undefined) return undefined;
  const name = allocateRustSyntheticName(context.syntheticNames, "array");
  const destination: RustExpr = { kind: "path", path: name };
  let value: RustExpr = destination;
  for (let index = contributions.length - 1; index >= 0; index -= 1) {
    const contribution = contributions[index]!;
    let effect: RustExpr;
    if (contribution.kind === "value") {
      effect = { kind: "method-call", receiver: destination, receiverMode: "mut-ref", method: "push", args: [contribution.value] };
    } else {
      const append = planRustBorrowedSequenceAppend(node, contribution.input, destination, elementCarrier, context);
      if (append === undefined) return undefined;
      effect = append;
    }
    value = { kind: "evaluate-then", effect, discard: "unit", value };
  }
  return rustValueBlock([{ name, type, mutable: true, value: { kind: "vec-literal", elements: [] } }], value);
}

function reject(node: Node, context: RustPlanContext, message: string): undefined {
  context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node), "rust.backend.array-literal", message));
  return undefined;
}
