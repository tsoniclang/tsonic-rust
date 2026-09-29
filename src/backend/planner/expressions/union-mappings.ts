import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustUnionLeaves, selectRustUnionArmMapping, selectRustUnionProjection, type RustUnionArmMapping } from "../../../target-model/types/union-relations.js";
import { closedMetadataEquals } from "../../../target-model/metadata/closed-data.js";
import { isRustCopyCarrier, rustCarrierSupportsClone } from "../../../target-model/types/index.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { requireRustCarrierRequirements } from "../types/generic-requirements.js";
import type { RustExpr, RustPattern } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";

export function planRustUnionProjection(
  node: Node,
  expression: RustExpr,
  source: TargetTypeRef,
  target: TargetTypeRef,
  access: "move" | "clone" | "shared-reference",
  context: RustPlanContext,
): Extract<RustExpr, { readonly kind: "match" }> | undefined {
  const selected = selectRustUnionProjection(source, target, context.input.program.typeDefinitions);
  if (selected === undefined) return undefined;
  const type = rustTypeFromCarrierInContext(selected.dispatchCarrier, context);
  if (access === "shared-reference" && selected.targetOptional) return undefined;
  if (type?.kind !== "named" || selected.variant.kind === "payload" && access === "clone" &&
    !rustCarrierSupportsClone(selected.carrier, context.input.program.typeDefinitions) &&
    !requireRustCarrierRequirements(selected.carrier, ["clone"], node, context)) return undefined;
  const name = allocateRustSyntheticName(context.syntheticNames ??
    createRustSyntheticNameState(context.input.program.source.ast, node, []), "flow_value");
  const payloadPattern: RustPattern = selected.variant.kind === "constant"
    ? { kind: "path", path: `${type.path}::${selected.variant.name}` }
    : { kind: "tuple-variant", path: `${type.path}::${selected.variant.name}`, elements: [{ kind: "binding", name }] };
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
    { pattern: { kind: "wildcard" }, expression: { kind: "unreachable", message: "The selected native union variant is absent" } },
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
  const expected = selectRustUnionArmMapping(source, target, coverage, definitions);
  if (expected === undefined || !closedMetadataEquals(expected, mappings) || targetOptional && !sourceOptional) return undefined;
  const names = context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []);
  const arms: Extract<RustExpr, { readonly kind: "match" }>["arms"][number][] = [];
  for (const mapping of mappings) {
    const sourceVariant = mapping.source[mapping.source.length - 1]!.variant;
    if (sourceVariant.kind === "payload" && !owned &&
      !rustCarrierSupportsClone(mapping.carrier, definitions) &&
      !requireRustCarrierRequirements(mapping.carrier, ["clone"], node, context)) return undefined;
    const name = allocateRustSyntheticName(names, "union_value");
    const bound: RustExpr = { kind: "path", path: name };
    let value: RustExpr = sourceVariant.kind === "constant" ? { kind: "bool-literal", value: sourceVariant.value }
      : owned ? bound : isRustCopyCarrier(mapping.carrier) ? { kind: "dereference", pointer: bound }
        : { kind: "method-call", receiver: bound, method: "clone", args: [] };
    for (const step of [...mapping.target].reverse()) {
      const type = rustTypeFromCarrierInContext(step.union, context);
      if (type?.kind !== "named") return undefined;
      value = step.variant.kind === "constant" ? { kind: "path", path: `${type.path}::${step.variant.name}` }
        : { kind: "call", path: `${type.path}::${step.variant.name}`, args: [value] };
    }
    let pattern: RustPattern = { kind: "binding", name };
    for (const step of [...mapping.source].reverse()) {
      const type = rustTypeFromCarrierInContext(step.union, context);
      if (type?.kind !== "named") return undefined;
      pattern = step.variant.kind === "constant" ? { kind: "path", path: `${type.path}::${step.variant.name}` }
        : { kind: "tuple-variant", path: `${type.path}::${step.variant.name}`, elements: [pattern] };
    }
    arms.push({ pattern: sourceOptional ? { kind: "tuple-variant", path: "Some", elements: [pattern] } : pattern,
      expression: targetOptional ? { kind: "call", path: "Some", args: [value] } : value });
  }
  if (targetOptional) arms.push({ pattern: { kind: "path", path: "None" }, expression: { kind: "path", path: "None" } });
  if (coverage === "target" && mappings.length < (rustUnionLeaves(source, definitions)?.length ?? 0) ||
    sourceOptional && !targetOptional) {
    arms.push({ pattern: { kind: "wildcard" }, expression: { kind: "unreachable", message: "Checked flow excluded this union variant" } });
  }
  return { kind: "match", expression: owned ? expression : { kind: "reference", expr: expression }, arms };
}
