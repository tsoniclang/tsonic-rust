import type { Node } from "@tsonic/tsts";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustIntegerTruncationProducer } from "../program/records/operations/integer-truncation.js";
import { rustIntegerTruncationConversionMatches } from "../../policy/conversions/integer-truncation.js";

export function analyzeRustIntegerTruncation(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustIntegerTruncationProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const selected = program.records.contextualValueConversion.get(node);
    if (selected?.conversion.kind !== "integer-truncation") continue;
    const operation = program.records.targetOperation.get(node);
    if (!rustIntegerTruncationConversionMatches(selected.sourceCarrier, selected.targetCarrier, selected.conversion) ||
      operation?.kind !== "provider-operation" || operation.abi.target.form !== "call" ||
      (operation.abi.target.chain?.length ?? 0) !== 0 || operation.abi.targetArguments.length !== 2) {
      issues.push({ code: "RUST_MISSING_TARGET_FACT", source: "tsonic-rust", category: "error", sourceNode: node,
        message: `Native integer truncation requires its exact classified call and range proof. Node kind: ${program.source.ast.kindName(node)}.`,
        evidence: ["target.capability=rust.backend.integer-truncation"] });
      continue;
    }
    producer.publish(node, { target: selected.targetCarrier,
      path: selected.conversion.signed ? "js_abi::bigint_as_int_native" : "js_abi::bigint_as_uint_native" });
  }
  return Object.freeze(issues);
}
