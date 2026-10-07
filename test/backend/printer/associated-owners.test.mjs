import assert from "node:assert/strict";
import test from "node:test";
import { printRustExpr } from "../../../dist/print/source/index.js";

test("associated calls and values qualify non-path native types without inventing new carriers", () => {
  const element = { kind: "primitive", name: "i32" };
  for (const [owner, expected] of [
    [{ kind: "primitive", name: "u64" }, "u64"],
    [{ kind: "named", path: "Item" }, "Item"],
    [{ kind: "named", path: "Vec", genericArguments: [{ kind: "type", type: element }] }, "Vec::<i32>"],
    [{ kind: "trait-object", principal: { trait: { kind: "named", path: "core::any::Any" } }, autoTraits: [] }, "<dyn core::any::Any>"],
    [{ kind: "reference", mutable: true, referent: element }, "<&mut i32>"],
    [{ kind: "slice", element }, "<[i32]>"],
    [{ kind: "tuple", elements: [element, element] }, "<(i32, i32)>"],
    [{ kind: "unit" }, "<()>"],
  ]) {
    assert.equal(printRustExpr({ kind: "associated-call", owner, method: "construct", args: [] }), `${expected}::construct()`);
    assert.equal(printRustExpr({ kind: "associated-value", owner, name: "VALUE" }), `${expected}::VALUE`);
  }
  assert.equal(printRustExpr({ kind: "associated-call", owner: { kind: "named", path: "Item" },
    trait: { kind: "named", path: "Contract" }, method: "construct", args: [] }), "<Item as Contract>::construct()");
});
