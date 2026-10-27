import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustValueConversion } from "../../target-model/operations/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustValueConversionContract } from "../../policy/conversions/contracts.js";
import type { RustConversionEmissionProducer } from "../program/records/operations/conversion-emission.js";
import type { RustProgramErrorRoute } from "../../target-model/conversions/program-error.js";

export function admitRustConversionEmission(producer: RustConversionEmissionProducer, conversion: RustValueConversion,
  definitions: RustTypeDefinitions) {
  const previous = producer.records.conversionContract.get(conversion);
  if (previous !== undefined) return previous;
  const selected = rustValueConversionContract(conversion, definitions)
    ?? failTargetAnalysisInvariant("tsonic-rust", "An admitted native conversion requires its exact physical conversion contract.");
  producer.publish(conversion, selected);
  if (conversion.kind === "program-error") {
    const visit = (route: RustProgramErrorRoute): void => {
      if (route.kind === "closed-admission") admitRustConversionEmission(producer, route.admission, definitions);
      if (route.kind === "union") for (const arm of route.arms) visit(arm.route);
    };
    visit(conversion.route);
  }
  return selected;
}
