import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustLocationCallbackProducer } from "../program/records/location-callbacks.js";
import { rustCallableProtocol, rustClosureProtocol } from "../../target-model/types/index.js";
import { rustNativeCallableOperand } from "./native-conversions.js";

export function analyzeRustLocationCallbacks(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustLocationCallbackProducer,
  analysisRecords: Pick<import("../../target-model/records/analysis.js").RustAnalysisRecords, "typedLocationPlan">): void {
  for (const node of nodes) {
    const plan = analysisRecords.typedLocationPlan.get(node);
    if (plan?.operation !== "bind-pointer" && plan?.operation !== "view-pointer" && plan?.operation !== "project-pointer") continue;
    const selected = program.records.selectedCall.get(node);
    for (const index of [1, 2]) {
      const carrier = selected?.member.parameters[index]?.type;
      if (rustClosureProtocol(carrier)?.fallible === true) {
        producer.publish(node, index, { kind: "direct" });
        continue;
      }
      const callable = rustCallableProtocol(carrier);
      const argument = program.source.ast.arguments(node)[index];
      const source = argument === undefined || carrier === undefined ? undefined : rustNativeCallableOperand(carrier, argument, {
        records: program.records, storage: program.callableValues.nativeStorage, producers: program.callableValues.nativeProducers,
      });
      const boundary = program.retainedCallableInputs.forBoundary(node, index);
      if (callable === undefined || source === undefined || source.input !== undefined && boundary?.inputs.includes(source.input) !== true)
        failTargetAnalysisInvariant("tsonic-rust", "An admitted native location callback requires its exact callable protocol and retained input.", argument ?? node);
      producer.publish(node, index, { kind: "adapter", parameterCount: callable.parameters.length, input: source.input });
    }
  }
}
