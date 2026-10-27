import { rustValueBlock } from "../../../target-ast/syntax/value-block.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";
import { planExpression } from "../entry.js";
import { planNativeRustArray } from "../native-arrays.js";
import { rustTypeFromCarrierInContext } from "../../types/render.js";
import type { RustBorrowedSequenceInput } from "../../../../target-model/records/storage/borrowed-sequences.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { planRustBorrowedSequenceAppend } from "./borrowed-sequences.js";

type Contribution = { readonly kind: "value"; readonly value: RustExpr }
  | { readonly kind: "spread"; readonly input: RustBorrowedSequenceInput };

export function planArrayLiteral(node: Node, context: RustPlanContext, representation: "value" | "slice" = "value"): RustExpr {
  const fact = context.input.program.records.targetOperation.get(node);
  if (fact?.kind !== "array-literal" && fact?.kind !== "tuple-literal")
    failRustPlannerInvariant("An admitted array literal requires its exact native construction record.", node);
  const sources = context.input.program.source.ast.elements(node);
  const value = (expression: Node | undefined): RustExpr => expression === undefined
    ? failRustPlannerInvariant("An admitted array contribution requires its source expression.", node)
    : planExpression(expression, context) ?? failRustPlannerInvariant("An admitted array contribution requires its native value.", expression);
  if (fact.kind === "tuple-literal") return { kind: "tuple-literal",
    elements: [...sources.map(value), ...fact.omittedOptionalElementIndexes.map((): RustExpr => ({ kind: "none" }))] };
  const contributions = fact.contributions.map((contribution, index): Contribution => contribution.kind === "spread"
    ? { kind: "spread", input: contribution.input } : { kind: "value", value: value(sources[index]) });
  if (representation === "slice") {
    if (context.input.program.records.argumentView.get(node)?.slice !== true)
      failRustPlannerInvariant("An admitted native slice operand requires its exact source construction form.", node);
    return { kind: "slice-literal", elements: contributions.map(contribution => contribution.kind === "value" ? contribution.value
      : failRustPlannerInvariant("An admitted direct slice has no spread preparation.", node)) };
  }
  const array: RustExpr = contributions.every(contribution => contribution.kind === "value")
    ? { kind: "vec-literal", elements: contributions.map(contribution => contribution.value) }
    : planSpreadArray(node, contributions, fact.elementCarrier, context);
  if (fact.length === 0) {
    const owner = rustTypeFromCarrierInContext(fact.resultCarrier, context)
      ?? failRustPlannerInvariant("An admitted empty array requires its selected native owner type.", node);
    const empty: RustExpr = { kind: "associated-call", owner, method: fact.lane === "native" ? "new" : "from_dense",
      args: fact.lane === "native" ? [] : [array] };
    if (fact.lane === "js") { context.usedAliases?.add("js_abi"); return empty; }
    return context.input.program.records.nativeArrayStorage.get(node) === undefined ? empty
      : planNativeRustArray(node, empty, context) ?? failRustPlannerInvariant("An admitted native array requires its exact layout construction.", node);
  }
  if (fact.lane === "native") return context.input.program.records.nativeArrayStorage.get(node) === undefined ? array
    : planNativeRustArray(node, array, context) ?? failRustPlannerInvariant("An admitted native array requires its exact layout construction.", node);
  context.usedAliases?.add("js_abi");
  return { kind: "call", path: "js_abi::JsArray::from_dense", args: [array] };
}

function planSpreadArray(node: Node, contributions: readonly Contribution[], elementCarrier: TargetTypeRef, context: RustPlanContext): RustExpr {
  if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted array construction requires its hygienic native bindings.", node);
  const element = rustTypeFromCarrierInContext(elementCarrier, context)
    ?? failRustPlannerInvariant("An admitted array construction requires its native element type.", node);
  const name = allocateRustSyntheticName(context.syntheticNames, "array");
  const destination: RustExpr = { kind: "path", path: name };
  let value: RustExpr = destination;
  for (let index = contributions.length - 1; index >= 0; index--) {
    const contribution = contributions[index]!;
    const effect: RustExpr = contribution.kind === "value"
      ? { kind: "method-call", receiver: destination, receiverMode: "mut-ref", method: "push", args: [contribution.value] }
      : planRustBorrowedSequenceAppend(node, contribution.input, destination, elementCarrier, context)
        ?? failRustPlannerInvariant("An admitted borrowed array spread requires its native append expression.", node);
    value = { kind: "evaluate-then", effect, discard: "unit", value };
  }
  return rustValueBlock([{ name, type: { kind: "named", path: "alloc::vec::Vec", genericArguments: [{ kind: "type", type: element }] },
    mutable: true, value: { kind: "vec-literal", elements: [] } }], value);
}
