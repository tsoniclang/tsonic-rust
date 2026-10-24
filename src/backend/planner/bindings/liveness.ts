import type { Node } from "@tsonic/tsts";
import type { RustAttribute } from "../../target-ast/syntax/attributes.js";
import { rustLintAttributes } from "../../target-ast/normalization/lint-policy.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";

export function rustBindingLivenessAttributes(node: Node, mutable: boolean, context: RustPlanContext): readonly RustAttribute[] {
  const selected = context.input.program.records.bindingLiveness.get(node);
  return [...selected?.unused === true ? [rustLintAttributes.unusedVariables] : [],
    ...mutable && selected?.unusedInitializer === true ? [rustLintAttributes.unusedAssignments] : []];
}

export function rustWriteLivenessAttributes(node: Node, context: RustPlanContext): readonly RustAttribute[] {
  const selected = context.input.program.records.unobservedWrite.get(node);
  if (selected === undefined) return [];
  let unobserved: boolean;
  if (selected.kind === "lexical") unobserved = selected.unobserved;
  else {
    const layer = context.construction?.layer;
    const disposition = layer === undefined ? undefined : selected.layers.get(layer);
    if (disposition === undefined) failRustPlannerInvariant(
      "A construction write requires its identical admitted native layer liveness disposition.", node);
    unobserved = disposition;
  }
  return unobserved ? [rustLintAttributes.unusedAssignmentsInner] : [];
}
