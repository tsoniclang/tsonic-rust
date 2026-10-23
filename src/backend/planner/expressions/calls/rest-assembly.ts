import { requireRustReadOwnership } from "../typed-locations.js";
import { rustValueBlock } from "../../../target-ast/syntax/value-block.js";
import { allocateRustSyntheticName } from "../../names/synthetic.js";
import { rustVecRestAssembly } from "../../../../target-model/operations/rest-assembly.js";
import type { RustExpr } from "../../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";
import type { Node } from "@tsonic/tsts";
import { createRustSharedReferenceArgument } from "../input-shaping.js";
import { planExpression } from "../entry.js";
import { rustTypeEmissionInContext } from "../../types/render.js";
import { failRustPlannerInvariant } from "../../diagnostics.js";

export function planRustBorrowedSingletonSlice(
  node: Node,
  context: RustPlanContext,
): RustExpr | undefined {
  const value = planExpression(node, context, "value", "shared-place");
  if (value === undefined) return undefined;
  return { kind: "call", path: "core::slice::from_ref", args: [
    createRustSharedReferenceArgument(context, { stage: "source", expression: value, node }),
  ] };
}

export function canBorrowRustSingletonSlice(
  node: Node, context: RustPlanContext, later: readonly Node[],
): boolean {
  if (context.input.program.records.readOwnership.get(node)?.readsStorage !== true || context.expressionOverrides?.has(node) === true) return false;
  if (!requireRustReadOwnership(node, context).stablePlace &&
    later.some(value => !requireRustReadOwnership(node, context).borrowedAcross.has(value))) return false;
  const declaration = context.input.program.records.sourceBinding.get(node)?.sourceDeclaration;
  const parameter = context.input.program.records.sourceParameterAbi.get(node) ??
    context.input.program.records.sourceParameterAbi.get(declaration);
  if (parameter?.mode === "ref" && rustTypeEmissionInContext(parameter.valueCarrier, context).string) return false;
  const captured = [...context.capturedBindings ?? []].reverse().find(value => value.declaration === declaration);
  const borrowed = captured?.borrowedCarrier;
  return borrowed === undefined || !rustTypeEmissionInContext(borrowed, context).sharedStringReference;
}

export function planRustRestAssembly(
  segments: readonly { readonly value: RustExpr; readonly sequence: boolean }[],
  context: RustPlanContext,
): RustExpr | undefined {
  if (segments.length === 1 && segments[0]?.sequence === true) return segments[0].value;
  if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted native rest assembly requires its hygienic name scope.", context.callableDeclaration ?? context.sourceFile);
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
