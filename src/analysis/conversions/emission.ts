import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustValueConversion } from "../../target-model/operations/model.js";
import type { RustTypeDefinitions } from "../../target-model/types/source-union-definitions.js";
import { rustValueConversionContract } from "../../target-model/conversions/contracts.js";
import type { RustConversionEmissionProducer } from "../program/records/conversion-emission.js";

export function admitRustConversionEmission(producer: RustConversionEmissionProducer, conversion: RustValueConversion,
  definitions: RustTypeDefinitions) {
  const previous = producer.records.conversionContract.get(conversion);
  if (previous !== undefined) return previous;
  const selected = rustValueConversionContract(conversion, definitions)
    ?? failTargetAnalysisInvariant("tsonic-rust", "An admitted native conversion requires its exact physical conversion contract.");
  producer.publish(conversion, selected);
  return selected;
}
