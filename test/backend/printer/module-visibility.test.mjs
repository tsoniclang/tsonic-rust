import { rustWordAttribute, rustHiddenAttribute } from "../../../dist/backend/target-ast/attributes.js";
import assert from "node:assert/strict";
import test from "node:test";
import { emptyRustGenerics } from "../../../dist/backend/target-ast/nodes.js";
import { closeRustModuleTypeVisibility } from "../../../dist/backend/target-ast/normalization/module-visibility.js";
import { finalizeRustDeadCode } from "../../../dist/backend/target-ast/normalization/dead-code.js";

const trait = (name, visibility, superTraits = []) => ({
  kind: "trait", name, visibility, generics: emptyRustGenerics, functions: [], superTraits,
});

test("public native signatures close visibility across modules without exposing unrelated types", () => {
  const models = new Map([
    ["shapes", { items: [trait("View", "public", [{ kind: "named", path: "crate::base::BaseDispatch" }])] }],
    ["base", { items: [trait("BaseDispatch", "crate", [{ kind: "named", path: "crate::leaf::Leaf" }]),
      trait("Hidden", "crate")] }],
    ["leaf", { items: [trait("Leaf", "crate"), trait("Hidden", "crate")] }],
  ]);
  const closed = closeRustModuleTypeVisibility(models);
  assert.deepEqual(closed.get("base").items.map(item => [item.name, item.visibility]),
    [["BaseDispatch", "public"], ["Hidden", "crate"]]);
  assert.deepEqual(closed.get("leaf").items.map(item => [item.name, item.visibility]),
    [["Leaf", "public"], ["Hidden", "crate"]]);
  assert.equal(models.get("base").items[0].visibility, "crate");
  assert.deepEqual(closeRustModuleTypeVisibility(closed), closed);
});

test("private and external native signatures do not promote local lookalikes", () => {
  const models = new Map([
    ["owner", { items: [trait("Private", "crate", [{ kind: "named", path: "crate::leaf::Leaf" }]),
      trait("Public", "public", [{ kind: "named", path: "dependency::leaf::Leaf" }])] }],
    ["leaf", { items: [trait("Leaf", "crate")] }],
  ]);
  assert.equal(closeRustModuleTypeVisibility(models).get("leaf").items[0].visibility, "crate");
});

test("public trait promotion removes only obsolete dead-code expectations", () => {
  const method = { name: "read", generics: emptyRustGenerics, params: [],
    returnType: { kind: "unit" }, deadCode: "generated-unused-dispatch",
    attrs: [rustWordAttribute("must_use")] };
  const models = new Map([
    ["api", { items: [trait("Public", "public", [{ kind: "named", path: "crate::base::Base" }])] }],
    ["base", { items: [{ ...trait("Base", "crate"), functions: [method] },
      { ...trait("Private", "crate"), functions: [method] }] }],
  ]);
  const finalized = finalizeRustDeadCode(closeRustModuleTypeVisibility(models).get("base"));
  assert.deepEqual(finalized.items[0].functions[0].attrs, ["#[must_use]"]);
  assert.match(finalized.items[1].functions[0].attrs[1], /expect\(dead_code/u);
  assert.equal(method.deadCode, "generated-unused-dispatch");
});

test("already-public unused traits retain their exact dead-code dispositions", () => {
  const unused = { ...trait("Unused", "public"), deadCode: "authored-declaration",
    attrs: [rustHiddenAttribute], functions: [{ name: "read", generics: emptyRustGenerics,
      params: [], returnType: { kind: "unit" }, deadCode: "authored-declaration" }] };
  const models = new Map([["internal", { items: [unused] }]]);
  const closed = closeRustModuleTypeVisibility(models);
  const finalized = finalizeRustDeadCode(closed.get("internal")).items[0];
  assert.equal(finalized.visibility, "public");
  assert.deepEqual(finalized.attrs, ["#[doc(hidden)]",
    '#[allow(dead_code, reason = "retains an unused authored declaration")]']);
  assert.deepEqual(finalized.functions[0].attrs,
    ['#[allow(dead_code, reason = "retains an unused authored declaration")]']);
  assert.equal(unused.deadCode, "authored-declaration");
  assert.deepEqual(closeRustModuleTypeVisibility(closed), closed);
});
