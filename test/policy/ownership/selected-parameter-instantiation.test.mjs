import assert from "node:assert/strict";
import test from "node:test";
import { instantiateRustSourceParameterValueCarrier } from "../../../dist/policy/ownership/source-callable-abi.js";
import { rustJsArrayTargetType, rustOptionTargetType, rustSourcePrimitiveTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { createRustSourceTypeFamilyRegistry } from "../../../dist/analysis/project-types/type-families.js";
import { rustTypeFamilyNormalizer } from "../../../dist/policy/types/type-family-normalization.js";

const emptyBindings = { types: new Map(), lifetimes: new Map(), consts: new Map() };
const unchanged = (carrier) => carrier;
const instantiate = (abi, selected, bindings = emptyBindings, normalize = unchanged) =>
  instantiateRustSourceParameterValueCarrier(abi, selected, bindings, normalize);

test("selected generic parameter ABI instantiation retains default, rest and reference shapes", () => {
  const generic = { kind: "type-parameter", name: "T" };
  const integer = rustSourcePrimitiveTargetType("uint32");
  const string = rustStringTargetType();
  for (const actual of [integer, string]) {
    const required = { form: "required", valueCarrier: generic, parameterCarrier: generic, mode: "value" };
    assert.deepEqual(instantiate(required, actual), actual);
    const optional = { ...required, form: "optional", valueCarrier: rustOptionTargetType(generic), parameterCarrier: rustOptionTargetType(generic) };
    assert.deepEqual(instantiate(optional, rustOptionTargetType(actual)), rustOptionTargetType(actual));
    const defaulted = { ...optional, form: "default", valueCarrier: generic };
    assert.deepEqual(instantiate(defaulted, rustOptionTargetType(actual)), actual);
    const rest = { ...required, form: "rest", valueCarrier: rustJsArrayTargetType(generic), parameterCarrier: rustJsArrayTargetType(generic) };
    assert.deepEqual(instantiate(rest, rustJsArrayTargetType(actual)), rustJsArrayTargetType(actual));
    const borrowed = { ...required, parameterCarrier: { kind: "reference", referent: generic, mutable: false }, mode: "ref" };
    assert.deepEqual(instantiate(borrowed, { kind: "reference", referent: actual, mutable: false }), actual);
    assert.equal(instantiate(borrowed, { kind: "reference", referent: actual, mutable: true }), undefined);
    assert.equal(instantiate(defaulted, actual), undefined);
    const selected = { ...emptyBindings, types: new Map([["T", actual]]) };
    assert.deepEqual(instantiate(required, actual, selected), actual);
    assert.equal(instantiate(required, actual === integer ? string : integer, selected), undefined);
  }
  assert.equal(instantiate({ form: "required", valueCarrier: integer, parameterCarrier: integer, mode: "value" }, string), undefined);
});

test("selected parameter ABI normalizes noninjective families forwards without guessing their owner", () => {
  const registry = createRustSourceTypeFamilyRegistry();
  const parameter = { kind: "type-parameter", name: "T" };
  const signed = rustSourcePrimitiveTargetType("int32");
  const unsigned = rustSourcePrimitiveTargetType("uint32");
  const family = {
    kind: "conditional",
    declaration: {}, parameter: {},
    trait: { kind: "trait-ref", id: "storage", path: "Storage",
      sourceItem: { fileName: "/storage.ts", typeName: "Storage" },
      genericArguments: [], associatedConstraints: [] },
  };
  assert.equal(registry.register(family), true);
  for (const owner of [signed, unsigned]) {
    assert.equal(registry.registerImplementation({ family, arguments: [], owner, output: unsigned, sourceFileName: "/storage.ts" }), true);
  }
  const projection = { kind: "associated-type", owner: parameter, trait: family.trait, name: "Output" };
  const abi = { form: "required", valueCarrier: projection, parameterCarrier: projection, mode: "value" };
  const normalize = rustTypeFamilyNormalizer(registry);
  for (const owner of [signed, unsigned]) {
    const selected = { ...emptyBindings, types: new Map([["T", owner]]) };
    assert.deepEqual(instantiate(abi, unsigned, selected, normalize), unsigned);
    assert.equal(instantiate(abi, signed, selected, normalize), undefined);
  }
  assert.equal(instantiate(abi, unsigned, emptyBindings, normalize), undefined);
  const callerParameter = { kind: "type-parameter", name: "Caller" };
  const selected = { ...emptyBindings, types: new Map([["T", callerParameter]]) };
  assert.equal(instantiate({ ...abi, valueCarrier: parameter, parameterCarrier: parameter }, unsigned, selected, normalize), undefined);
});
