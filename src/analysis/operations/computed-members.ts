import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustTargetProgram } from "../program/model.js";

export function admitRustComputedMembers(program: Omit<RustTargetProgram, "reachability">,
  nodes: readonly Node[]): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const { ast } = program.source;
  for (const node of nodes) {
    const fact = program.records.computedMember.get(node);
    const element = ast.is.IsElementAccessExpression(node) ? ast.as.AsElementAccessExpression(node) : undefined;
    const parent = ast.parent(node);
    const call = parent === undefined ? undefined : program.records.targetOperation.get(parent);
    if (fact !== undefined && (element === undefined || fact.receiver !== element.Expression || fact.key !== element.ArgumentExpression) ||
      fact === undefined && element !== undefined && call?.kind === "source-call" && parent !== undefined &&
      ast.is.IsCallExpression(parent) && ast.as.AsCallExpression(parent)?.Expression === node) {
      issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
        evidence: Object.freeze(["target.capability=rust.backend.computed-member-evaluation"]),
        message: `Computed source member requires its exact sealed receiver and key evaluation. Node kind: ${ast.kindName(node)}.` });
    }
  }
  return Object.freeze(issues);
}
