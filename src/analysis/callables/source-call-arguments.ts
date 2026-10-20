import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustTargetProgram } from "../program/model.js";
import type { RustSourceCallArgumentProducer } from "../program/records/source-call-arguments.js";
import { rustSliceElementCarrier } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustEffectiveValueCarrier } from "../conversions/value-carrier-queries.js";

export function analyzeRustSourceCallArguments(program: Omit<RustTargetProgram, "reachability">,
  nodes: readonly Node[], producer: RustSourceCallArgumentProducer): void {
  for (const call of nodes) {
    const fact = program.records.targetOperation.get(call);
    if (fact?.kind !== "source-call") continue;
    const arguments_ = program.source.ast.arguments(call);
    const exact = arguments_.filter((argument): argument is Node => argument !== undefined);
    if (exact.length !== arguments_.length) failTargetAnalysisInvariant("tsonic-rust", "An admitted source call requires its complete checked argument vector.", call);
    for (const [index, argument] of exact.entries()) {
      const selected = fact.parameters.filter(parameter => parameter.inputs.some(input => input.sourceArgumentIndex === index));
      const parameter = selected.length === 1 ? selected[0] : undefined;
      const input = parameter?.inputs[0];
      const construction = program.records.targetOperation.get(argument);
      const element = program.source.ast.is.IsArrayLiteralExpression(argument) ? program.source.ast.elements(argument)[0] : undefined;
      const contribution = construction?.kind === "array-literal" ? construction.contributions[0] : undefined;
      const singleton = parameter?.mode === "ref" && parameter.inputs.length === 1 && input?.sourceForm === "value" && input.sourceArgumentIndex === index &&
        construction?.kind === "array-literal" && construction.lane === "native" && construction.contributions.length === 1 && contribution?.kind === "value" &&
        element !== undefined && rustTargetTypeRefEquals(rustSliceElementCarrier(parameter.parameterCarrier), construction.elementCarrier) &&
        rustTargetTypeRefEquals(contribution.carrier, construction.elementCarrier) && rustTargetTypeRefEquals(rustEffectiveValueCarrier(program.records, element), construction.elementCarrier);
      producer.publish(argument, singleton ? { kind: "singleton", element, later: Object.freeze(exact.slice(index + 1)) } : { kind: "value" });
    }
  }
}
