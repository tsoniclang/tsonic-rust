import assert from "node:assert/strict";
import test from "node:test";
import { rustValueConversionContract } from "../../dist/target-model/conversions/contracts.js";
import { rustNativeRepresentationMatches } from "../../dist/target-model/conversions/native-representation.js";
import { rustAbsenceTargetType, rustUnitTargetType, rustJsPromiseTargetTypeWithLifetime,
  rustProgramErrorTargetType, rustJsErrorTargetType, rustSourcePrimitiveTargetType } from "../../dist/target-model/types/index.js";
import { rustFutureValueForSourceStorage, rustFutureValueMatchesCarrier,
  transportRustFutureValue } from "../../dist/analysis/facts/future-values.js";

test("native representation transport preserves native type, error and lifetime boundaries", () => {
  const lifetime = { kind: "parameter", identity: "owner::lifetime", name: "scope" };
  const otherLifetime = { kind: "parameter", identity: "other::lifetime", name: "other" };
  const integer = rustSourcePrimitiveTargetType("int64");
  const unsigned = rustSourcePrimitiveTargetType("uint64");
  const inferred = { kind: "placeholder" };
  const source = rustJsPromiseTargetTypeWithLifetime(rustAbsenceTargetType(), lifetime);
  const target = rustJsPromiseTargetTypeWithLifetime(rustUnitTargetType(), inferred);
  const conversion = { kind: "native-representation", source, target };
  assert.deepEqual(rustValueConversionContract(conversion), {
    category: "exact", lowering: "identity", sourceMode: "value", source, target, fallible: false,
  });
  for (const invalid of [
    rustJsPromiseTargetTypeWithLifetime(integer, inferred),
    rustJsPromiseTargetTypeWithLifetime(rustUnitTargetType(), otherLifetime),
    rustJsPromiseTargetTypeWithLifetime(rustUnitTargetType(), { kind: "static" }),
    rustJsPromiseTargetTypeWithLifetime(rustUnitTargetType(), inferred, rustJsErrorTargetType()),
    { ...target, id: "another::Promise" },
    { ...target, sourceAbsence: true },
    { ...target, genericArguments: target.genericArguments.slice(0, 2) },
  ]) assert.equal(rustValueConversionContract({ ...conversion, target: invalid }), undefined);
  assert.equal(rustNativeRepresentationMatches(target, source), false);
  assert.equal(rustNativeRepresentationMatches(rustJsPromiseTargetTypeWithLifetime(integer, lifetime),
    rustJsPromiseTargetTypeWithLifetime(unsigned, inferred)), false);
  assert.equal(rustNativeRepresentationMatches(rustJsPromiseTargetTypeWithLifetime(integer, inferred),
    rustJsPromiseTargetTypeWithLifetime(integer, { kind: "static" })), false);
  assert.equal(rustValueConversionContract({ ...conversion, target: { ...target, genericArguments: [] } }), undefined);
  assert.equal(rustValueConversionContract({ ...conversion, kind: "object-identity-erasure" }), undefined);
});

test("future storage retains rejection and retargets only a proven erased native output", () => {
  const source = rustJsPromiseTargetTypeWithLifetime(rustAbsenceTargetType(), { kind: "static" });
  const target = rustJsPromiseTargetTypeWithLifetime(rustUnitTargetType(), { kind: "placeholder" });
  const fact = rustFutureValueForSourceStorage(source);
  assert.equal(fact.awaiting, "fallible");
  assert.equal(fact.errorBoundary, "source-program");
  const transported = transportRustFutureValue(fact, source, target);
  assert.ok(rustFutureValueMatchesCarrier(transported, target));
  assert.equal(transported.awaitedConversion.conversion.kind, "native-representation");
  assert.equal(transported.awaiting, fact.awaiting);
  assert.equal(transported.errorBoundary, fact.errorBoundary);
  assert.equal(transportRustFutureValue({ ...fact, outputCarrier: rustProgramErrorTargetType() }, source, target), undefined);
  assert.equal(transportRustFutureValue({ ...fact, errorBoundary: "none" }, source, target), undefined);
  assert.equal(transportRustFutureValue({ ...fact, awaitedConversion: {
    ...fact.awaitedConversion, sourceCarrier: rustProgramErrorTargetType(),
  } }, source, target), undefined);
  assert.equal(transportRustFutureValue(fact, source,
    rustJsPromiseTargetTypeWithLifetime(rustUnitTargetType(), { kind: "static" }, rustJsErrorTargetType())), undefined);
  assert.equal(rustFutureValueForSourceStorage(rustJsPromiseTargetTypeWithLifetime(
    rustUnitTargetType(), { kind: "static" }, rustJsErrorTargetType())), undefined);
});
