import assert from "node:assert/strict";
import test from "node:test";
import { rustValueConversionContract } from "../../../dist/target-model/conversions/contracts.js";
import { validateValueConversion } from "../../../dist/providers/packages/validation/carriers.js";

test("integer refinements preserve width and require the exact signed/unsigned pair", () => {
  for (const [source, target, targetType] of [
    ["int8", "uint8", "u8"], ["int16", "uint16", "u16"], ["int32", "uint32", "u32"],
    ["int64", "uint64", "u64"], ["int128", "uint128", "u128"], ["native-int", "native-uint", "usize"],
  ]) {
    const conversion = { kind: "integer-refinement", source, target, proof: "nonnegative" };
    const contract = rustValueConversionContract(conversion);
    assert.equal(contract.lowering, "numeric-cast");
    assert.equal(contract.category, "exact");
    assert.equal(contract.fallible, false);
    assert.equal(contract.targetType, targetType);
    for (const mutation of [{ target: "float64" }, { target: "uint8" }, { source: target }, { proof: "unchecked" }]) {
      if (mutation.target === target) continue;
      assert.equal(rustValueConversionContract({ ...conversion, ...mutation }), undefined);
    }
  }
});

test("provider metadata cannot manufacture a compiler-owned guard proof", () => {
  assert.throws(() => validateValueConversion({ kind: "integer-refinement", source: "int64", target: "uint64",
    proof: "nonnegative" }, {}, "conversion", undefined, undefined, message => { throw new Error(message); }),
    /kind.*not supported/u);
});
