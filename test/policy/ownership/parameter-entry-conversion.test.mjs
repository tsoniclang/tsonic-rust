import assert from "node:assert/strict";
import test from "node:test";
import { selectRustParameterEntryConversion } from "../../../dist/policy/ownership/parameter-entry-conversion.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustValueConversionContract } from "../../../dist/target-model/conversions/contracts.js";

const primitive = name => ({ kind: "source-primitive", name });

test("native parameter entry admits only proven complete-width float widening", () => {
  for (const name of ["int8", "uint8", "int16", "uint16", "int32", "uint32", "float32"]) {
    const selected = selectRustParameterEntryConversion(primitive(name), primitive("float64"), emptyRustTypeDefinitions);
    const contract = rustValueConversionContract(selected, emptyRustTypeDefinitions);
    assert.equal(contract !== undefined, true, name);
    assert.equal(contract.sourceMode, "value");
    assert.equal(contract.fallible, false);
    assert.equal(contract.source.name, name);
    assert.equal(contract.target.name, "float64");
  }
});

test("native parameter entry rejects precision loss, narrowing and unproven ownership", () => {
  for (const [source, target] of [
    ...["int64", "uint64", "int128", "uint128", "native-int", "native-uint"].map(name => [primitive(name), primitive("float64")]),
    [primitive("float64"), primitive("uint8")],
    [primitive("float64"), primitive("float32")],
    [{ kind: "reference", mutable: false, referent: primitive("uint8") }, primitive("uint8")],
    [primitive("uint8"), { kind: "reference", mutable: true, referent: primitive("uint8") }],
  ]) assert.equal(selectRustParameterEntryConversion(source, target, emptyRustTypeDefinitions) === undefined, true);
});
