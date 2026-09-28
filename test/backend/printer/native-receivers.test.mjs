import assert from "node:assert/strict";
import test from "node:test";
import { createRustSourceFile, emptyRustGenerics } from "../../../dist/backend/target-ast/nodes.js";
import { printRustItem } from "../../../dist/print/source/items.js";
import { rustSelfParameterEquals } from "../../../dist/backend/target-ast/inspection/type-equality.js";
import { rustItemsReferenceModuleAlias } from "../../../dist/backend/target-ast/inspection/source-module-usage.js";
import { finalizeRustSourceStyle } from "../../../dist/backend/target-ast/normalization/source-style.js";
import { rustSourceFileContractCandidate } from "../../../dist/backend/planner/artifacts/source-file-contract.js";
import { rustSelfParameter } from "../../../dist/backend/planner/declarations/callables/self-parameter.js";
import { planProjectFieldAccessorCall } from "../../../dist/backend/planner/objects/polymorphism/forwarders.js";

const named = path => ({ kind: "named", path });
const applied = (path, type) => ({ kind: "named", path, genericArguments: [{ kind: "type", type }] });
const integer = { kind: "primitive", name: "u32" };
const method = selfParam => ({ kind: "function", name: "value", visibility: "public", selfParam,
  generics: emptyRustGenerics, params: [], returnType: integer,
  body: { statements: [{ kind: "tail", expr: { kind: "int-literal", text: "7" } }] } });
const implementation = selfParam => ({ kind: "impl", target: named("Counter"),
  generics: emptyRustGenerics, members: [method(selfParam)] });
const family = selfParam => ({ kind: "trait", name: "Value", visibility: "public",
  generics: emptyRustGenerics, members: [{ ...method(selfParam), body: undefined }] });

test("native receiver syntax carries arbitrary exact types without a wrapper-name branch", () => {
  const receiver = { kind: "typed", type: applied("custom::Owner", named("Self")) };
  assert.match(printRustItem(implementation(receiver)), /pub fn value\(self: custom::Owner<Self>\) -> u32/u);
  assert.match(printRustItem(family(receiver)), /fn value\(self: custom::Owner<Self>\) -> u32;/u);
  assert.doesNotMatch(printRustItem(implementation(receiver)), /alloc::rc::Rc/u);
  assert.throws(() => printRustItem(implementation({ kind: "rc" })));
});

test("receiver binding mutability is independent of borrowing and nested lifetimes", () => {
  const receiver = { kind: "typed", mutable: true, type: applied("core::pin::Pin", {
    kind: "reference", mutable: true, lifetime: { kind: "named", name: "owner" }, referent: named("Self"),
  }) };
  assert.match(printRustItem(implementation(receiver)), /mut self: core::pin::Pin<&'owner mut Self>/u);
  assert.match(printRustItem(implementation({ kind: "value", mutable: true })), /fn value\(mut self\)/u);
  assert.match(printRustItem(implementation({ kind: "reference", mutable: true,
    lifetime: { kind: "named", name: "owner" } })), /fn value\(&'owner mut self\)/u);
});

test("receiver identity distinguishes type, mutability, reference and lifetime contracts", () => {
  const receiver = { kind: "typed", type: applied("Owner", named("Self")) };
  assert.equal(rustSelfParameterEquals(receiver, structuredClone(receiver)), true);
  assert.equal(rustSelfParameterEquals(receiver, { ...receiver, mutable: false }), true);
  assert.equal(rustSelfParameterEquals(receiver, { ...receiver, mutable: true }), false);
  assert.equal(rustSelfParameterEquals(receiver, { ...receiver, type: applied("Other", named("Self")) }), false);
  assert.equal(rustSelfParameterEquals(receiver, { kind: "value" }), false);
  assert.equal(rustSelfParameterEquals(undefined, receiver), false);
  const reference = { kind: "reference", mutable: false, lifetime: { kind: "named", name: "first" } };
  assert.equal(rustSelfParameterEquals(reference, { ...reference, lifetime: { kind: "named", name: "second" } }), false);
  const surface = value => rustSourceFileContractCandidate("receivers", createRustSourceFile([implementation(value)]), [])
    .contract.facets.find(facet => facet.facet === "source-file-public-surface").value;
  assert.notEqual(surface(receiver), surface({ ...receiver, mutable: true }));
  assert.notEqual(surface(receiver), surface({ ...receiver, type: applied("Other", named("Self")) }));
});

test("receiver-only dependencies and public type visibility survive normalization", () => {
  const receiver = { kind: "typed", type: applied("owner::Handle", named("Payload")) };
  for (const item of [implementation(receiver), family(receiver)]) {
    assert.equal(rustItemsReferenceModuleAlias([item], "owner"), true);
    assert.equal(rustItemsReferenceModuleAlias([item], "unrelated"), false);
    const model = finalizeRustSourceStyle(createRustSourceFile([
      { kind: "struct", name: "Counter", visibility: "public", generics: emptyRustGenerics, fields: [] },
      { kind: "struct", name: "Payload", visibility: "private", generics: emptyRustGenerics, fields: [] },
      item,
    ]));
    assert.equal(model.items.find(candidate => candidate.name === "Payload").visibility, "public");
    assert.deepEqual(model.items.find(candidate => candidate.kind === item.kind).members[0].selfParam, receiver);
  }
});

test("existing generated object receivers keep their native type and exact forwarder validation", () => {
  const receiver = rustSelfParameter("rc");
  assert.match(printRustItem(implementation(receiver)), /self: alloc::rc::Rc<Self>/u);
  assert.ok(planProjectFieldAccessorCall(named("Counter"), method(receiver), undefined, integer));
  assert.equal(planProjectFieldAccessorCall(named("Counter"), method({ ...receiver, mutable: true }), undefined, integer), undefined);
  assert.equal(planProjectFieldAccessorCall(named("Counter"), method({ kind: "typed",
    type: applied("unrelated::Rc", named("Self")) }), undefined, integer), undefined);
});

test("a type parameter used only in a receiver is not marked erased", () => {
  const item = implementation({ kind: "typed", type: applied("Owner", named("Value")) });
  item.members[0].generics = { parameters: [{ kind: "type", name: "Value", bounds: [] }], wherePredicates: [] };
  const normalized = finalizeRustSourceStyle(createRustSourceFile([item]));
  assert.doesNotMatch(printRustItem(normalized.items[0]), /extra_unused_type_parameters/u);
});
