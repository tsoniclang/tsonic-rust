import assert from "node:assert/strict";
import { nativeClosureProducerFixture, nativeClosureProducerFailurePackage } from "./native-closure-producers.mjs";
import { rustNamedTargetType } from "../../dist/target-model/types/carriers/native.js";
import { planRustCallableConversion } from "../../dist/backend/planner/expressions/callable-conversions.js";

export function nativeFallibleAdapterFixture() {
  const failure = rustNamedTargetType("fixture:ProducerFailure", "ProducerFailure");
  const current = nativeClosureProducerFixture({
    packages: [nativeClosureProducerFailurePackage(failure, { path: "original", result: "int64",
      parameters: [{ name: "value", type: "int32" }] })],
    source: `import { fail as original } from "test:producer";
import type { int32, int64 } from "@tsonic/core/types.js";
export function create(): (value: int64) => int32 {
  return (value: int32): int64 => { return original(value); };
}`,
    body: context => ({ kind: "try", expr: { kind: "call", path: "original", args: [{ kind: "path", path: "value" }] },
      operandErrorType: context.fallibleBoundary.errorType, resultErrorType: context.fallibleBoundary.errorType }),
  });
  const selected = current.program.records.contextualValueConversion.get(current.node);
  assert.equal(selected?.conversion.kind, "callable-adapter", "checked integer adaptation selected");
  const conversion = selected.conversion;
  const { source, target } = conversion;
  const expression = current.plan();
  assert.equal(expression !== undefined, true, "physical fallible producer plans");
  return { ...current, source, target, conversion, expression,
    adapt: () => planRustCallableConversion(conversion, expression, current.node, current.context) };
}
