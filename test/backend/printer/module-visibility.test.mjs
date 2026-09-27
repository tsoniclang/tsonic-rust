import { rustWordAttribute, rustHiddenAttribute } from "../../../dist/backend/target-ast/attributes.js";
import assert from "node:assert/strict";
import test from "node:test";
import { emptyRustGenerics } from "../../../dist/backend/target-ast/nodes.js";
import { closeRustModuleTypeVisibility } from "../../../dist/backend/target-ast/normalization/module-visibility.js";
import { finalizeRustDeadCode } from "../../../dist/backend/target-ast/normalization/dead-code.js";
import { rustLintAttributes } from "../../../dist/backend/target-ast/normalization/lint-policy.js";

const trait = (name, visibility, superTraits = []) => ({
  kind: "trait", name, visibility, generics: emptyRustGenerics, members: [], superTraits,
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
  const method = { kind: "function", name: "read", generics: emptyRustGenerics, params: [],
    returnType: { kind: "unit" }, deadCode: "generated-unused-dispatch",
    attrs: [rustWordAttribute("must_use")] };
  const models = new Map([
    ["api", { items: [trait("Public", "public", [{ kind: "named", path: "crate::base::Base" }])] }],
    ["base", { items: [{ ...trait("Base", "crate"), members: [method] },
      { ...trait("Private", "crate"), members: [method] }] }],
  ]);
  const finalized = finalizeRustDeadCode(closeRustModuleTypeVisibility(models).get("base"));
  assert.deepEqual(finalized.items[0].members[0].attrs, [rustWordAttribute("must_use")]);
  assert.deepEqual(finalized.items[1].members[0].attrs,
    [rustWordAttribute("must_use"), rustLintAttributes.generatedUnusedDispatch]);
  assert.equal(method.deadCode, "generated-unused-dispatch");
});

test("already-public unused traits retain their exact dead-code dispositions", () => {
  const unused = { ...trait("Unused", "public"), deadCode: "authored-declaration",
    attrs: [rustHiddenAttribute], members: [{ kind: "function", name: "read", generics: emptyRustGenerics,
      params: [], returnType: { kind: "unit" }, deadCode: "authored-declaration" }] };
  const models = new Map([["internal", { items: [unused] }]]);
  const closed = closeRustModuleTypeVisibility(models);
  const finalized = finalizeRustDeadCode(closed.get("internal")).items[0];
  assert.equal(finalized.visibility, "public");
  assert.deepEqual(finalized.attrs, [rustHiddenAttribute, rustLintAttributes.authoredDeadCode]);
  assert.deepEqual(finalized.members[0].attrs,
    [rustLintAttributes.authoredDeadCode]);
  assert.equal(unused.deadCode, "authored-declaration");
  assert.deepEqual(closeRustModuleTypeVisibility(closed), closed);
});

test("public signatures expose a local type's scope and dependencies without exposing its namesakes", () => {
  const nested = (name, fields) => ({ kind: "mod-decl", name, visibility: "crate", body: { items: [
    { kind: "use", path: "super::*" },
    { kind: "struct", name: "Entry", visibility: "crate", generics: emptyRustGenerics, fields },
  ] } });
  const models = new Map([
    ["api", { items: [{ kind: "function", name: "makeValue", visibility: "public", generics: emptyRustGenerics,
      params: [], returnType: { kind: "named", path: "crate::values::first_scope::Entry" }, body: { statements: [] } }] }],
    ["values", { items: [nested("first_scope", [{ name: "value", visibility: "public",
      type: { kind: "named", path: "Payload" } }]), nested("second_scope", []),
      { kind: "struct", name: "Payload", visibility: "crate", generics: emptyRustGenerics,
        fields: [{ name: "inner", visibility: "public", type: { kind: "named", path: "crate::inner::Inner" } }] },
      { kind: "struct", name: "Entry", visibility: "crate", generics: emptyRustGenerics, fields: [] }] }],
    ["inner", { items: [trait("Inner", "crate")] }],
  ]);
  const closed = closeRustModuleTypeVisibility(models);
  const items = closed.get("values").items;
  assert.equal(items[0].visibility, "public");
  assert.equal(items[0].body.items[1].visibility, "public");
  assert.equal(items[1].visibility, "crate");
  assert.equal(items[1].body.items[1].visibility, "crate");
  assert.equal(items[2].visibility, "public");
  assert.equal(items[3].visibility, "crate");
  assert.equal(closed.get("inner").items[0].visibility, "public");
  assert.deepEqual(closeRustModuleTypeVisibility(closed), closed);
  assert.equal(models.get("values").items[0].visibility, "crate");
});
