import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { rustJsValueTargetType, rustOptionTargetType, rustStringTargetType,
  rustSourcePrimitiveTargetType, rustTsValueTargetType } from "../../../dist/target-model/types/index.js";
import { rustRecordTargetType } from "../../../dist/target-model/types/carriers/records.js";
import { rustStructuralObjectTargetType } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustJsSharedObjectValueAdmission } from "../../../dist/target-model/conversions/closed-record.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { selectRustSourceValueConversion, selectRustJsonValueConversion } from "../../../dist/policy/conversions/selection.js";
import { rustValueConversionContract } from "../../../dist/target-model/conversions/contracts.js";
import { substituteRustValueConversion } from "../../../dist/target-model/conversions/substitution.js";
import { finalizeRustProviderOperationAbi, validateRustFinalizedOperationAbi } from "../../../dist/analysis/facts/finalized-operation-abi.js";
import { lowerRustValueConversion } from "../../../dist/backend/planner/expressions/value-conversions.js";
import { fakeAstReader, fakeSourceFile, fakeStatement } from "../../helpers/fake-compile-input.mjs";

test("shared native structural objects retain their owner while explicit JSON selects field projection", () => {
  const target = rustJsValueTargetType();
  const source = rustStructuralObjectTargetType("/src/index.ts", [
    { sourceName: "count", presence: "required", readonly: false, type: rustSourcePrimitiveTargetType("uint64") },
  ]);
  const conversion = selectRustSourceValueConversion(source, target);
  assert.deepEqual(conversion, { kind: "js-value-from-closed-carrier", source });
  assert.deepEqual(rustValueConversionContract(conversion), { category: "projection", lowering: "call",
    path: "js_abi::JsValue::from", sourceMode: "value", source, target, fallible: false });
  assert.equal(selectRustJsonValueConversion(source).kind, "js-value-from-structural-object",
    "explicit serialization, not ordinary admission, owns the checked field projection");
  for (const optional of [rustOptionTargetType(source), { ...rustOptionTargetType(source), sourceAbsence: true }]) {
    const selected = selectRustSourceValueConversion(optional, target);
    assert.equal(selected.kind, "closed-value-from-option");
    assert.deepEqual(selected.elementConversion, conversion);
  }
});

test("shared native structural admission cannot erase generic or borrowed storage obligations", () => {
  const field = type => ({ sourceName: "value", presence: "required", readonly: false, type });
  const scalar = rustSourcePrimitiveTargetType("uint64");
  const source = rustStructuralObjectTargetType("/src/index.ts", [field(scalar)]);
  assert.equal(rustJsSharedObjectValueAdmission(source, emptyRustTypeDefinitions), true);
  for (const changed of [
    rustStructuralObjectTargetType("/src/index.ts", [field(scalar)], "value"),
    rustStructuralObjectTargetType("/src/index.ts", [field({ kind: "type-parameter", identity: "T", name: "T" })]),
    rustStructuralObjectTargetType("/src/index.ts", [field({ kind: "reference", referent: scalar, mutable: false,
      lifetime: { kind: "named", identity: "scope", name: "scope" } })]),
    { kind: "reference", referent: source, mutable: false },
    { ...source, value: { ...source.value, representation: "unowned" } },
  ]) {
    assert.equal(rustJsSharedObjectValueAdmission(changed, emptyRustTypeDefinitions), false,
      "the existing clone/static/native carrier owner remains authoritative");
    assert.equal(rustValueConversionContract({ kind: "js-value-from-closed-carrier", source: changed }) === undefined, true);
  }
});

