import { allocateRustSyntheticName } from "../../names/synthetic.js";
import { rustVecRestAssembly } from "../../../../target-model/operations/rest-assembly.js";
import type { RustExpr } from "../../../target-ast/nodes.js";
import type { RustPlanContext } from "../../program/plan-context.js";

export function planRustRestAssembly(
  segments: readonly { readonly value: RustExpr; readonly sequence: boolean }[],
  context: RustPlanContext,
): RustExpr | undefined {
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
  return { kind: "block", bindings: [{ name, mutable: true, value: { kind: "vec-literal", elements: [] } }], value };
}
