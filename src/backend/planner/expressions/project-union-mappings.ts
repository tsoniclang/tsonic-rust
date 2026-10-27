import type { Node } from "@tsonic/tsts";
import type { RustProjectUnionMapConversion } from "../../../target-model/conversions/project-union.js";
import type { RustFlowReadProjectionFact, RustProjectUpcastFact } from "../../../target-model/records/objects/value-projections.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planRustUnionMapping } from "./union-mappings.js";

export function planRustProjectUnionMapping(node: Node, expression: RustExpr, conversion: RustProjectUnionMapConversion,
  _source: TargetTypeRef, _target: TargetTypeRef, context: RustPlanContext, owned: boolean,
  project: (expression: RustExpr, fact: RustProjectUpcastFact, owned: boolean) => RustExpr | undefined,
  upstream?: Extract<RustFlowReadProjectionFact, { readonly kind: "union-map" }>): RustExpr {
  const selected = context.input.program.records.projectUnionMapping.get(conversion, upstream)
    ?? failRustPlannerInvariant("An admitted project union conversion requires its sealed native arm composition.", node);
  return planRustUnionMapping(node, expression, selected.mapping, owned, context,
    selected.upcasts.map(upcast => upcast === null ? null : (value, owned) => project(value, upcast, owned)));
}
