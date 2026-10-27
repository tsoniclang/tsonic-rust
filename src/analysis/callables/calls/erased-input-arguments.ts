import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../../program/model.js";
import type { RustErasedInputArgumentProducer } from "../../program/records/erased-input-arguments.js";
import { rustCallableProtocol } from "../../../target-model/types/index.js";
import { rustOptionElementCarrier } from "../../../target-model/types/carriers/optional.js";

// A native input passed to a native input invocation whose parameter is a type-erased runtime callable is erased into
// that callable; the retained-input boundary already bound its invocation error into the parameter's error.
export function analyzeRustErasedInputArguments(program: Omit<RustAnalysisProgram, "reachability">,
  producer: RustErasedInputArgumentProducer): void {
  for (const call of program.callableValues.native.calls) {
    const parameters = rustCallableProtocol(rustOptionElementCarrier(call.input.carrier) ?? call.input.carrier)?.parameters ?? [];
    for (const [index, argument] of program.source.ast.arguments(call.node).entries()) {
      const boundary = program.retainedCallableInputs.forBoundary(call.node, index);
      if (boundary === undefined) continue;
      const carrier = parameters[index];
      const callable = carrier === undefined ? undefined : rustCallableProtocol(carrier);
      const input = boundary.inputs.length === 1 ? boundary.inputs[0] : undefined;
      if (argument === undefined || carrier === undefined || callable === undefined || input === undefined)
        failTargetAnalysisInvariant("tsonic-rust", "An erased native input argument requires its exact callable parameter and input.", argument ?? call.node);
      producer.publish(call.node, index, { input, carrier, parameterCount: callable.parameters.length });
    }
  }
}
