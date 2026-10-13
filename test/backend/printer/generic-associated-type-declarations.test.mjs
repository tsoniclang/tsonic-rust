import assert from "node:assert/strict";
import test from "node:test";
import { emptyRustGenerics, createRustSourceFile } from "../../../dist/backend/target-ast/syntax/nodes.js";
import { printRustItem } from "../../../dist/print/source/items.js";
import { printRustType } from "../../../dist/print/source/types.js";
import { rustItemsReferenceModuleAlias } from "../../../dist/backend/target-ast/inspection/source-module-usage.js";
import { finalizeRustSourceStyle } from "../../../dist/backend/target-ast/normalization/source-style.js";
import { rustSourceFileContractCandidate } from "../../../dist/backend/planner/artifacts/source-file-contract.js";
import { rustLintAttributes } from "../../../dist/backend/target-ast/normalization/lint-policy.js";
import { closeRustModuleTypeVisibility } from "../../../dist/backend/target-ast/normalization/module-visibility.js";

const named = path => ({ kind: "named", path });
const lifetime = name => ({ kind: "named", name });
const inputLifetime = lifetime("input");
const generics = {
  parameters: [
    { kind: "lifetime", name: "input", outlives: [] },
    { kind: "type", name: "Value", bounds: [] },
    { kind: "const", name: "COUNT", type: { kind: "primitive", name: "usize" } },
  ],
  wherePredicates: [{ kind: "type", type: named("Value"), bounds: [{ kind: "lifetime", lifetime: inputLifetime }] }],
};
const declaration = { kind: "type", name: "Error", generics, bounds: [{ kind: "lifetime", lifetime: inputLifetime }] };
const definition = { kind: "type", name: "Error", generics,
  type: { kind: "reference", mutable: true, lifetime: inputLifetime,
    referent: { kind: "fixed-array", element: named("Value"), length: { kind: "path", path: "COUNT" } } } };
const family = { kind: "trait", name: "Callback", visibility: "public", generics: emptyRustGenerics, members: [declaration] };
const implementation = { kind: "impl", generics: emptyRustGenerics, target: named("Producer"),
  trait: named("Callback"), members: [definition] };

test("GAT declarations reuse native parameters and keep implementation where clauses after the value", () => {
  assert.equal(printRustItem(family), "pub trait Callback {\n    type Error<'input, Value, const COUNT: usize>: 'input\n    where\n        Value: 'input;\n}");
  assert.equal(printRustItem(implementation), "impl Callback for Producer {\n    type Error<'input, Value, const COUNT: usize> = &'input mut [Value; COUNT]\n    where\n        Value: 'input;\n}");
  assert.equal(printRustType({ kind: "qualified", owner: named("Producer"), trait: named("Callback"), member: "Error",
    genericArguments: [{ kind: "lifetime", lifetime: inputLifetime }, { kind: "type", type: named("Value") },
      { kind: "const", value: { kind: "integer", value: 3n } }] }), "<Producer as Callback>::Error<'input, Value, 3>");
});

test("GAT declarations cannot omit their canonical binder container or occur in inherent implementations", () => {
  const { generics: _traitGenerics, ...oldDeclaration } = declaration;
  const { generics: _implGenerics, ...oldDefinition } = definition;
  assert.throws(() => printRustItem({ ...family, members: [oldDeclaration] }), TypeError);
  assert.throws(() => printRustItem({ ...implementation, members: [oldDefinition] }), TypeError);
  assert.throws(() => printRustItem({ ...implementation, trait: undefined }),
    /Associated type definitions require an exact trait implementation/u);
});

test("associated generic bounds and predicates retain exact module dependencies", () => {
  const selected = { parameters: [{ kind: "type", name: "Value", bounds: [
    { kind: "trait-type", reference: { trait: named("input::Bound") } },
  ] }], wherePredicates: [{ kind: "type", type: named("Value"), bounds: [
    { kind: "trait-type", reference: { trait: named("output::Bound"),
      binder: [{ kind: "lifetime", name: "scope", outlives: [] }] } },
  ] }] };
  for (const item of [
    { ...family, members: [{ ...declaration, generics: selected }] },
    { ...implementation, members: [{ ...definition, generics: selected }] },
  ]) {
    for (const alias of ["input", "output"]) assert.equal(rustItemsReferenceModuleAlias([item], alias), true, alias);
    for (const alias of ["in", "out", "unrelated"]) assert.equal(rustItemsReferenceModuleAlias([item], alias), false, alias);
  }
});

