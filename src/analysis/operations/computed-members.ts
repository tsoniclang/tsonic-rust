import { type Node, type AstReader } from "@tsonic/tsts";
import { type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { type RustAnalysisProgram } from "../program/model.js";
import { type ResolvedSourceCallInfo } from "@tsonic/target-api/source";
import { type RustProgramRecordWriter } from "../program/records/model.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/objects/required-records.js";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";

export function admitRustComputedMembers(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[]): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const { ast } = program.source;
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
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

export function recordRustComputedCallEvaluation(
  ast: AstReader, records: RustProgramRecordWriter, requiredRecords: RustRequiredRecord[], source: ResolvedSourceCallInfo | undefined,
  callee: Node, evaluateReceiver: boolean,
): Node | undefined {
  records.assertOpen();
  const access = source?.sourceCalleeAccess;
  if (access?.kind !== "element" || access.expression !== callee) return undefined;
  requireRustRecord(requiredRecords, "computedMember", access.expression, "computed call", "recordRustComputedCallEvaluation");
  const evaluation = records.computedMembers.evaluate(ast, access.expression,
    access.receiver.expression, access.argument.expression, "read", evaluateReceiver);
  return evaluation.key;
}
