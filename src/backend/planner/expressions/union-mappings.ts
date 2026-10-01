import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustUnionLeaves, rustUnionArmMappingsMatch, rustUnionProjectionContract, type RustUnionArmMapping } from "../../../target-model/types/union-relations.js";
import { isRustCopyCarrier, rustCarrierSupportsClone } from "../../../target-model/types/index.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { requireRustCarrierRequirements } from "../types/generic-requirements.js";
import type { RustExpr, RustPattern } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { planRustUnionPattern, planRustUnionConstruction } from "./union-patterns.js";

export function planRustUnionProjection(
  node: Node,
  expression: RustExpr,
  source: TargetTypeRef,
  target: TargetTypeRef,
  access: "move" | "clone" | "shared-reference",
  context: RustPlanContext,
): Extract<RustExpr, { readonly kind: "match" }> | undefined {
  const selected = rustUnionProjectionContract(source, target, context.input.program.typeDefinitions);
  if (selected === undefined) return undefined;
  const type = rustTypeFromCarrierInContext(selected.dispatchCarrier, context);
  if (access === "shared-reference" && selected.targetOptional) return undefined;
  if (type?.kind !== "named" || selected.variant.kind === "payload" && access === "clone" &&
    !rustCarrierSupportsClone(selected.carrier, context.input.program.typeDefinitions) &&
    !requireRustCarrierRequirements(selected.carrier, ["clone"], node, context)) return undefined;
  const name = allocateRustSyntheticName(context.syntheticNames ??
    createRustSyntheticNameState(context.input.program.source.ast, node, []), "flow_value");
  const payloadPattern = planRustUnionPattern(selected.path,
    { kind: "binding", name }, context);
  if (payloadPattern === undefined) return undefined;
  const pattern: RustPattern = selected.sourceOptional
    ? { kind: "tuple-variant", path: "Some", elements: [payloadPattern] } : payloadPattern;
  const constant: RustExpr | undefined = selected.variant.kind === "constant"
    ? { kind: "bool-literal", value: selected.variant.value } : undefined;
  const payload: RustExpr = constant !== undefined ? access === "shared-reference" ? { kind: "reference", expr: constant } : constant
    : access !== "clone" ? { kind: "path", path: name }
      : isRustCopyCarrier(selected.carrier) ? { kind: "dereference", pointer: { kind: "path", path: name } }
        : { kind: "method-call", receiver: { kind: "path", path: name }, method: "clone", args: [] };
  return { kind: "match", expression: access === "move" ? expression : { kind: "reference", expr: expression }, arms: [
    { pattern, expression: selected.targetOptional ? { kind: "call", path: "Some", args: [payload] } : payload },
    ...(selected.targetOptional ? [{ pattern: { kind: "path" as const, path: "None" },
      expression: { kind: "path" as const, path: "None" } }] : []),
    ...(selected.exhaustive ? [] : [{ pattern: { kind: "wildcard" as const }, expression: {
      kind: "unreachable" as const, message: "The selected native union variant is absent",
    } }]),
  ] };
}

export function planRustUnionMapping(
  node: Node,
  expression: RustExpr,
  source: TargetTypeRef,
  target: TargetTypeRef,
  mappings: readonly RustUnionArmMapping[],
  coverage: "source" | "target",
  owned: boolean,
  sourceOptional: boolean,
  targetOptional: boolean,
  context: RustPlanContext,
): RustExpr | undefined {
  const definitions = context.input.program.typeDefinitions;
  if (!rustUnionArmMappingsMatch(source, target, coverage, definitions, mappings) || targetOptional && !sourceOptional) return undefined;
  const names = context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []);
  const arms: Extract<RustExpr, { readonly kind: "match" }>["arms"][number][] = [];
  for (const mapping of mappings) {
    const sourceVariant = mapping.source[mapping.source.length - 1]!.variant;
    if (sourceVariant.kind === "payload" && !owned &&
      !rustCarrierSupportsClone(mapping.carrier, definitions) &&
      !requireRustCarrierRequirements(mapping.carrier, ["clone"], node, context)) return undefined;
    const name = allocateRustSyntheticName(names, "union_value");
    const bound: RustExpr = { kind: "path", path: name };
    const value: RustExpr = sourceVariant.kind === "constant" ? { kind: "bool-literal", value: sourceVariant.value }
      : owned ? bound : isRustCopyCarrier(mapping.carrier) ? { kind: "dereference", pointer: bound }
        : { kind: "method-call", receiver: bound, method: "clone", args: [] };
    const constructed = planRustUnionConstruction(mapping.target, value, context);
    if (constructed === undefined) return undefined;
    const pattern = planRustUnionPattern(mapping.source, { kind: "binding", name }, context);
    if (pattern === undefined) return undefined;
    arms.push({ pattern: sourceOptional ? { kind: "tuple-variant", path: "Some", elements: [pattern] } : pattern,
      expression: targetOptional ? { kind: "call", path: "Some", args: [constructed] } : constructed });
  }
  if (targetOptional) arms.push({ pattern: { kind: "path", path: "None" }, expression: { kind: "path", path: "None" } });
  if (coverage === "target" && mappings.length < (rustUnionLeaves(source, definitions)?.length ?? 0) ||
    sourceOptional && !targetOptional) {
    arms.push({ pattern: { kind: "wildcard" }, expression: { kind: "unreachable", message: "Checked flow excluded this union variant" } });
  }
  return { kind: "match", expression: owned ? expression : { kind: "reference", expr: expression }, arms };
}
