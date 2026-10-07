import assert from "node:assert/strict";
import test from "node:test";
import { rustNativeCallableResultMatches } from "../../../dist/policy/ownership/callable-result-contract.js";

const carrier = name => ({ kind: "source-primitive", name });

test("native callable result correspondence uses canonical numeric promotions, not conversion representation names", () => {
  for (const [source, target] of [["int32", "float64"], ["uint64", "float64"], ["native-uint", "float64"],
    ["uint16", "uint32"], ["float32", "float64"], ["int64", "int128"]]) {
    assert.equal(rustNativeCallableResultMatches(carrier(source), carrier(target)), true, `${source} -> ${target}`);
  }
  assert.equal(rustNativeCallableResultMatches(carrier("int64"), carrier("int64")), true);
});

test("native callable result correspondence rejects narrowing, boxing, signedness loss and unresolved carriers", () => {
  for (const [source, target] of [["float64", "int32"], ["int32", "uint8"], ["uint64", "int64"],
    ["int64", "int32"], ["float64", "float32"]]) {
    assert.equal(rustNativeCallableResultMatches(carrier(source), carrier(target)), false, `${source} -> ${target}`);
  }
  const integer = carrier("int32");
  for (const target of [{ kind: "target-named", id: "rust.runtime.TsValue" },
    { kind: "opaque", id: "missing" }, { kind: "reference", mutable: false, referent: integer }]) {
    assert.equal(rustNativeCallableResultMatches(integer, target), false, "no runtime adaptation establishes a native result ABI");
  }
});
