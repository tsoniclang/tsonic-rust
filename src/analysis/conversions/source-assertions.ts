import type { Node } from "@tsonic/tsts";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { Node_Expression, Node_Operand } from "@tsonic/target-api/source";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustSourceAssertionProducer } from "../program/records/operations/source-assertions.js";
import { rustValueConversionContract } from "../../policy/conversions/contracts.js";

export function analyzeRustSourceAssertions(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustSourceAssertionProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const { ast } = program.source;
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind !== "source-conversion") continue;
    const operand = ast.is.IsPrefixUnaryExpression(node) ? Node_Operand(ast, node) : Node_Expression(ast, node);
    const contract = operation.conversion === undefined ? undefined : rustValueConversionContract(operation.conversion, program.typeDefinitions);
    if (operand === undefined || operation.conversion !== undefined && contract === undefined) {
      issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
        message: `Source assertion conversion conflicts with its finalized runtime carrier or TSTS-selected operation fact. Node kind: ${ast.kindName(node)}.`,
        evidence: ["target.capability=rust.backend.conversion-selected-evidence"] });
      continue;
    }
    producer.publish(node, { operand, conversion: operation.conversion, borrowed: contract?.sourceMode === "ref" });
  }
  return Object.freeze(issues);
}