test("closed record admission keeps the exact native backing and one source absence", () => {
  const target = rustJsValueTargetType();
  const record = rustRecordTargetType(rustStringTargetType(), target);
  const conversion = selectRustSourceValueConversion(record, target);
  assert.deepEqual(conversion, { kind: "js-value-from-closed-carrier", source: record });
  const contract = rustValueConversionContract(conversion);
  assert.deepEqual(contract, { category: "projection", lowering: "call", path: "js_abi::JsValue::from",
    sourceMode: "value", source: record, target, fallible: false });
  for (const source of [rustOptionTargetType(record), { ...rustOptionTargetType(record), sourceAbsence: true }]) {
    const selected = selectRustSourceValueConversion(source, target);
    assert.equal(selected.kind, "closed-value-from-option");
    assert.deepEqual(selected.elementConversion, conversion);
    assert.deepEqual(rustValueConversionContract(selected).target, target);
  }
  const node = fakeStatement({ kindName: "Identifier", pos: 0, end: 5 });
  const sourceFile = fakeSourceFile({ fileName: "/src/index.ts", text: "value", statements: [node] });
  const context = { input: { program: { source: { ast: fakeAstReader([sourceFile]) } } },
    sourceFile, usedAliases: new Set(), diagnostics: [] };
  const source = { kind: "call", path: "produce_record", args: [] };
  assert.deepEqual(lowerRustValueConversion(contract, source, context, node),
    { kind: "call", path: "js_abi::JsValue::from", args: [source] });
  assertNoTargetDiagnostics(context.diagnostics);
});

test("closed record admission rejects incorrect identity, invariant elements and unowned data", () => {
  const target = rustJsValueTargetType();
  const record = rustRecordTargetType(rustStringTargetType(), target);
  const parameter = { kind: "type-parameter", identity: "Value", name: "Value" };
  for (const source of [
    rustRecordTargetType(rustSourcePrimitiveTargetType("int64"), target),
    rustRecordTargetType(rustStringTargetType(), rustStringTargetType()),
    rustRecordTargetType(rustStringTargetType(), rustTsValueTargetType()),
    rustRecordTargetType(rustStringTargetType(), parameter),
    { kind: "reference", referent: record, mutable: false },
    { ...record, value: { ...record.value, id: "other.Record" } },
    { ...record, value: { ...record.value, path: "other::Record" } },
    { ...record, value: { ...record.value, traits: { implementations: [] } } },
  ]) {
    assert.equal(selectRustSourceValueConversion(source, target), undefined);
    assert.equal(rustValueConversionContract({ kind: "js-value-from-closed-carrier", source }), undefined);
  }
  const generic = { kind: "js-value-from-closed-carrier", source: rustRecordTargetType(rustStringTargetType(), parameter) };
  const substituted = substituteRustValueConversion(generic, new Map([[parameter.identity, target]]));
  assert.deepEqual(substituted.source, record);
  assert.ok(rustValueConversionContract(substituted));
});

test("sealed record conversion ABI retains exact input, output and validation", () => {
  const target = rustJsValueTargetType();
  const source = rustRecordTargetType(rustStringTargetType(), target);
  const conversion = selectRustSourceValueConversion(source, target);
  const abi = finalizeRustProviderOperationAbi({ operationKind: "method",
    form: { form: "call", path: "accept", argConversions: [conversion] },
    sourceArgumentCarriers: [source], resultCarrier: target, isAsync: false, isFallible: false });
  assert.ok(abi);
  assert.equal(validateRustFinalizedOperationAbi(abi), true);
  const changed = structuredClone(abi);
  changed.targetArguments[0].conversion.conversion.source = rustRecordTargetType(rustStringTargetType(), rustStringTargetType());
  assert.equal(validateRustFinalizedOperationAbi(changed), false);
});

test("closed record conversion rejects malformed metadata without invoking accessors", () => {
  const source = rustRecordTargetType(rustStringTargetType(), rustJsValueTargetType());
  const selected = { kind: "js-value-from-closed-carrier", source };
  const cyclic = structuredClone(selected);
  cyclic.source = cyclic;
  let reads = 0;
  const accessor = { kind: selected.kind };
  Object.defineProperty(accessor, "source", { enumerable: true, get() { reads += 1; return source; } });
  for (const malformed of [
    { ...selected, extra: true },
    { ...selected, source: { ...source, unknown: true } },
    { ...selected, source: undefined },
    { ...selected, source: null },
    { ...selected, source: { kind: "named", value: source.value, unsupported: () => source } },
    cyclic,
    accessor,
  ]) {
    assert.equal(rustValueConversionContract(malformed), undefined);
  }
  assert.equal(reads, 0);
});
