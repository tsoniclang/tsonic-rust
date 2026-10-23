import assert from "node:assert/strict";
import test from "node:test";
import { collectAliasesFromRustType } from "../../../../dist/backend/planner/types/type-observations.js";

const payload = { kind: "named", path: "rt::Payload", identity: "runtime-payload" };
const input = { kind: "named", path: "input_native::Input" };
const bound = { kind: "trait", path: "bound_native::Trait" };
const constant = { kind: "path", path: "extent_native::COUNT" };

function references(type) {
  const result = new Set();
  collectAliasesFromRustType(type, path => result.add(path));
  return [...result].sort();
}

for (const [name, type, expected] of [
  ["named", payload, ["rt::Payload"]],
  ["nested reference", { kind: "reference", mutable: true, referent: payload }, ["rt::Payload"]],
  ["raw pointer", { kind: "raw-pointer", mutable: false, pointee: payload }, ["rt::Payload"]],
  ["slice", { kind: "slice", element: payload }, ["rt::Payload"]],
  ["fixed-array extent", { kind: "fixed-array", element: payload, length: constant }, ["extent_native::COUNT", "rt::Payload"]],
  ["tuple", { kind: "tuple", elements: [input, payload] }, ["input_native::Input", "rt::Payload"]],
  ["function pointer", { kind: "function-pointer", parameters: [input], result: payload }, ["input_native::Input", "rt::Payload"]],
  ["callable trait", { kind: "callable-trait", trait: "Fn", parameters: [input], result: payload }, ["input_native::Input", "rt::Payload"]],
  ["qualified output", { kind: "qualified", owner: payload, trait: input, member: "Output" }, ["input_native::Input", "rt::Payload"]],
  ["trait object", { kind: "trait-object", principal: { trait: payload }, autoTraits: [{ trait: input }] }, ["input_native::Input", "rt::Payload"]],
  ["opaque bounds and captures", { kind: "impl-trait", bounds: [bound], outlives: [], captures: [{ kind: "type", type: payload },
    { kind: "const", value: constant }] }, ["bound_native::Trait", "extent_native::COUNT", "rt::Payload"]],
  ["associated equality", { kind: "named", path: "owner_native::Container", genericArguments: [{ kind: "associated-equality",
    name: "Item", genericArguments: [{ kind: "const", value: constant }], type: payload }] },
  ["extent_native::COUNT", "owner_native::Container", "rt::Payload"]],
  ["associated bounds", { kind: "named", path: "owner_native::Container", genericArguments: [{ kind: "associated-bounds",
    name: "Item", genericArguments: [{ kind: "type", type: input }], bounds: [bound, { kind: "trait-type", reference: { trait: payload } }] }] },
  ["bound_native::Trait", "input_native::Input", "owner_native::Container", "rt::Payload"]],
  ["callable bound", { kind: "impl-trait", outlives: [], bounds: [{ kind: "callable", trait: "FnOnce", binder: [], parameters: [input], result: payload }] },
  ["input_native::Input", "rt::Payload"]],
]) {
  test(`native type reference demand covers ${name}`, () => {
    assert.deepEqual(references(type), expected, "only actual type, bound and constant paths are demanded");
  });
}

test("native type reference demand ignores absent types, intrinsic types, lifetimes and numeric extents", () => {
  for (const type of [undefined, { kind: "infer" }, { kind: "primitive", name: "i32" }, { kind: "string" }, { kind: "str" },
    { kind: "unit" }, { kind: "never" }, { kind: "fixed-array", element: { kind: "primitive", name: "u8" },
      length: { kind: "integer", value: 4n } }, { kind: "impl-trait", outlives: [], bounds: [{ kind: "lifetime", lifetime: { kind: "static" } },
        { kind: "maybe-sized" }], captures: [{ kind: "lifetime", lifetime: { kind: "named", name: "rt" } }] }]) {
    assert.deepEqual(references(type), [], "non-path syntax creates no native module demand");
  }
});
