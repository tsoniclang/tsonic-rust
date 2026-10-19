import type { Node } from "@tsonic/tsts";

import type { RustTargetOperationFact } from "../../../../target-model/records/operations.js";
import { rustEffectiveValueCarrier } from "../../../../analysis/conversions/value-carrier-queries.js";
import { rustSliceElementCarrier } from "../../../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../../target-model/types/equality.js";
import type { RustExpr } from "../../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import { canBorrowRustSingletonSlice, planRustBorrowedSingletonSlice } from "./rest-assembly.js";
import { planExpression } from "../entry.js";

export function planRustSourceCallArgumentValue(
  argument: Node, index: number, argumentNodes: readonly Node[],
  fact: Extract<RustTargetOperationFact, { readonly kind: "source-call" }>,
  context: RustPlanContext, borrowedInputs: Map<Node, RustExpr>,
): RustExpr | undefined {
  const selected = fact.parameters.filter(parameter => parameter.inputs.some(input => input.sourceArgumentIndex === index));
  const parameter = selected.length === 1 ? selected[0] : undefined;
  const input = parameter?.inputs[0];
  const construction = context.input.program.records.targetOperation.get(argument);
  const ast = context.input.program.source.ast;
  const element = ast.is.IsArrayLiteralExpression(argument) ? ast.elements(argument)[0] : undefined;
  const contribution = construction?.kind === "array-literal" ? construction.contributions[0] : undefined;
  if (parameter?.mode === "ref" && parameter.inputs.length === 1 && input?.sourceForm === "value" &&
    input.sourceArgumentIndex === index && construction?.kind === "array-literal" && construction.lane === "native" &&
    construction.contributions.length === 1 && contribution?.kind === "value" && element !== undefined &&
    rustTargetTypeRefEquals(rustSliceElementCarrier(parameter.parameterCarrier), construction.elementCarrier) &&
    rustTargetTypeRefEquals(contribution.carrier, construction.elementCarrier) &&
    rustTargetTypeRefEquals(rustEffectiveValueCarrier(context.input.program.records, element), construction.elementCarrier) &&
    canBorrowRustSingletonSlice(element, context, argumentNodes.slice(index + 1))) {
    const planned = planRustBorrowedSingletonSlice(element, context);
    if (planned !== undefined) borrowedInputs.set(argument, planned);
    return planned;
  }
  return planExpression(argument, context);
}
