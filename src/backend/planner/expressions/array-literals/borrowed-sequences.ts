import type { Node } from "@tsonic/tsts";
import type { RustBorrowedSequenceInput } from "../../../../target-model/records/borrowed-sequences.js";
import type { RustExpr } from "../../../target-ast/syntax/nodes.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { planExpression } from "../entry.js";
import { planRustSequenceAppend } from "../sequence-conversions.js";
import { lowerNestedRustValueConversion } from "../value-conversions.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";

export function planRustBorrowedSequenceAppend(node: Node, fact: RustBorrowedSequenceInput, destination: RustExpr,
  elementCarrier: TargetTypeRef, context: RustPlanContext): RustExpr {
  const selected = context.input.program.records.borrowedSequenceEmission.get(fact, elementCarrier);
  if (selected === undefined) failRustPlannerInvariant("An admitted borrowed sequence requires its exact native consumption plan.", node);
  const branch = (index: number): RustExpr => {
    const input = selected.inputs[index];
    if (input === undefined || input.kind === "empty") return { kind: "tuple-literal", elements: [] };
    const value = planExpression(input.expression, context, "value", input.mode)
      ?? failRustPlannerInvariant("An admitted borrowed sequence requires its native value.", input.expression);
    const consume = (source: RustExpr): RustExpr => planRustSequenceAppend(input.contract, source, destination, context, node,
      (conversion, element) => lowerNestedRustValueConversion(conversion, element, context, node))
      ?? failRustPlannerInvariant("An admitted borrowed sequence requires its native element append.", input.expression);
    if (!input.optional) return consume(value);
    if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted optional sequence requires hygienic native bindings.", input.expression);
    const name = allocateRustSyntheticName(context.syntheticNames, "sequence");
    return { kind: "match", expression: { kind: "method-call", receiver: value, method: "as_ref", args: [] }, arms: [
      { pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name }] }, expression: consume({ kind: "path", path: name }) },
      { pattern: { kind: "path", path: "None" }, expression: branch(index + 1) },
    ] };
  };
  return branch(0);
}