test("GAT public signatures expose their bounds but not same-spelled method-local type parameters", () => {
  const selected = { parameters: [{ kind: "type", name: "Value", bounds: [{ kind: "trait", path: "InputBound" }] }],
    wherePredicates: [{ kind: "type", type: named("Value"), bounds: [{ kind: "trait", path: "OutputBound" }] }] };
  const hiddenTrait = name => ({ kind: "trait", name, visibility: "private", generics: emptyRustGenerics, members: [] });
  const hiddenValue = name => ({ kind: "struct", name, visibility: "private", generics: emptyRustGenerics, fields: [] });
  for (const item of [
    { ...family, members: [{ ...declaration, generics: selected, bounds: [] }] },
    { ...implementation, members: [{ ...definition, generics: selected, type: named("Value") }] },
  ]) {
    const normalized = finalizeRustSourceStyle(createRustSourceFile([
      ...(item.kind === "impl" ? [{ ...family, members: [] }] : []),
      hiddenTrait("InputBound"), hiddenTrait("OutputBound"),
      hiddenValue("Value"), hiddenValue("Unrelated"), item,
    ]));
    for (const name of ["InputBound", "OutputBound"]) {
      assert.equal(normalized.items.find(candidate => candidate.name === name).visibility, "public", name);
    }
    for (const name of ["Value", "Unrelated"]) {
      assert.equal(normalized.items.find(candidate => candidate.name === name).visibility, "private", name);
    }
  }
});

test("associated generic parameter naming remains local and never changes authored spelling", () => {
  const unusual = { parameters: [
    { kind: "lifetime", name: "InputScope", outlives: [] },
    { kind: "type", name: "valueType", bounds: [] },
    { kind: "const", name: "elementCount", type: { kind: "primitive", name: "usize" } },
  ], wherePredicates: [] };
  const model = createRustSourceFile([
    { ...family, members: [{ ...declaration, generics: unusual }] },
    { ...implementation, members: [{ ...definition, generics: unusual }] },
  ]);
  const normalized = finalizeRustSourceStyle(model);
  for (const item of normalized.items) {
    assert.deepEqual(item.members[0].generics, unusual);
    assert.deepEqual(item.members[0].attrs, [rustLintAttributes.nonSnakeCaseName,
      rustLintAttributes.nonCamelCaseType, rustLintAttributes.nonUpperCaseGlobal]);
    assert.equal(item.attrs === undefined, true);
    assert.match(printRustItem(item), /Error<'InputScope, valueType, const elementCount: usize>/u);
  }
  assert.deepEqual(finalizeRustSourceStyle(normalized), normalized);
});

test("associated binder and bound changes invalidate the exact public artifact surface", () => {
  const surface = item => rustSourceFileContractCandidate("family", createRustSourceFile([item]), [])
    .contract.facets.find(facet => facet.facet === "source-file-public-surface").value;
  for (const [item, member] of [[family, declaration], [implementation, definition]]) {
    const original = surface(item);
    for (const changed of [
      { ...generics, parameters: generics.parameters.slice(0, 2) },
      { ...generics, wherePredicates: [] },
      { ...generics, parameters: generics.parameters.map(parameter => parameter.kind === "type"
        ? { ...parameter, bounds: [{ kind: "trait", path: "Clone" }] } : parameter) },
    ]) assert.notEqual(surface({ ...item, members: [{ ...member, generics: changed }] }), original);
  }
});

test("associated generic constraints close cross-module visibility without promoting external lookalikes", () => {
  const bound = path => ({ ...declaration, generics: { parameters: [{ kind: "type", name: "Value", bounds: [] }],
    wherePredicates: [{ kind: "type", type: named("Value"), bounds: [{ kind: "trait", path }] }] }, bounds: [] });
  const hidden = name => ({ kind: "trait", name, visibility: "crate", generics: emptyRustGenerics, members: [] });
  const models = new Map([
    ["api", createRustSourceFile([{ ...family, members: [bound("crate::detail::Constraint"),
      { ...bound("external::detail::Namesake"), name: "ExternalError" }] }])],
    ["detail", createRustSourceFile([hidden("Constraint"), hidden("Namesake")])],
  ]);
  const closed = closeRustModuleTypeVisibility(models);
  assert.equal(closed.get("detail").items[0].visibility, "public");
  assert.equal(closed.get("detail").items[1].visibility, "crate");
  assert.equal(models.get("detail").items[0].visibility, "crate");
  assert.deepEqual(closeRustModuleTypeVisibility(closed), closed);
});
