import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { carrierDeclarationId, loadCarrierRegistry, validateCarrierRegistry } from "../../../../../tsonic/test/helpers/carrier-registry.mjs";
import { rustFixedArrayTargetType, rustNamedTargetType, rustNamedTypeCarrierValue } from "../../../../dist/target-model/types/carriers/native.js";
import { rustFutureTargetType } from "../../../../dist/target-model/types/carriers/primitives.js";
import { rustJsValueTargetType } from "../../../../dist/target-model/types/carriers/js.js";
import { rustJsPromiseTargetType } from "../../../../dist/target-model/types/carriers/promises.js";
import { rustSourceOptionalTargetType } from "../../../../dist/target-model/types/projections.js";
import { rustNativeFutureOutputType } from "../../../../dist/target-model/types/callable-completions.js";
import { rustCallableInputTargetType } from "../../../../dist/target-model/types/carriers/callables.js";
import { rustIndexedFieldProjection, rustIndexedFieldTrait } from "../../../../dist/target-model/types/carriers/indexed-fields.js";
import { rustTypeFromCarrier } from "../../../../dist/backend/planner/types/carrier-syntax.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const current = await loadCarrierRegistry(root);

test("Rust carrier registry covers the actual native kind union and every concrete constructor contract", () => {
  assert.equal([...current.files.keys()].some(file => file.includes("carriers/registry")), false, "product source ships no registry");
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

test("native pending evidence and receiver exclusion retain their concrete existing responsibility owners", () => {
  for (const [symbol, module, responsibility] of [
    ["selectRustNativePendingEnvironment", "src/analysis/callables/ownership/retained-environments.ts", "callables/retained-call-result"],
    ["rustStructuralMethodStorageWithoutSelf", "src/analysis/declarations/generic-carrier-requirements.ts", "vocabulary/carrier-substitution"],
  ]) {
    const row = current.rows.find(row => row.declaration.symbol === symbol);
    assert.equal(row !== undefined, true, `${symbol}: its actual concrete declaration remains registered`);
    assert.equal(row.declaration.module, module, `${symbol}: exact source owner`);
    assert.equal(row.responsibility, responsibility, `${symbol}: existing semantic family, not a helper-name divergence`);
    assert.equal(row.kinds.length === 1 && row.kinds[0] === "tuple", true, `${symbol}: actual tuple evidence constructor`);
  }
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
  const pending = rustJsPromiseTargetType(value);
  assert.equal(pending.genericArguments.length, 1);
  assert.equal(pending.genericArguments[0].type === value, true);
  const borrowedPayload = { kind: "reference", referent: value, mutable: false, lifetime };
  assert.equal(rustJsPromiseTargetType(borrowedPayload).genericArguments[0].type.lifetime === lifetime, true,
    "a borrow inside the payload keeps its exact lifetime");
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

test("native array const extents and trait-associated projections retain exact Rust syntax without another target's carriers", () => {
  const value = { kind: "source-primitive", name: "int64" };
  const key = { kind: "source-primitive", name: "uint32" };
  const extent = { kind: "integer", value: "9007199254740993" };
  const fixed = rustFixedArrayTargetType(value, extent);
  assert.equal(fixed.value.element === value, true);
  assert.equal(fixed.value.length === extent, true);
  assert.deepEqual(rustTypeFromCarrier(fixed), { kind: "fixed-array", element: { kind: "primitive", name: "i64" },
    length: { kind: "integer", value: 9007199254740993n } });
  const projection = rustIndexedFieldProjection(value, key);
  assert.equal(projection.owner === value, true);
  assert.equal(projection.trait.genericArguments[0].type === key, true);
  assert.deepEqual(rustTypeFromCarrier(rustIndexedFieldTrait), { kind: "named", path: "rt::Field" });
  assert.deepEqual(rustTypeFromCarrier(projection), { kind: "qualified", owner: { kind: "primitive", name: "i64" },
    trait: { kind: "named", path: "rt::Field", genericArguments: [{ kind: "type", type: { kind: "primitive", name: "u32" } }] },
    member: "Output" });
  assert.equal(rustTypeFromCarrier({ ...projection, owner: { kind: "opaque", id: "unrenderable" } }) === undefined, true);
});
