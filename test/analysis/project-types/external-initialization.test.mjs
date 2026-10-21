import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { selectRustExternalInitialization } from "../../../dist/analysis/project-types/external-initialization.js";
import { finalizeRustProviderOperationAbi } from "../../../dist/policy/operations/members/abi/finalize.js";


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
  const records = createRustRecordFixture({targetOperation: { get: (node) => node === call ? operation
    : absent && node === argument && false
        ? { kind: "none", sourceCarrier: carrier, resultCarrier: selectedCarrier } : undefined },
optionProjection: { get: (node) => node === call && false ? operation
    : absent && node === argument
        ? { kind: "none", sourceCarrier: carrier, resultCarrier: selectedCarrier } : undefined },
conversion: { get: () => undefined },
runtimeCarrier: { get: (node) => node === argument && carrier !== undefined ? { carrier } : undefined }});
  return { call, argument, operation, base, ast, records };
}

test("external initialization seals the actual owned field input rather than the borrowed provider ABI", () => {
  for (const [kind, carrier] of [["empty", undefined], ["value", rustStringTargetType()],
    ["optional", rustSourceOptionalTargetType(rustStringTargetType())], ["optional", rustAbsenceTargetType()]]) {
    const input = fixture(carrier);
    const selected = selectRustExternalInitialization(input.base, input.call, input.ast, input.records, emptyRustTypeDefinitions);
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
    ["foreign operation", input.base, input.ast, { ...input.records,
      targetOperation: { get: () => ({ ...input.operation, operationId: "foreign" }) } }],
    ["foreign path", { ...input.base, constructorPath: "foreign::error" }, input.ast, input.records],
    ["foreign result", { ...input.base, targetType: rustStringTargetType() }, input.ast, input.records],
    ["malformed ABI", input.base, input.ast, { ...input.records,
      targetOperation: { get: () => ({ ...input.operation, abi: { ...input.operation.abi, targetArguments: [] } }) } }],
    ["missing operand", input.base, { arguments: () => [undefined] }, input.records],
    ["missing source fact", input.base, input.ast, createRustRecordFixture({
runtimeCarrier: { get: () => undefined }}, input.records)],
    ["conflicting source", input.base, input.ast, createRustRecordFixture({
runtimeCarrier: { get: () => ({ carrier: rustAbsenceTargetType() }) }}, input.records)],
    ["extra argument", input.base, { arguments: () => [input.argument, {}] }, input.records],
    ["duplicate initializer", { ...input.base, fields: [...input.base.fields, ...input.base.fields] }, input.ast, input.records],
    ["foreign field carrier", { ...input.base, fields: [{ ...input.base.fields[0], carrier: rustJsErrorTargetType() }] }, input.ast, input.records],
    ["foreign field index", { ...input.base, fields: [{ ...input.base.fields[0], initializer: { kind: "message", parameterIndex: 1 } }] }, input.ast, input.records],
  ]) assert.equal(selectRustExternalInitialization(base, input.call, ast, facts, emptyRustTypeDefinitions) === undefined, true, label);
});
