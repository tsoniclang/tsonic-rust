import type { Node } from "@tsonic/tsts";
import { sourceSequenceInputChoice, sourceSequenceInputIsEmpty } from "@tsonic/target-api/source";
import type { RustBorrowedSequenceInput } from "../../../../analysis/facts/operations/borrowed-sequences.js";
import { rustEffectiveValueCarrier } from "../../../../analysis/facts/value-carrier-queries.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import { rustOptionElementCarrier } from "../../../../target-model/types/carriers/optional.js";
import { rustRestSequenceElements } from "../../../../target-model/operations/rest-assembly.js";
import { rustValueConversionContract } from "../../../../target-model/conversions/contracts.js";
import type { RustExpr } from "../../../target-ast/nodes.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { diagnosticInput } from "../../program/plan-context.js";
import { missingFactDiagnostic } from "../../diagnostics.js";
import { planExpression } from "../entry.js";
import { planRustNonConsumingValue } from "../typed-locations.js";
import { planRustSequenceAppend } from "../sequence-conversions.js";
import { lowerNestedRustValueConversion } from "../value-conversions.js";
import { rustCarrierHasCloneContract } from "../../types/generic-requirements.js";
import { rustVecTargetType } from "../../../../target-model/types/index.js";
import type { TargetTypeRef } from "../../../../target-model/types/model.js";

export function planRustBorrowedSequenceAppend(
  node: Node, fact: RustBorrowedSequenceInput, destination: RustExpr,
  elementCarrier: TargetTypeRef, context: RustPlanContext,
): RustExpr | undefined {
  const choice = sourceSequenceInputChoice(context.input.program.source.ast, fact.expression);
  if (choice === undefined || choice.inputs.length !== fact.inputs.length ||
    choice.inputs.some((expression, index) => expression !== fact.inputs[index]?.expression) ||
    choice.controlNodes.length !== fact.controlNodes.length ||
    choice.controlNodes.some((expression, index) => expression !== fact.controlNodes[index])) {
    return reject("Borrowed sequence choice must match its finalized source alternatives.");
  }
  const branch = (index: number): RustExpr | undefined => {
    const selected = fact.inputs[index];
    if (selected === undefined) return { kind: "tuple-literal", elements: [] };
    if (selected.kind === "empty") return sourceSequenceInputIsEmpty(context.input.program.source.ast, selected.expression)
      ? { kind: "tuple-literal", elements: [] } : reject("Only an exact empty array literal may omit source construction.");
    const carrier = context.expressionOverrides?.get(selected.expression)?.carrier ??
      rustEffectiveValueCarrier(context.input.program.facts, selected.expression);
    const present = rustOptionElementCarrier(selected.carrier);
    const contract = rustValueConversionContract(selected.conversion, context.input.program.typeDefinitions);
    if (!rustTargetTypeRefEquals(carrier, selected.carrier) ||
      !rustTargetTypeRefEquals(present ?? selected.carrier, selected.presentCarrier) ||
      selected.optional !== (present !== undefined) || contract?.lowering !== "rest-sequence" ||
      !rustTargetTypeRefEquals(contract.source, selected.presentCarrier) ||
      !rustTargetTypeRefEquals(contract.target, rustVecTargetType(elementCarrier)) ||
      rustRestSequenceElements(selected.presentCarrier)?.elements.some(element => !rustCarrierHasCloneContract(element, context))) {
      return reject("Borrowed sequence selection lost its exact native presence, storage or element conversion.");
    }
    const planned = planExpression(selected.expression, context, "value",
      selected.optional || contract.collection === "js-array" || selected.presentCarrier.kind === "reference"
        ? "shared-receiver" : "shared-reference");
    if (planned === undefined || context.syntheticNames === undefined) return undefined;
    const value = planRustNonConsumingValue(selected.expression, planned, context);
    const consume = (source: RustExpr): RustExpr | undefined => planRustSequenceAppend(contract, source,
      destination, context, node, (conversion, element) => lowerNestedRustValueConversion(conversion, element, context, node));
    if (!selected.optional) return consume(value);
    const name = allocateRustSyntheticName(context.syntheticNames, "sequence");
    const consumed = consume({ kind: "path", path: name });
    const otherwise = branch(index + 1);
    if (consumed === undefined || otherwise === undefined) return undefined;
    return { kind: "match", expression: { kind: "method-call", receiver: value, method: "as_ref", args: [] }, arms: [
      { pattern: { kind: "tuple-variant", path: "Some", elements: [{ kind: "binding", name }] }, expression: consumed },
      { pattern: { kind: "path", path: "None" }, expression: otherwise },
    ] };
  };
  return branch(0);

  function reject(message: string): undefined {
    context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node), "rust.backend.borrowed-sequence", message));
    return undefined;
  }
}
