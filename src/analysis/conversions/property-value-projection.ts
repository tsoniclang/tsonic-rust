import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustPropertyValueProjectionProducer } from "../program/records/objects/property-value-projection.js";
import { rustValueConversionContract } from "../../policy/conversions/contracts.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustOptionElementCarrier } from "../../target-model/types/carriers/optional.js";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";

export function analyzeRustPropertyValueProjection(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustPropertyValueProjectionProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const refuse = (node: Node, capability: string, message: string): void => {
    issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `${message} Node kind: ${program.source.ast.kindName(node)}.`, evidence: [`target.capability=${capability}`] });
  };
  for (const node of nodes) if (!rustProgramNodeIsOutsideNativeCode(program, node)) for (const projection of program.records.propertyProjection.get(node)?.cases ?? []) {
    if (producer.records.propertyValueProjection.get(node, projection.source) !== undefined) {
      refuse(node, "rust.backend.property-projection", "Native property projection requires its exact sealed selected-parameter member reads.");
      continue;
    }
    const contract = rustValueConversionContract(projection.conversion, program.typeDefinitions);
    if (contract?.lowering !== "js-value-from-properties" || projection.reads.length !== contract.fields.length) {
      refuse(node, "rust.backend.property-projection", "Native property projection requires its exact sealed selected-parameter member reads.");
      continue;
    }
    let valid = true;
    for (const [index, field] of contract.fields.entries()) {
      const read = projection.reads[index]!;
      const carrier = field.presence === "optional" ? rustOptionElementCarrier(read.resultCarrier) : read.resultCarrier;
      if (carrier === undefined || !rustTargetTypeRefEquals(carrier, field.sourceCarrier) ||
        read.kind === "source-field" && !rustTargetTypeRefEquals(read.receiverCarrier, contract.source) ||
        read.kind === "source-accessor" && (read.receiver.kind !== "instance" || read.read === undefined ||
          !rustTargetTypeRefEquals(read.read.resultCarrier, read.resultCarrier))) {
        valid = false;
        refuse(node, "rust.backend.property-projection-member", "Selected native property read conflicts with its exact projection carrier.");
      }
    }
    if (valid) producer.publish(node, projection.source, { projection, contract });
  }
  return Object.freeze(issues);
}
