import type { Node } from "@tsonic/tsts";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustUnionAlternatives, selectRustUnionArmMapping, type RustUnionArmMapping } from "../../../target-model/types/union-relations.js";
import { closedMetadataEquals } from "../../../target-model/metadata/closed-data.js";
import { isRustCopyCarrier, rustCarrierSupportsClone } from "../../../target-model/types/index.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { requireRustCarrierRequirements } from "../types/generic-requirements.js";
import type { RustExpr, RustPattern } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";

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
  const sourceType = rustTypeFromCarrierInContext(source, context);
  const targetType = rustTypeFromCarrierInContext(target, context);
  if (sourceType?.kind !== "named" || targetType?.kind !== "named") return undefined;
  const names = context.syntheticNames ?? createRustSyntheticNameState(context.input.program.source.ast, node, []);
  const arms: Extract<RustExpr, { readonly kind: "match" }>["arms"][number][] = [];
  for (const mapping of mappings) {
    if (mapping.source.kind === "payload" && !owned &&
      !rustCarrierSupportsClone(mapping.carrier, definitions) &&
      !requireRustCarrierRequirements(mapping.carrier, ["clone"], node, context)) return undefined;
    const name = allocateRustSyntheticName(names, "union_value");
    const bound: RustExpr = { kind: "path", path: name };
    const value: RustExpr = mapping.source.kind === "constant" ? { kind: "bool-literal", value: mapping.source.value }
      : owned ? bound : isRustCopyCarrier(mapping.carrier) ? { kind: "dereference", pointer: bound }
        : { kind: "method-call", receiver: bound, method: "clone", args: [] };
    const selected: RustExpr = mapping.target.kind === "constant"
      ? { kind: "path", path: `${targetType.path}::${mapping.target.name}` }
      : { kind: "call", path: `${targetType.path}::${mapping.target.name}`, args: [value] };
    const pattern: RustPattern = mapping.source.kind === "constant"
      ? { kind: "path", path: `${sourceType.path}::${mapping.source.name}` }
      : { kind: "tuple-variant", path: `${sourceType.path}::${mapping.source.name}`, elements: [{ kind: "binding", name }] };
    arms.push({ pattern: sourceOptional ? { kind: "tuple-variant", path: "Some", elements: [pattern] } : pattern,
      expression: targetOptional ? { kind: "call", path: "Some", args: [selected] } : selected });
  }
  if (targetOptional) arms.push({ pattern: { kind: "path", path: "None" }, expression: { kind: "path", path: "None" } });
  if (coverage === "target" && mappings.length < (rustUnionAlternatives(source, definitions)?.length ?? 0) ||
    sourceOptional && !targetOptional) {
    arms.push({ pattern: { kind: "wildcard" }, expression: { kind: "unreachable", message: "Checked flow excluded this union variant" } });
  }
  return { kind: "match", expression: owned ? expression : { kind: "reference", expr: expression }, arms };
}
