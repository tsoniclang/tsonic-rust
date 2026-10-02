import assert from "node:assert/strict";
import test from "node:test";
import { rustAwaitCarrier, rustCallableTargetType, rustJsPromiseTargetType, rustSourceOptionalTargetType,
  rustSourcePrimitiveTargetType, rustUnitTargetType } from "../../dist/target-model/types/index.js";
import { rustFutureValueMatchesCarrier } from "../../dist/analysis/facts/future-values.js";
import { rustCompilerOwnedContextualConversionMatches } from "../../dist/target-model/conversions/contextual.js";
import { selectRustCallableConversion } from "../../dist/target-model/conversions/callable.js";

const integer = rustSourcePrimitiveTargetType("int32");
const boolean = rustSourcePrimitiveTargetType("bool");
const unit = rustUnitTargetType();

test("optional awaiting preserves one absence, unit completion and exact output", () => {
  for (const output of [integer, unit, rustSourceOptionalTargetType(integer)]) {
    const future = rustJsPromiseTargetType(output);
    assert.deepEqual(rustAwaitCarrier(future), {
      futureCarrier: future, outputCarrier: output, resultCarrier: output, optional: false,
    });
    assert.deepEqual(rustAwaitCarrier(rustSourceOptionalTargetType(future)), {
      futureCarrier: future, outputCarrier: output,
      resultCarrier: output === unit ? unit : rustSourceOptionalTargetType(output), optional: true,
    });
  }
  for (const invalid of [undefined, unit, integer, rustSourceOptionalTargetType(integer)]) {
    assert.equal(rustAwaitCarrier(invalid), undefined);
  }
});

test("optional futures retain exact independent effect and error-boundary checks", () => {
  const carrier = rustSourceOptionalTargetType(rustJsPromiseTargetType(integer));
  const fact = { outputCarrier: integer, awaiting: "fallible", errorBoundary: "source-program",
    awaitedConversion: { kind: "identity", sourceCarrier: integer, targetCarrier: integer, fallible: false } };
  assert.equal(rustFutureValueMatchesCarrier(fact, carrier), true);
  for (const changed of [
    { ...fact, outputCarrier: boolean }, { ...fact, errorBoundary: "none" },
    { ...fact, awaiting: "infallible" }, { ...fact, errorCarrier: integer },
    { ...fact, errorBoundary: "provider-native" },
    { ...fact, awaitedConversion: { ...fact.awaitedConversion, targetCarrier: boolean } },
  ]) assert.equal(rustFutureValueMatchesCarrier(changed, carrier), false);
});

test("callable absence completion never coerces values or incompatible parameters", () => {
  const source = rustCallableTargetType([integer], unit);
  const target = rustCallableTargetType([integer, boolean], rustSourceOptionalTargetType(integer));
  const conversion = selectRustCallableConversion(source, target, () => undefined);
  assert.ok(conversion);
  assert.equal(rustCompilerOwnedContextualConversionMatches(source, target, conversion), true);
  for (const invalid of [
    rustCallableTargetType([boolean], rustSourceOptionalTargetType(integer)),
    rustCallableTargetType([], rustSourceOptionalTargetType(integer)),
    rustCallableTargetType([integer], integer), integer,
  ]) assert.equal(selectRustCallableConversion(source, invalid, () => undefined), undefined);
  assert.equal(selectRustCallableConversion(rustCallableTargetType([integer], boolean), target, () => undefined), undefined);
  assert.equal(rustCompilerOwnedContextualConversionMatches(source, target, { ...conversion, source: target }), false);
  assert.equal(rustCompilerOwnedContextualConversionMatches(source, target, { ...conversion, target: source }), false);
});
