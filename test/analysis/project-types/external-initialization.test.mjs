import assert from "node:assert/strict";
import test from "node:test";
import { selectRustExternalInitialization } from "../../../dist/analysis/project-types/external-initialization.js";
import { finalizeRustProviderOperationAbi } from "../../../dist/analysis/facts/finalized-operation-abi.js";
import { rustOptionProjectionFactKey, rustTargetOperationFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustSourceErrorConstructorOperation } from "../../../dist/policy/operations/source-profiles/error-source-profile.js";
import { rustSourceErrorConstructors } from "../../../dist/target-model/identities/source-errors.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustAbsenceTargetType, rustJsErrorTargetType, rustSourceOptionalTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";

function fixture(carrier) {
  const call = {};
  const argument = {};
  const arguments_ = carrier === undefined ? [] : [argument];
  const absent = carrier?.id === rustAbsenceTargetType().id;
  const selectedCarrier = absent ? rustSourceOptionalTargetType(rustStringTargetType()) : carrier;
  const selected = rustSourceErrorConstructorOperation(rustSourceErrorConstructors[0], selectedCarrier === undefined ? [] : [selectedCarrier]);
  const abi = finalizeRustProviderOperationAbi({ operationKind: "constructor", form: selected.target,
    sourceArgumentCarriers: selectedCarrier === undefined ? [] : [selectedCarrier], declaredSourceArgumentCarriers: selected.parameterCarriers,
    resultCarrier: selected.resultCarrier, isAsync: false, isFallible: false });
  assert.equal(abi !== undefined, true);
  const operation = { kind: "provider-operation", operationId: "tsonic.rust.error.constructor", abi, resultCarrier: selected.resultCarrier };
  const base = { constructorOperationId: operation.operationId, constructorPath: selected.target.path,
    targetType: rustJsErrorTargetType(), fields: [{ carrier: rustStringTargetType(), initializer: { kind: "message", parameterIndex: 0 } }] };
  const ast = { arguments: () => arguments_ };
  const facts = { getFact: (node, key) => node === call && key === rustTargetOperationFactKey ? operation
    : absent && node === argument && key === rustOptionProjectionFactKey
      ? { kind: "none", sourceCarrier: carrier, resultCarrier: selectedCarrier } : undefined,
    getTargetConversionFact: () => undefined,
    getRuntimeCarrierFact: node => node === argument && carrier !== undefined ? { carrier } : undefined };
  return { call, argument, operation, base, ast, facts };
}

test("external initialization seals the actual owned field input rather than the borrowed provider ABI", () => {
  for (const [kind, carrier] of [["empty", undefined], ["value", rustStringTargetType()],
    ["optional", rustSourceOptionalTargetType(rustStringTargetType())], ["optional", rustAbsenceTargetType()]]) {
    const input = fixture(carrier);
    const selected = selectRustExternalInitialization(input.base, input.call, input.ast, input.facts, emptyRustTypeDefinitions);
    assert.equal(selected?.kind, kind);
    assert.equal(Object.isFrozen(selected), true);
    if (selected.kind === "empty") continue;
    assert.equal(selected.input.mode, "value");
    assert.equal(selected.input.conversion.kind, "identity");
    assert.equal(Object.isFrozen(selected.input), true);
    assert.equal(Object.isFrozen(selected.input.source), true);
    assert.equal(Object.isFrozen(selected.input.conversion), true);
  }
});

test("external initialization rejects foreign, mutated, duplicate and missing evidence", () => {
  const input = fixture(rustStringTargetType());
  for (const [label, base, ast, facts] of [
    ["foreign operation", input.base, input.ast, { ...input.facts, getFact: () => ({ ...input.operation, operationId: "foreign" }) }],
    ["foreign path", { ...input.base, constructorPath: "foreign::error" }, input.ast, input.facts],
    ["foreign result", { ...input.base, targetType: rustStringTargetType() }, input.ast, input.facts],
    ["malformed ABI", input.base, input.ast, { ...input.facts, getFact: () => ({ ...input.operation, abi: { ...input.operation.abi, targetArguments: [] } }) }],
    ["missing operand", input.base, { arguments: () => [undefined] }, input.facts],
    ["missing source fact", input.base, input.ast, { ...input.facts, getRuntimeCarrierFact: () => undefined }],
    ["conflicting source", input.base, input.ast, { ...input.facts, getRuntimeCarrierFact: () => ({ carrier: rustAbsenceTargetType() }) }],
    ["extra argument", input.base, { arguments: () => [input.argument, {}] }, input.facts],
    ["duplicate initializer", { ...input.base, fields: [...input.base.fields, ...input.base.fields] }, input.ast, input.facts],
    ["foreign field carrier", { ...input.base, fields: [{ ...input.base.fields[0], carrier: rustJsErrorTargetType() }] }, input.ast, input.facts],
    ["foreign field index", { ...input.base, fields: [{ ...input.base.fields[0], initializer: { kind: "message", parameterIndex: 1 } }] }, input.ast, input.facts],
  ]) assert.equal(selectRustExternalInitialization(base, input.call, ast, facts, emptyRustTypeDefinitions) === undefined, true, label);
});
