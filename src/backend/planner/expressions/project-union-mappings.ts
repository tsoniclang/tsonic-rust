import type { Node } from "@tsonic/tsts";
import type { RustProjectUnionMapConversion } from "../../../target-model/conversions/project-union.js";
import { rustProjectUnionMapConversionMatches } from "../../../target-model/conversions/project-union.js";
import { rustProjectUnionUpcastRelation } from "../../../target-model/conversions/project-union-relations.js";
import type { RustFlowReadProjectionFact, RustProjectUpcastFact } from "../../../target-model/types/value-projections.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustOptionElementCarrier } from "../../../target-model/types/carriers/optional.js";
import { rustFlowReadProjectionMatches } from "../../../analysis/facts/flow-read-projections.js";
import { isClosedMetadata } from "../../../target-model/metadata/closed-data.js";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planRustUnionMapping } from "./union-mappings.js";

export function planRustProjectUnionMapping(
  node: Node,
  expression: RustExpr,
  conversion: RustProjectUnionMapConversion,
  source: TargetTypeRef,
  target: TargetTypeRef,
  context: RustPlanContext,
  owned: boolean,
  project: (expression: RustExpr, fact: RustProjectUpcastFact, owned: boolean) => RustExpr | undefined,
  upstream?: Extract<RustFlowReadProjectionFact, { readonly kind: "union-map" }>,
): RustExpr | undefined {
  const relation = rustProjectUnionUpcastRelation(context.input.program.projectTypes);
  if (!rustProjectUnionMapConversionMatches(conversion, source, target,
    context.input.program.typeDefinitions, relation)) return undefined;
  if (upstream !== undefined && (!isClosedMetadata(upstream) || !rustTargetTypeRefEquals(upstream.selectedCarrier, source) ||
    !rustTargetTypeRefEquals(rustOptionElementCarrier(upstream.sourceCarrier) ?? upstream.sourceCarrier,
      upstream.dispatchCarrier) || !rustFlowReadProjectionMatches(upstream, context.input.program.projectTypes,
      context.input.program.typeDefinitions))) return undefined;
  const mappings = conversion.arms.map(({ upcast, ...correspondence }) => correspondence);
  return planRustUnionMapping(node, expression, upstream?.dispatchCarrier ?? source, target, mappings,
    upstream === undefined ? "source" : "target", owned,
    upstream !== undefined && rustOptionElementCarrier(upstream.sourceCarrier) !== undefined, false, context, {
      relates: (source, target) => relation(source, target) === "related",
      projections: conversion.arms.map(arm => {
        const upcast = arm.upcast;
        return upcast === null ? null : (value, owned) => project(value, upcast, owned);
      }),
      ...(upstream === undefined ? {} : { upstream: { carrier: source, arms: upstream.arms } }),
    });
}
