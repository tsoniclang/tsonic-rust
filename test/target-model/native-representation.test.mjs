import assert from "node:assert/strict";
import test from "node:test";
import { rustValueConversionContract } from "../../dist/policy/conversions/contracts.js";
import { rustNativeRepresentationMatches } from "../../dist/policy/conversions/native-representation.js";
import { rustAbsenceTargetType, rustUnitTargetType, rustJsPromiseTargetType, rustCallableTargetType,
  rustProgramErrorTargetType, rustJsErrorTargetType, rustSourcePrimitiveTargetType } from "../../dist/target-model/types/index.js";
import { rustFutureValueForSourceStorage, rustFutureValueMatchesCarrier, transportRustFutureValue } from "../../dist/analysis/callables/async/future-values.js";
import { rustSourceUnionTargetType } from "../../dist/target-model/types/carriers/source-types.js";

test("native representation transport preserves native type, arity and lifetime boundaries", () => {
  const lifetime = { kind: "parameter", identity: "owner::lifetime", name: "scope" };
  const otherLifetime = { kind: "parameter", identity: "other::lifetime", name: "other" };
  const integer = rustSourcePrimitiveTargetType("int64");
  const unsigned = rustSourcePrimitiveTargetType("uint64");
  const inferred = { kind: "placeholder" };
  const source = rustJsPromiseTargetType(rustAbsenceTargetType());
  const target = rustJsPromiseTargetType(rustUnitTargetType());
  const conversion = { kind: "native-representation", source, target };
  assert.deepEqual(rustValueConversionContract(conversion), {
    category: "exact", lowering: "identity", sourceMode: "value", source, target, fallible: false,
  });
  for (const invalid of [
    rustJsPromiseTargetType(integer),
    { ...target, genericArguments: [...target.genericArguments, { kind: "type", type: rustJsErrorTargetType() }] },
    { ...target, genericArguments: [{ kind: "lifetime", lifetime: { kind: "static" } }, ...target.genericArguments] },
    { ...target, id: "another::Promise" },
    { ...target, sourceAbsence: true },
  ]) assert.equal(rustValueConversionContract({ ...conversion, target: invalid }), undefined);
  assert.equal(rustNativeRepresentationMatches(target, source), false);
  assert.equal(rustNativeRepresentationMatches(rustJsPromiseTargetType(integer), rustJsPromiseTargetType(unsigned)), false);
  const retained = selected => rustCallableTargetType([], integer, selected);
  assert.equal(rustNativeRepresentationMatches(retained(inferred), retained({ kind: "static" })), false);
  const callScoped = { kind: "call-scoped-elision" };
  assert.equal(rustNativeRepresentationMatches(retained(inferred), retained(callScoped)), true,
    "native inference can select an elided call lifetime without a representation adapter");
  for (const selected of [lifetime, otherLifetime, { kind: "static" },
    { kind: "bound", binderIdentity: "call", identity: "call:output", name: "output" }]) {
    assert.equal(rustNativeRepresentationMatches(retained(inferred), retained(selected)), false,
      "native inference never manufactures an explicit or universally bound lifetime");
  }
  assert.equal(rustNativeRepresentationMatches(retained(lifetime), retained(callScoped)), false,
    "an explicit lifetime is not silently rewritten to a distinct elided lifetime");
  assert.equal(rustValueConversionContract({ ...conversion, target: { ...target, genericArguments: [] } }), undefined);
  assert.equal(rustValueConversionContract({ ...conversion, kind: "object-identity-erasure" }), undefined);
});

test("physical source unions preserve exact identities and directional native payload lifetimes", () => {
  const integer = rustSourcePrimitiveTargetType("int64");
  const unsigned = rustSourcePrimitiveTargetType("uint64");
  const lifetime = { kind: "parameter", identity: "owner::environment", name: "environment" };
  const payloads = selected => [
    rustCallableTargetType([], integer, selected),
    rustCallableTargetType([integer], integer, selected),
    integer,
  ];
  const union = types => rustSourceUnionTargetType("/src/value.ts", "Union3", [], "generated",
    { kind: "physical", types });
  const source = union(payloads(lifetime));
  const target = union(payloads({ kind: "placeholder" }));
  assert.equal(rustNativeRepresentationMatches(source, target), true);
  assert.equal(rustNativeRepresentationMatches(target, source), false,
    "inferred payload lifetimes never manufacture a named environment");
  assert.equal(rustNativeRepresentationMatches({ kind: "array", rank: 1, element: source },
    { kind: "array", rank: 1, element: target }), true);
  for (const invalid of [
    union(payloads({ kind: "static" })),
    union(payloads({ kind: "parameter", identity: "other::environment", name: "environment" })),
    union([target.value.payloads.types[1], target.value.payloads.types[0], integer]),
    union([...target.value.payloads.types.slice(0, 2), unsigned]),
    { ...target, value: { ...target.value, fileName: "/src/other.ts" } },
    { ...target, value: { ...target.value, origin: "authored" } },
    { ...target, value: { ...target.value, typeName: "Other3" } },
    { ...target, value: { ...target.value, payloads: { kind: "source" } } },
    { ...target, value: { ...target.value, payloads: { kind: "physical", types: [integer, , integer] } } },
    { ...target, value: { ...target.value, extra: true } },
    integer,
  ]) assert.equal(rustNativeRepresentationMatches(source, invalid), false,
    "different, incomplete or malformed native union evidence is not representation identity");
});

test("future storage selects the JS rejection protocol and retargets only a proven erased native output", () => {
  const source = rustJsPromiseTargetType(rustAbsenceTargetType());
  const target = rustJsPromiseTargetType(rustUnitTargetType());
  const fact = rustFutureValueForSourceStorage(source);
  assert.equal(fact.awaiting, "fallible");
  assert.equal(fact.errorBoundary, "js-rejection");
  assert.equal(Object.hasOwn(fact, "errorCarrier"), false);
  const transported = transportRustFutureValue(fact, source, target);
  assert.ok(rustFutureValueMatchesCarrier(transported, target));
  assert.equal(transported.awaitedConversion.conversion.kind, "native-representation");
  assert.equal(transported.awaiting, fact.awaiting);
  assert.equal(transported.errorBoundary, fact.errorBoundary);
  assert.equal(transportRustFutureValue({ ...fact, outputCarrier: rustProgramErrorTargetType() }, source, target), undefined);
  assert.equal(transportRustFutureValue({ ...fact, errorBoundary: "none" }, source, target), undefined);
  assert.equal(transportRustFutureValue({ ...fact, errorCarrier: rustJsErrorTargetType() }, source, target), undefined);
  assert.equal(transportRustFutureValue({ ...fact, awaitedConversion: {
    ...fact.awaitedConversion, sourceCarrier: rustProgramErrorTargetType(),
  } }, source, target), undefined);
  const withError = { ...target, genericArguments: [...target.genericArguments, { kind: "type", type: rustJsErrorTargetType() }] };
  assert.equal(transportRustFutureValue(fact, source, withError), undefined);
  assert.equal(rustFutureValueForSourceStorage(withError), undefined);
});
