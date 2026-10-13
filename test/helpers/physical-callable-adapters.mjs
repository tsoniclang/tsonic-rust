import { createRustRecordFixture } from "./records.mjs";
import assert from "node:assert/strict";
import { nativeClosureProducerFixture, nativeClosureProducerErrorRecords } from "./native-closure-producers.mjs";


import { createRustErrorRegionCatalog } from "../../dist/backend/planner/program/error-regions.js";
import { rustNamedTargetType } from "../../dist/target-model/types/carriers/native.js";
import { rustCallableTargetType } from "../../dist/target-model/types/carriers/callables.js";
import { selectRustCallableConversion } from "../../dist/target-model/conversions/callable.js";
import { selectRustExactIntegerConversion } from "../../dist/target-model/conversions/exact-integer.js";
import { planRustCallableConversion } from "../../dist/backend/planner/expressions/callable-conversions.js";

export function nativeFallibleAdapterFixture() {
  const failure = rustNamedTargetType("fixture:ProducerFailure", "ProducerFailure");
  const current = nativeClosureProducerFixture({
    source: `import type { int32, int64 } from "@tsonic/core/types.js";
export function create(): (value: int32) => int64 {
  return (value: int32): int64 => { return 3n; };
}`,
    selectRecords: nativeClosureProducerErrorRecords(failure),
    body: context => ({ kind: "try", expr: { kind: "call", path: "original", args: [{ kind: "path", path: "value" }] },
      operandErrorType: context.fallibleBoundary.errorType, resultErrorType: context.fallibleBoundary.errorType }),
  });
  const source = current.program.records.targetOperation.get(current.node).resultCarrier;
  const target = rustCallableTargetType([{ kind: "source-primitive", name: "int64" }], { kind: "source-primitive", name: "int32" });
  const conversion = selectRustCallableConversion(source, target, selectRustExactIntegerConversion, current.program.typeDefinitions);
  assert.equal(conversion !== undefined, true, "checked integer adaptation selected");
  const records = current.program.records;
  const program = { ...current.program, records: createRustRecordFixture({...records,
contextualValueConversion: { get: (node) => node === current.node ? { conversion } : records.contextualValueConversion.get(node) }}) };
  current.context.input = { program, errorRegions: createRustErrorRegionCatalog(program) };
  const expression = current.plan();
  assert.equal(expression !== undefined, true, "physical fallible producer plans");
  return { ...current, program, source, target, conversion, expression,
    adapt: () => planRustCallableConversion(conversion, expression, current.node, current.context) };
}
