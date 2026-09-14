import assert from "node:assert/strict";
import test from "node:test";
import { instantiateRustSourceParameterValueCarrier } from "../../../dist/policy/ownership/source-callable-abi.js";
import { rustJsArrayTargetType, rustOptionTargetType, rustSourcePrimitiveTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";

test("selected generic parameter ABI instantiation retains default, rest and reference shapes", () => {
  const generic = { kind: "type-parameter", name: "T" };
  const integer = rustSourcePrimitiveTargetType("uint32");
  const string = rustStringTargetType();
  for (const actual of [integer, string]) {
    const required = { form: "required", valueCarrier: generic, parameterCarrier: generic, mode: "value" };
    assert.deepEqual(instantiateRustSourceParameterValueCarrier(required, actual), actual);
    const optional = { ...required, form: "optional", valueCarrier: rustOptionTargetType(generic), parameterCarrier: rustOptionTargetType(generic) };
    assert.deepEqual(instantiateRustSourceParameterValueCarrier(optional, rustOptionTargetType(actual)), rustOptionTargetType(actual));
    const defaulted = { ...optional, form: "default", valueCarrier: generic };
    assert.deepEqual(instantiateRustSourceParameterValueCarrier(defaulted, rustOptionTargetType(actual)), actual);
    const rest = { ...required, form: "rest", valueCarrier: rustJsArrayTargetType(generic), parameterCarrier: rustJsArrayTargetType(generic) };
    assert.deepEqual(instantiateRustSourceParameterValueCarrier(rest, rustJsArrayTargetType(actual)), rustJsArrayTargetType(actual));
    const borrowed = { ...required, parameterCarrier: { kind: "reference", referent: generic, mutable: false }, mode: "ref" };
    assert.deepEqual(instantiateRustSourceParameterValueCarrier(borrowed, { kind: "reference", referent: actual, mutable: false }), actual);
    assert.equal(instantiateRustSourceParameterValueCarrier(borrowed, { kind: "reference", referent: actual, mutable: true }), undefined);
    assert.equal(instantiateRustSourceParameterValueCarrier(defaulted, actual), undefined);
  }
  assert.equal(instantiateRustSourceParameterValueCarrier({ form: "required", valueCarrier: integer, parameterCarrier: integer, mode: "value" }, string), undefined);
});
