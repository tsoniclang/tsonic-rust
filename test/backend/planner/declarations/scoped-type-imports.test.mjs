import assert from "node:assert/strict";
import test from "node:test";
import { emptyRustGenerics } from "../../../../dist/backend/target-ast/syntax/nodes.js";
import { completeRustAuthoredStructScopes } from "../../../../dist/backend/planner/program/authored-type-scopes.js";
import { resolvedTargetStage, runTargetCompilationStages } from "@tsonic/target-api/artifacts";

test("hoisted authored type scopes import only selected enclosing bindings", () => {
  const declaration = { kind: "struct", name: "Entry", visibility: "crate", generics: {
    parameters: [{ kind: "type", name: "Payload", bounds: [] }], wherePredicates: [],
  }, fields: [
    { name: "value", visibility: "parent", type: { kind: "named", path: "Payload" } },
    { name: "handle", visibility: "private", type: { kind: "named", path: "rt::Handle" } },
    { name: "bytes", visibility: "private", type: { kind: "fixed-array", element: { kind: "primitive", name: "u8" },
      length: { kind: "path", path: "COUNT" } } },
  ] };
  const scope = { kind: "mod-decl", name: "entry_scope", visibility: "crate", body: { items: [declaration] } };
  const items = [
    { kind: "use", path: "native_runtime", alias: "rt" },
    { kind: "struct", name: "Payload", visibility: "crate", generics: emptyRustGenerics, fields: [] },
    { kind: "const", name: "COUNT", visibility: "crate", type: { kind: "primitive", name: "usize" }, value: { kind: "int-literal", text: "4" } },
    { kind: "use", path: "unused_runtime", alias: "unused" }, scope,
  ];
  const completed = completeRustAuthoredStructScopes(items, new Set(["entry_scope"]));
  assert.deepEqual(completed.at(-1).body.items, [
    { kind: "use", path: "super::rt" }, { kind: "use", path: "super::COUNT" }, declaration,
  ]);
  assert.deepEqual(scope.body.items, [declaration]);
  assert.equal(completeRustAuthoredStructScopes(items, new Set()), items);
});

test("primitive-only local classes need no enclosing scope imports", () => {
  const declaration = { kind: "struct", name: "Entry", visibility: "crate", generics: emptyRustGenerics,
    fields: [{ name: "value", visibility: "parent", type: { kind: "primitive", name: "i32" } }] };
  const items = [{ kind: "mod-decl", name: "entry_scope", visibility: "crate", body: { items: [declaration] } }];
  assert.deepEqual(completeRustAuthoredStructScopes(items, new Set(["entry_scope"])), items);
});

const malformedScopeMessage = "Authored type scope must contain its one planned struct declaration.";

function planAuthoredScopes(items) {
  return runTargetCompilationStages({
    analyze: () => resolvedTargetStage({}),
    plan: () => resolvedTargetStage(completeRustAuthoredStructScopes(items, new Set(["entry_scope"]))),
    materialize: () => ({ artifacts: [] }),
  });
}

const scopedStruct = { kind: "struct", name: "Entry", visibility: "crate", generics: emptyRustGenerics,
  fields: [{ name: "value", visibility: "parent", type: { kind: "primitive", name: "i32" } }] };
const otherStruct = { kind: "struct", name: "Other", visibility: "crate", generics: emptyRustGenerics, fields: [] };
const otherEnum = { kind: "enum", name: "Other", visibility: "crate", generics: emptyRustGenerics, variants: [] };

for (const [name, body] of [
  ["has no body", undefined],
  ["contains no declaration", { items: [] }],
  ["contains a non-struct declaration", { items: [otherEnum] }],
  ["contains a second declaration", { items: [scopedStruct, otherStruct] }],
  ["contains an import before its declaration", { items: [{ kind: "use", path: "super::rt" }, scopedStruct] }],
]) {
  test(`a generated authored type scope that ${name} fails through the shared planning invariant`, () => {
    const scope = { kind: "mod-decl", name: "entry_scope", visibility: "crate", ...(body === undefined ? {} : { body }) };
    const compiled = planAuthoredScopes([scopedStruct, scope]);
    assert.equal(compiled !== undefined, true, "the malformed scope is classified by the shared planning boundary");
    assert.equal(compiled.kind, "rejected");
    assert.equal(Object.hasOwn(compiled, "value"), false);
    assert.equal(compiled.diagnostics.length, 1);
    const diagnostic = compiled.diagnostics[0];
    assert.equal(diagnostic.code, "TSONIC_INTERNAL_PLANNER_INVARIANT");
    assert.equal(diagnostic.category, "error");
    assert.equal(diagnostic.source, "tsonic-rust");
    assert.equal(diagnostic.message, malformedScopeMessage);
    assert.equal(diagnostic.sourceNode === undefined, true, "generated item structure has no source node");
    assert.equal(Object.isFrozen(diagnostic), true);
  });
}

test("an authored type scope outside the selected scopes is returned unchanged even when it is not a planned struct scope", () => {
  const unselected = { kind: "mod-decl", name: "other_scope", visibility: "crate", body: { items: [otherEnum, otherStruct] } };
  const scope = { kind: "mod-decl", name: "entry_scope", visibility: "crate", body: { items: [scopedStruct] } };
  const completed = completeRustAuthoredStructScopes([unselected, scope], new Set(["entry_scope"]));
  assert.equal(completed[0] === unselected, true, "an unselected module is not a generated authored type scope");
  assert.equal(completed[1].body.items.length === 1 && completed[1].body.items[0] === scopedStruct, true,
    "the selected scope keeps its one declaration");
});
