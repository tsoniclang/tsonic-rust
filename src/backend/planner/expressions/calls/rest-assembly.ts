import { rustValueBlock } from "../../../target-ast/syntax/value-block.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import { rustVecRestAssembly } from "../../../../target-model/operations/rest-assembly.js";
import type { RustExpr } from "../../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import type { Node } from "@tsonic/tsts";
import { createRustSharedReferenceArgument } from "../input-shaping.js";
import { rustExpressionReadsStorage } from "../typed-locations.js";
import { planExpression } from "../entry.js";
import { isRustStringCarrier } from "../../../../target-model/types/index.js";


export function planRustBorrowedSingletonSlice(
  node: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  const value = planExpression(node, context, "value", "shared-place");
  if (value === undefined) return undefined;
  return { kind: "call", path: "core::slice::from_ref", args: [
    createRustSharedReferenceArgument(context, value, node),
  ] };
}

export function canBorrowRustSingletonSlice(
  node: Node, context: RustPlanContext, later: readonly Node[],
): boolean {
  if (!rustExpressionReadsStorage(node, context) || context.expressionOverrides?.has(node) === true) return false;
  if (!context.input.program.valueLifetimes.canBorrowStableValue(node) &&
    later.some(value => !context.input.program.borrowStability.canBorrowAcross(node, value))) return false;
  const declaration = context.input.program.sourceNavigation.sourceReferenceFor(node)?.declaration;
  const parameter = context.input.program.records.sourceParameterAbi.get(node) ??
    context.input.program.records.sourceParameterAbi.get(declaration);
  if (parameter?.mode === "ref" && isRustStringCarrier(parameter.valueCarrier)) return false;
  const captured = [...context.capturedBindings ?? []].reverse().find(value => value.declaration === declaration);
  const borrowed = captured?.borrowedCarrier;
  return borrowed?.kind !== "reference" || borrowed.mutable || !isRustStringCarrier(borrowed.referent);
}

export function planRustRestAssembly(
  segments: readonly { readonly value: RustExpr; readonly sequence: boolean }[],
  context: RustPlanContext,
): RustExpr | undefined {
  if (segments.length === 1 && segments[0]?.sequence === true) return segments[0].value;
  if (context.syntheticNames === undefined) return undefined;
  const name = allocateRustSyntheticName(context.syntheticNames, "spread_rest");
  const collection: RustExpr = { kind: "path", path: name };
  let value: RustExpr = collection;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]!;
    value = {
      kind: "evaluate-then", discard: "unit", value,
      effect: {
        kind: "method-call", receiver: collection,
        method: segment.sequence ? rustVecRestAssembly.appendSequenceMethod : rustVecRestAssembly.appendElementMethod,
        args: [segment.value],
      },
    };
  }
  return rustValueBlock([{ name, mutable: true, value: { kind: "vec-literal", elements: [] } }], value);
}
