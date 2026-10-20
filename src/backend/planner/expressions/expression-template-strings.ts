import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../../invariants.js";
import { rustStringConcat, type RustStringConcatPart } from "../../target-ast/syntax/expressions.js";
import { planRustStringConcatOperand } from "./string-concat-parts.js";
import { planExpression } from "./entry.js";

export function planTemplateExpression(node: Node, context: RustPlanContext): RustExpr {
  const selected = context.input.program.records.templateString.get(node);
  if (selected === undefined) failRustPlannerInvariant("An admitted template requires its sealed native substitutions.", node);
  const parts: RustStringConcatPart[] = [{ kind: "literal", value: selected.head }];
  for (const part of selected.parts) {
    const value = planExpression(part.expression, context)
      ?? failRustPlannerInvariant("An admitted template substitution requires its native value.", part.expression);
    if (!part.string) context.usedAliases?.add("rt");
    parts.push(part.string ? planRustStringConcatOperand(part.expression, value, context)
      : { kind: "value", value: { kind: "call", path: "rt::source_string", args: [{ kind: "reference", expr: value }] } },
      { kind: "literal", value: part.literal });
  }
  return rustStringConcat(parts);
}
