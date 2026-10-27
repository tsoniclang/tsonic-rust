import type { Node } from "@tsonic/tsts";
import type { RustUnionProjectionEmission, RustUnionMappingEmission } from "../../../target-model/records/types/union-mappings.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { rustCarrierHasCopyContract, rustCarrierHasCloneContract } from "../types/generic-requirements.js";
import type { RustExpr, RustPattern } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planRustUnionPattern, planRustUnionConstruction } from "./union-patterns.js";

export function planRustUnionProjection(node: Node, expression: RustExpr, selected: RustUnionProjectionEmission,
  access: "move" | "clone" | "shared-reference" | "mutable-reference", context: RustPlanContext): Extract<RustExpr, { readonly kind: "match" }> {
  const type = rustTypeFromCarrierInContext(selected.dispatchCarrier, context);
  const referenced = access === "shared-reference" || access === "mutable-reference";
  if (type?.kind !== "named" || referenced && selected.targetOptional ||
    access === "mutable-reference" && selected.variant.kind !== "payload" ||
    selected.variant.kind === "payload" && access === "clone" && !rustCarrierHasCloneContract(selected.carrier, context))
    failRustPlannerInvariant("An admitted native union projection requires its exact type, presence and read contract.", node);
  const name = allocateRustSyntheticName(context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []), "flow_value");
  const payloadPattern = planRustUnionPattern(selected.path, { kind: "binding", name }, context)
    ?? failRustPlannerInvariant("An admitted native union projection requires its payload pattern.", node);
  const pattern: RustPattern = selected.sourceOptional ? { kind: "tuple-variant", path: "Some", elements: [payloadPattern] } : payloadPattern;
  const constant: RustExpr | undefined = selected.variant.kind === "constant" ? { kind: "bool-literal", value: selected.variant.value } : undefined;
  const payload: RustExpr = constant !== undefined ? access === "shared-reference" ? { kind: "reference", expr: constant } : constant
    : access !== "clone" ? { kind: "path", path: name } : rustCarrierHasCopyContract(selected.carrier, context)
      ? { kind: "dereference", pointer: { kind: "path", path: name } }
      : { kind: "method-call", receiver: { kind: "path", path: name }, method: "clone", args: [] };
  return { kind: "match", expression: access === "move" ? expression : access === "mutable-reference"
    ? { kind: "reference", expr: expression, mutable: true } : { kind: "reference", expr: expression }, arms: [
    { pattern, expression: selected.targetOptional ? { kind: "call", path: "Some", args: [payload] } : payload },
    ...(selected.targetOptional ? [{ pattern: { kind: "path" as const, path: "None" }, expression: { kind: "path" as const, path: "None" } }] : []),
    ...(selected.exhaustive ? [] : [{ pattern: { kind: "wildcard" as const }, expression: {
      kind: "unreachable" as const, message: "The selected native union variant is absent" } }]),
  ] };
}

export function planRustUnionMapping(node: Node, expression: RustExpr, selected: RustUnionMappingEmission,
  owned: boolean, context: RustPlanContext,
  projections?: readonly (((value: RustExpr, owned: boolean) => RustExpr | undefined) | null)[]): RustExpr {
  if (projections !== undefined && projections.length !== selected.arms.length)
    failRustPlannerInvariant("An admitted union map requires one native payload projection per arm.", node);
  const names = context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []);
  const arms: Extract<RustExpr, { readonly kind: "match" }>["arms"][number][] = [];
  for (const [index, mapping] of selected.arms.entries()) {
    const sourceVariant = mapping.source[mapping.source.length - 1]?.variant
      ?? failRustPlannerInvariant("An admitted union map requires its exact native source arm.", node);
    const projection = projections === undefined ? null : projections[index];
    if (projection === undefined) failRustPlannerInvariant("An admitted union map requires its selected native payload projection.", node);
    if (projection === null && sourceVariant.kind === "payload" && !owned && !rustCarrierHasCloneContract(mapping.carrier, context))
      failRustPlannerInvariant("An admitted union map requires its native non-consuming payload contract.", node);
    const name = allocateRustSyntheticName(names, "union_value");
    const bound: RustExpr = { kind: "path", path: name };
    const value = projection !== null ? projection(bound, owned)
      : sourceVariant.kind === "constant" ? { kind: "bool-literal" as const, value: sourceVariant.value }
      : owned ? bound : rustCarrierHasCopyContract(mapping.carrier, context) ? { kind: "dereference" as const, pointer: bound }
      : { kind: "method-call" as const, receiver: bound, method: "clone", args: [] };
    if (value === undefined) failRustPlannerInvariant("An admitted union map requires its native payload value.", node);
    const constructed = planRustUnionConstruction(mapping.target, value, context)
      ?? failRustPlannerInvariant("An admitted union map requires its native target arm.", node);
    const pattern = planRustUnionPattern(mapping.source, { kind: "binding", name }, context)
      ?? failRustPlannerInvariant("An admitted union map requires its native source pattern.", node);
    arms.push({ pattern: selected.sourceOptional ? { kind: "tuple-variant", path: "Some", elements: [pattern] } : pattern,
      expression: selected.targetOptional ? { kind: "call", path: "Some", args: [constructed] } : constructed });
  }
  if (selected.targetOptional) arms.push({ pattern: { kind: "path", path: "None" }, expression: { kind: "path", path: "None" } });
  if (selected.excluded) arms.push({ pattern: { kind: "wildcard" }, expression: { kind: "unreachable", message: "Checked flow excluded this union variant" } });
  return { kind: "match", expression: owned ? expression : { kind: "reference", expr: expression }, arms };
}
