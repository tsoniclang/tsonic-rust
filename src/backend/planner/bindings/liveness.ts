import type { Node } from "@tsonic/tsts";
import type { RustAttribute } from "../../target-ast/syntax/attributes.js";
import { rustLintAttributes } from "../../target-ast/normalization/lint-policy.js";
import type { RustPlanContext } from "../program/plan-context.js";

export function rustBindingLivenessAttributes(node: Node, mutable: boolean, context: RustPlanContext): readonly RustAttribute[] {
  const selected = context.input.program.records.bindingLiveness.get(node);
  return [...selected?.unused === true ? [rustLintAttributes.unusedVariables] : [],
    ...mutable && selected?.unusedInitializer === true ? [rustLintAttributes.unusedAssignments] : []];
}
