import type { Node } from "@tsonic/tsts";
import type { RustStmt } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { planBlockLike } from "./planning.js";
import { planDoStatement, planWhileStatement } from "./statement-conditionals.js";
import { planForStatement } from "./statement-for.js";
import { planForInStatement, planForOfStatement } from "./statement-loops.js";
import { createRustBreakTarget, withRustControlTarget } from "./loop-regions.js";

export function planLabeledStatement(node: Node, context: RustPlanContext): readonly RustStmt[] | undefined {
  const selected = context.input.program.records.labeledStatement.get(node);
  if (selected === undefined) failRustPlannerInvariant("An admitted label lost its exact source control target.", node);
  switch (context.input.program.source.ast.kindName(selected.body)) {
    case "KindWhileStatement": return planWhileStatement(selected.body, context);
    case "KindDoStatement": return planDoStatement(selected.body, context);
    case "KindForStatement": return planForStatement(selected.body, context);
    case "KindForInStatement": return planForInStatement(selected.body, context);
    case "KindForOfStatement": return planForOfStatement(selected.body, context);
    default: {
      const target = createRustBreakTarget(context, node, "label");
      const body = planBlockLike(selected.body, withRustControlTarget(context, target));
      return body === undefined ? undefined
        : [{ kind: "scope", ...(target.used.value ? { label: target.label } : {}), body }];
    }
  }
}
