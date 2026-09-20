import type { Node, SourceFile } from "@tsonic/tsts";
import { analyzeSourceIntegerRanges } from "@tsonic/target-api/source";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustEffectiveValueCarrier } from "../facts/value-carrier-queries.js";
import { rustTargetOperationFactKey } from "../facts/keys.js";

export interface RustNumericRepresentations {
  usesInt32Remainder(expression: Node): boolean;
}

export function analyzeRustNumericRepresentations(input: {
  readonly source: TargetSourceProgram;
  readonly sourceFiles: readonly SourceFile[];
  readonly facts: RustPlanQueries;
}): RustNumericRepresentations {
  const ranges = analyzeSourceIntegerRanges({
    ast: input.source.ast,
    navigation: input.source.navigation,
    sourceFiles: input.sourceFiles,
    isNumber: expression => isFloat64(rustEffectiveValueCarrier(input.facts, expression)),
  });
  const selected = new WeakSet(ranges.exactInt32Remainders.filter(expression => {
    const operation = input.facts.getFact(expression, rustTargetOperationFactKey);
    return operation?.kind === "operator-token" && operation.operator === "%" &&
      operation.leftConversion === undefined && operation.rightConversion === undefined && isFloat64(operation.resultCarrier);
  }));
  return Object.freeze({ usesInt32Remainder: (expression: Node) => selected.has(expression) });
}

function isFloat64(type: TargetTypeRef | undefined): boolean {
  return type?.kind === "source-primitive" && type.name === "float64";
}
