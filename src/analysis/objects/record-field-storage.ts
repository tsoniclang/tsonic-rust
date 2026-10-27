import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustCallableConversionProducer } from "../program/records/callables/callable-conversions.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustGenericCallableValue } from "../../target-model/types/carriers/generic-callables.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import { Node_Initializer } from "@tsonic/target-api/source";

// A record interface field typed as a generic callable stores one physical family: the family selected for the value
// every record literal writes into that member, which must be the same for all of them. The logical generic callable
// carrier has no storage type of its own.
export function analyzeRustRecordFieldStorage(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustCallableConversionProducer): readonly TargetDiagnostic[] {
  const { ast } = program.source;
  const issues: TargetDiagnostic[] = [];
  const selected = new Map<Node, TargetTypeRef>();
  const reject = (node: Node, message: string): void => {
    issues.push({ code: "RUST_MISSING_TARGET_FACT", source: "tsonic-rust", category: "error", sourceNode: node,
      message, evidence: ["target.capability=rust.record-field.generic-callable-storage"] });
  };
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind !== "record-literal" || operation.storage !== "project-object") continue;
    for (const field of operation.fields) {
      const logical = rustGenericCallableValue(field.carrier);
      if (logical === undefined || logical.physical !== undefined) continue;
      const contribution = operation.contributions.find(entry => entry.kind === "property" && entry.targetStorageIndex === field.storageIndex);
      if (contribution?.kind !== "property") {
        reject(node, "A record generic callable field requires its exact written property.");
        continue;
      }
      const value = ast.is.IsShorthandPropertyAssignment(contribution.property) ? ast.name(contribution.property)
        : Node_Initializer(ast, contribution.property);
      const storage = value === undefined ? undefined : program.callableValues.nativeStorage.valueFor(value);
      if (storage === undefined || storage.kind === "unresolved") {
        reject(contribution.property, storage?.reason ?? "A record generic callable field requires its exact written value.");
        continue;
      }
      for (const member of field.contractDeclarations) {
        const previous = selected.get(member);
        if (previous !== undefined && !rustTargetTypeRefEquals(previous, storage.carrier)) {
          reject(contribution.property, "A record generic callable field is written with distinct physical families.");
          continue;
        }
        selected.set(member, storage.carrier);
      }
    }
  }
  if (issues.length === 0) for (const [member, carrier] of selected) producer.recordField(member, carrier);
  return Object.freeze(issues);
}
