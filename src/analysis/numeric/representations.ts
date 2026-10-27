import type { SourceFile } from "@tsonic/tsts";
import { analyzeSourceIntegerRanges } from "@tsonic/target-api/source";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustEffectiveValueCarrier } from "../conversions/value-carrier-queries.js";
import type { RustNumericRepresentations } from "../../target-model/records/operations/numeric.js";
import { createRustNumericRepresentationRecords } from "../program/records/operations/numeric.js";

export function analyzeRustNumericRepresentations(input: {
  readonly source: TargetSourceProgram;
  readonly sourceFiles: readonly SourceFile[];
  readonly records: RustProgramRecords;
}): RustNumericRepresentations {
  const ranges = analyzeSourceIntegerRanges({
    ast: input.source.ast,
    navigation: input.source.navigation,
    sourceFiles: input.sourceFiles,
    isNumber: expression => isFloat64(rustEffectiveValueCarrier(input.records, expression)),
  });
  const selected = ranges.exactInt32Remainders.filter(expression => {
    const operation = input.records.targetOperation.get(expression);
    return operation?.kind === "operator-token" && operation.operator === "%" &&
      operation.leftConversion === undefined && operation.rightConversion === undefined && isFloat64(operation.resultCarrier);
  });
  return createRustNumericRepresentationRecords(selected);
}

function isFloat64(type: TargetTypeRef | undefined): boolean {
  return type?.kind === "source-primitive" && type.name === "float64";
}
