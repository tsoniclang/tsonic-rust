import assert from "node:assert/strict";
import test from "node:test";
import { rustProviderRecordCopyMatches } from "../../dist/target-model/conversions/provider-record.js";
import { rustContextualValueConversionIsFallible } from "../../dist/target-model/conversions/contextual.js";
import { rustStructuralObjectTargetType, rustNamedTargetType, rustSourcePrimitiveTargetType } from "../../dist/target-model/types/index.js";

const number = rustSourcePrimitiveTargetType("float64");
const boolean = rustSourcePrimitiveTargetType("bool");
const field = (sourceName, type = number) => ({ sourceName, type, presence: "required", readonly: false });
const source = rustStructuralObjectTargetType("index.ts", [field("user"), field("system")]);
const target = rustNamedTargetType("test.Cpu", "test::Cpu");
const conversion = { kind: "provider-record-copy", source, target, completion: "complete", fields: [
  { storageIndex: 0, sourceCarrier: number, carrier: number, targetName: "system_time" },
  { storageIndex: 1, sourceCarrier: number, carrier: number, targetName: "user_time" },
] };

test("provider record copies retain exact source storage and target carriers", () => {
  assert.equal(rustProviderRecordCopyMatches(conversion, source, target), true);
  assert.equal(rustProviderRecordCopyMatches({ ...conversion, completion: "default" }, source, target), true);
  assert.equal(rustProviderRecordCopyMatches(conversion, source, rustNamedTargetType("test.Other", "test::Other")), false);
  assert.equal(rustProviderRecordCopyMatches(conversion, target, source), false);
});

test("provider record copy mutations cannot change storage, width or presence", () => {
  for (const mutation of [
    { storageIndex: -1 }, { storageIndex: 2 }, { storageIndex: 0.5 }, { storageIndex: NaN },
    { carrier: boolean }, { targetName: "" }, { targetName: "user_time" },
  ]) {
    assert.equal(rustProviderRecordCopyMatches({ ...conversion, fields: [
      { ...conversion.fields[0], ...mutation }, conversion.fields[1],
    ] }, source, target), false);
  }
  for (const change of [{ presence: "optional" }, { method: true }, { accessor: { getter: true, setter: true } }]) {
    const changed = rustStructuralObjectTargetType("index.ts", [field("user"), { ...field("system"), ...change }]);
    assert.equal(rustProviderRecordCopyMatches({ ...conversion, source: changed }, changed, target), false);
  }
  assert.equal(rustProviderRecordCopyMatches({ ...conversion, completion: "arbitrary" }, source, target), false);
});

test("provider numeric field copies seal the exact checked conversion", () => {
  const integer = rustSourcePrimitiveTargetType("uint64");
  const fieldConversion = { kind: "exact-integer", source: number, target: integer };
  const selected = { ...conversion, fields: [
    { ...conversion.fields[0], carrier: integer, conversion: fieldConversion }, conversion.fields[1],
  ] };
  assert.equal(rustProviderRecordCopyMatches(selected, source, target), true);
  assert.equal(rustContextualValueConversionIsFallible(selected), true);
  assert.equal(rustContextualValueConversionIsFallible(conversion), false);
  for (const mutation of [
    { sourceCarrier: integer }, { carrier: number }, { conversion: undefined },
    { conversion: { ...fieldConversion, source: integer } },
    { conversion: { ...fieldConversion, target: boolean } },
  ]) {
    assert.equal(rustProviderRecordCopyMatches({ ...selected, fields: [
      { ...selected.fields[0], ...mutation }, selected.fields[1],
    ] }, source, target), false);
  }
});
