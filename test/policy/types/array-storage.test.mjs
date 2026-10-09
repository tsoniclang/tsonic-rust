import assert from "node:assert/strict";
import test from "node:test";
import { selectRustArrayElementStorage } from "../../../dist/policy/types/array-storage.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustBigIntTargetType, rustEmptyObjectTargetType, rustJsValueTargetType, rustSourcePrimitiveTargetType,
  rustStringTargetType, rustTsValueTargetType } from "../../../dist/target-model/types/index.js";

test("array producers use one consistently demanded closed element representation", () => {
  const source = rustEmptyObjectTargetType();
  for (const target of [rustTsValueTargetType(), rustJsValueTargetType()]) {
    const demands = Object.freeze([target, target]);
    assert.equal(selectRustArrayElementStorage(source, demands, emptyRustTypeDefinitions) === target, true);
    assert.equal(demands.length, 2, "checked demands are not mutated");
  }
  assert.equal(selectRustArrayElementStorage(source, [source], emptyRustTypeDefinitions) === source, true);
});

test("array storage demands never change inferred native integer, floating or BigInt carriers", () => {
  for (const source of [...["int32", "int64", "uint64", "float64"].map(rustSourcePrimitiveTargetType), rustBigIntTargetType()]) {
    for (const target of [rustSourcePrimitiveTargetType("float64"), rustSourcePrimitiveTargetType("int32"),
      rustTsValueTargetType(), rustJsValueTargetType()]) {
      assert.equal(selectRustArrayElementStorage(source, [target], emptyRustTypeDefinitions) === source, true,
        `${source.name ?? source.id} retains its native carrier`);
    }
  }
});

test("array storage does not guess inconsistent, unsupported or foreign element correspondence", () => {
  const source = rustEmptyObjectTargetType();
  const foreign = { kind: "type-parameter", identity: "foreign:T", name: "T" };
  for (const [label, demands] of [
    ["no selected demand", []],
    ["inconsistent closed carriers", [rustTsValueTargetType(), rustJsValueTargetType()]],
    ["inconsistent width", [rustSourcePrimitiveTargetType("int32"), rustSourcePrimitiveTargetType("uint32")]],
    ["unrelated string", [rustStringTargetType()]],
    ["foreign parameter", [foreign]],
    ["mutable reference", [{ kind: "reference", mutable: true, referent: source }]],
  ]) {
    assert.equal(selectRustArrayElementStorage(source, demands, emptyRustTypeDefinitions) === source, true, label);
  }
});
