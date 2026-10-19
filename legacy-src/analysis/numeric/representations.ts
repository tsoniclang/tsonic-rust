import type { Node, SourceFile } from "@tsonic/tsts";
import { analyzeSourceIntegerRanges } from "@tsonic/target-api/source";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustEffectiveValueCarrier } from "../conversions/value-carrier-queries.js";

export interface RustNumericRepresentations {
  usesInt32Remainder(expression: Node): boolean;
}

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
  const selected = new WeakSet(ranges.exactInt32Remainders.filter(expression => {
    const operation = input.records.targetOperation.get(expression);
    return operation?.kind === "operator-token" && operation.operator === "%" &&
      operation.leftConversion === undefined && operation.rightConversion === undefined && isFloat64(operation.resultCarrier);
  }));
  return Object.freeze({ usesInt32Remainder: (expression: Node) => selected.has(expression) });
}

function isFloat64(type: TargetTypeRef | undefined): boolean {
  return type?.kind === "source-primitive" && type.name === "float64";
}
