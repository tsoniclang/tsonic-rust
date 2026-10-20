import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { registerAliasFromPath } from "../program/plan-context.js";
import { rustPropagateLocalError } from "../program/fallible-boundaries.js";
import { failRustPlannerInvariant } from "../../invariants.js";

export function planRegExpCreate(node: Node, context: RustPlanContext): RustExpr {
  const fact = context.input.program.records.targetOperation.get(node);
  if (fact?.kind !== "regexp-create") failRustPlannerInvariant("An admitted RegExp requires its constant-pattern operation.", node);
  const region = context.fallibleBoundary;
  if (region === undefined) failRustPlannerInvariant("An admitted RegExp construction requires its native error boundary.", node);
  registerAliasFromPath(context, "js_abi::regexp_new_native");
  return rustPropagateLocalError(region, { kind: "named", path: "js_abi::JsError" }, {
    kind: "call", path: "js_abi::regexp_new_native", args: [
      { kind: "str-literal", value: fact.pattern }, { kind: "str-literal", value: fact.flags },
    ],
  });
}
