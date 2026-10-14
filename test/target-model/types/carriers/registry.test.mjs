import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { carrierDeclarationId, loadCarrierRegistry, validateCarrierRegistry } from "../../../../../tsonic/test/helpers/carrier-registry.mjs";
import { rustNamedTargetType, rustNamedTypeCarrierValue } from "../../../../dist/target-model/types/carriers/native.js";
import { rustFutureTargetType } from "../../../../dist/target-model/types/carriers/primitives.js";
import { rustJsPromiseTargetTypeWithLifetime, rustJsValueTargetType } from "../../../../dist/target-model/types/carriers/js.js";
import { rustSourceOptionalTargetType } from "../../../../dist/target-model/types/projections.js";
import { rustNativeFutureOutputType } from "../../../../dist/target-model/types/callable-completions.js";
import { rustCallableInputTargetType } from "../../../../dist/target-model/types/carriers/callables.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const current = await loadCarrierRegistry(root);

test("Rust carrier registry covers the actual native kind union and every concrete constructor contract", () => {
  assert.equal(current.files.has("src/target-model/types/carriers/registry.ts"), true);
  assert.deepEqual(validateCarrierRegistry(current.rows, current.vocabulary), []);
});

test("every Rust structural or concrete carrier omission is rejected independently", () => {
  for (const omitted of current.rows) {
    const failures = validateCarrierRegistry(current.rows.filter(row => row !== omitted), current.vocabulary);
    assert.equal(failures.length > 0, true, omitted.id);
  }
  assert.equal(new Set(current.rows.filter(row => !row.id.startsWith("kind:")).map(row => carrierDeclarationId(row.declaration))).size,
    current.vocabulary.contracts.length);
});

test("Rust registry is metadata only and preserves exact native arguments, qualifiers and lifetimes", () => {
  const value = { kind: "source-primitive", name: "int64" };
  const lifetime = { kind: "parameter", identity: "checked:scope", name: "scope" };
  const arguments_ = [
    { kind: "lifetime", lifetime },
    { kind: "type", type: { kind: "reference", referent: value, mutable: true, lifetime } },
    { kind: "const", value: { kind: "integer", value: "9007199254740993" } },
  ];
  const imported = rustNamedTargetType("checked:native:type", "user::Carrier", arguments_);
  assert.deepEqual(rustNamedTypeCarrierValue(imported).genericArguments, arguments_);
  const pending = rustJsPromiseTargetTypeWithLifetime(value, lifetime);
  assert.equal(pending.genericArguments[0].lifetime === lifetime, true);
  assert.equal(pending.genericArguments[1].type === value, true);
  assert.equal(rustFutureTargetType(value).genericArguments[0].type === value, true);
  const input = rustCallableInputTargetType([], value, lifetime);
  assert.equal(input.kind, "reference");
  assert.equal(input.mutable, false);
  assert.equal(input.lifetime === lifetime, true);
  const completion = current.rows.find(row => row.declaration.symbol === "rustNativeFutureOutputType");
  for (const ready of [false, true]) {
    const carrier = rustNativeFutureOutputType({ identity: "checked:completion", output: value, captures: [], ready });
    assert.equal(completion.kinds.includes(carrier.kind), true, `ready=${ready}`);
  }
});

test("Rust registry preserves one native absence state without extra broad-value storage", () => {
  const scalar = { kind: "source-primitive", name: "int32" };
  const optional = rustSourceOptionalTargetType(scalar);
  assert.equal(rustSourceOptionalTargetType(optional) === optional, true);
  assert.equal(optional.genericArguments[0].type === scalar, true);
  const broad = rustJsValueTargetType();
  assert.equal(rustSourceOptionalTargetType(broad) === broad, true);
});

test("retained E71 vocabulary is explicitly frozen, without admitting additional callable behavior", () => {
  for (const symbol of [
    "rustFutureTargetType", "rustFrameCallableTargetType", "rustFrameCallableCarrier",
    "rustGenericCallableTargetType", "rustGenericCallableCarrier", "rustProducerErrorTargetType",
    "rustStructuralMethodStorageCarrier", "rustCallableSignatureAbsenceWitness",
    "rustCallableInputAbsenceWitness", "rebindRustCallableCarrier",
    "instantiateRustNativeCompletion", "rustNativeCompletionFutureType", "rustNativeFutureOutputType",
  ]) {
    const row = current.rows.find(entry => entry.declaration.symbol === symbol);
    assert.equal(row?.frozen, true, symbol);
  }
});
