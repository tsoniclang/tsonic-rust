import assert from "node:assert/strict";
import test from "node:test";
import { finalizeRustProviderOperationAbi, validateRustFinalizedOperationAbi } from "../../../dist/analysis/facts/finalized-operation-abi.js";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { selectRustSourceValueConversion } from "../../../dist/policy/conversions/selection.js";
import { substituteRustValueConversion } from "../../../dist/target-model/conversions/substitution.js";
import { rustValueConversionIdentity } from "../../../dist/target-model/conversions/contracts.js";
import { rustAbsenceTargetType, rustJsPromiseTargetTypeWithLifetime, rustSourceUnionTargetType, rustStringTargetType, rustUnitTargetType } from "../../../dist/target-model/types/index.js";

function fixture() {
  const source = rustJsPromiseTargetTypeWithLifetime(rustAbsenceTargetType(), { kind: "static" });
  const payloadCarrier = rustJsPromiseTargetTypeWithLifetime(rustUnitTargetType(), { kind: "placeholder" });
  const target = rustSourceUnionTargetType("/src/index.ts", "Completion");
  const registry = createRustTypeDefinitionRegistry();
  assert.equal(registry.registerSourceUnion({ carrier: target, variants: [
    { name: "Future", carrier: payloadCarrier }, { name: "Text", carrier: rustStringTargetType() },
  ] }, true), true);
  const definitions = registry.seal();
  const conversion = selectRustSourceValueConversion(source, target, definitions);
  const options = { operationKind: "method", form: { form: "call", path: "acme::finish" },
    sourceArgumentCarriers: [], resultCarrier: target, resultConversion: conversion,
    isAsync: false, isFallible: false };
  return { source, payloadCarrier, target, conversion, options, definitions };
}

test("finalized provider unions retain their exact composed payload evidence", () => {
  const { conversion, options, definitions } = fixture();
  const abi = finalizeRustProviderOperationAbi(options, definitions);
  assert.ok(abi);
  assert.equal(validateRustFinalizedOperationAbi(abi, definitions), true);
  assert.deepEqual(abi.result.conversion.conversion, conversion);
  const { payloadCarrier, payloadConversion, ...removedShape } = conversion;
  for (const invalid of [removedShape, { ...conversion, payloadCarrier: conversion.source },
    { ...conversion, payloadConversion: null }, { ...conversion, payloadConversion: undefined },
    { ...conversion, payloadConversion: { ...payloadConversion, extra: true } },
    { ...conversion, payloadConversion: { ...payloadConversion, target: conversion.source } }]) {
    assert.equal(finalizeRustProviderOperationAbi({ ...options, resultConversion: invalid }, definitions), undefined);
    assert.equal(validateRustFinalizedOperationAbi({ ...abi, result: { ...abi.result,
      conversion: { ...abi.result.conversion, conversion: invalid } } }, definitions), false);
  }
  assert.equal(validateRustFinalizedOperationAbi(abi), false);
  assert.notEqual(rustValueConversionIdentity(conversion), rustValueConversionIdentity({ ...conversion, payloadConversion: null }));
});

test("generic union payload substitution updates both the payload and its nested conversion", () => {
  const parameter = { kind: "type-parameter", identity: "T", name: "T" };
  const target = rustSourceUnionTargetType("/src/index.ts", "Completion");
  const source = rustJsPromiseTargetTypeWithLifetime(parameter, { kind: "static" });
  const payloadCarrier = rustJsPromiseTargetTypeWithLifetime(parameter, { kind: "placeholder" });
  const conversion = { kind: "source-union-variant", source, target, variantName: "Future", payloadCarrier,
    payloadConversion: { kind: "native-representation", source, target: payloadCarrier } };
  const actual = substituteRustValueConversion(conversion, new Map([["T", rustStringTargetType()]]));
  assert.deepEqual(actual.payloadCarrier, rustJsPromiseTargetTypeWithLifetime(rustStringTargetType(), { kind: "placeholder" }));
  assert.deepEqual(actual.payloadConversion.source, actual.source);
  assert.deepEqual(actual.payloadConversion.target, actual.payloadCarrier);
  assert.deepEqual(conversion.payloadCarrier, payloadCarrier);
  assert.ok(Object.isFrozen(actual));
});
