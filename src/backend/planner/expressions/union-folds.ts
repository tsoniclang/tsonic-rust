import type { Node } from "@tsonic/tsts";
import type { RustUnionLeaf } from "../../../target-model/types/union-relations.js";
import type { RustExpr, RustPattern } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { planRustUnionPattern } from "./union-patterns.js";

export function planRustUnionFold<Arm extends RustUnionLeaf>(
  source: RustExpr,
  selections: readonly Arm[],
  context: RustPlanContext,
  node: Node | undefined,
  convert: (arm: Arm, payload: RustExpr) => RustExpr | undefined,
): RustExpr | undefined {
  const names = context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node ?? context.sourceFile, []);
  const arms: { readonly pattern: RustPattern; readonly expression: RustExpr }[] = [];
  for (const arm of selections) {
    const variant = arm.path[arm.path.length - 1]!.variant;
    const name = allocateRustSyntheticName(names, "union_value");
    const payload: RustExpr = variant.kind === "constant" ? { kind: "bool-literal", value: variant.value } : { kind: "path", path: name };
    const pattern = planRustUnionPattern(arm.path, { kind: "binding", name }, context);
    const expression = convert(arm, payload);
    if (pattern === undefined || expression === undefined) return undefined;
    arms.push({ pattern, expression });
  }
  return { kind: "match", expression: source, arms };
}
