import assert from "node:assert/strict";
import test from "node:test";
import { createRustSourceFile, emptyRustGenerics } from "../../../dist/backend/target-ast/nodes.js";
import { printRustItem } from "../../../dist/print/source/items.js";
import { printRustType } from "../../../dist/print/source/types.js";
import { printRustPattern } from "../../../dist/print/source/patterns.js";
import { printRustBlockStatements } from "../../../dist/print/source/blocks.js";
import { rustItemsReferenceModuleAlias } from "../../../dist/backend/target-ast/inspection/source-module-usage.js";
import { finalizeRustSourceStyle } from "../../../dist/backend/target-ast/normalization/source-style.js";
import { rustSourceFileContractCandidate } from "../../../dist/backend/planner/artifacts/source-file-contract.js";

function invocation(path, delimiter = "parentheses", fragments = []) {
  return { kind: "macro-invocation", path, input: {
    delimiter, tokens: fragments.map(fragment => ({ kind: "fragment", fragment })),
  } };
}

function method(name) {
  return { kind: "function", name, visibility: "public", generics: emptyRustGenerics,
    params: [], returnType: { kind: "primitive", name: "u32" },
    body: { statements: [{ kind: "tail", expr: { kind: "int-literal", text: "7" } }] } };
}

test("macro positions share the same input model without losing native delimiters", () => {
  for (const [delimiter, tokens, itemEnd] of [
    ["parentheses", "()", ";"], ["brackets", "[]", ";"], ["braces", "{}", ""],
  ]) {
    const macro = invocation("source::chosen", delimiter);
    assert.equal(printRustType(macro), `source::chosen!${tokens}`);
    assert.equal(printRustPattern(macro), `source::chosen!${tokens}`);
    assert.equal(printRustItem(macro), `source::chosen!${tokens}${itemEnd}`);
    for (const semicolon of [true, false]) {
      assert.equal(printRustBlockStatements({ statements: [
        { kind: "macro-statement", invocation: macro, semicolon },
      ] }, 1), `    source::chosen!${tokens}${semicolon ? ";" : ""}`);
    }
  }
});

test("ordered native members retain macros between types, constants and functions", () => {
  const trait = { kind: "trait", name: "Readable", visibility: "public", generics: emptyRustGenerics,
    members: [
      { kind: "type", name: "First", bounds: [] },
      invocation("members::first", "braces"),
      { ...method("read"), body: undefined },
      invocation("members::last"),
      { kind: "type", name: "Last", bounds: [] },
    ] };
  const implementation = { kind: "impl", generics: emptyRustGenerics,
    trait: { kind: "named", path: "Readable" }, target: { kind: "named", path: "Record" },
    members: [
      invocation("members::first", "braces"),
      { kind: "type", name: "First", type: { kind: "primitive", name: "u32" } },
      method("read"),
      invocation("members::last"),
      { kind: "const", name: "LIMIT", visibility: "private", type: { kind: "primitive", name: "u32" },
        value: { kind: "int-literal", text: "9" } },
    ] };
  assert.match(printRustItem(trait), /type First;[\s\S]*members::first!\{\}[\s\S]*fn read\(\)[\s\S]*members::last!\(\);[\s\S]*type Last;/u);
  assert.match(printRustItem(implementation), /members::first!\{\}[\s\S]*type First = u32;[\s\S]*fn read\(\)[\s\S]*members::last!\(\);[\s\S]*const LIMIT: u32 = 9;/u);
  const normalized = finalizeRustSourceStyle(createRustSourceFile([trait, implementation]));
  for (const [index, original] of [trait, implementation].entries()) {
    assert.deepEqual(normalized.items[index].members.map(member => member.kind), original.members.map(member => member.kind));
    assert.deepEqual(normalized.items[index].members.filter(member => member.kind === "macro-invocation"),
      original.members.filter(member => member.kind === "macro-invocation"));
  }
});

test("local items and nested modules use the canonical item printer", () => {
  const local = invocation("make_item", "braces");
  const module = { kind: "mod-decl", name: "nested", visibility: "public",
    body: createRustSourceFile([local]) };
  assert.match(printRustItem(module), /pub mod nested \{[\s\S]*make_item!\{\}/u);
  assert.equal(printRustBlockStatements({ statements: [{ kind: "item", item: local }] }, 2),
    "        make_item!{}");
});

test("typed macro fragments retain exact module dependencies in every new syntax position", () => {
  const fragments = [
    { kind: "type", type: { kind: "named", path: "types::Value" } },
    { kind: "pattern", pattern: { kind: "path", path: "patterns::Empty" } },
    { kind: "items", items: [{ kind: "type-alias", name: "Value", visibility: "private",
      generics: emptyRustGenerics, target: { kind: "named", path: "items::Value" } }] },
    { kind: "const", value: { kind: "path", path: "constants::COUNT" } },
  ];
  const macro = invocation("macros::inspect", "parentheses", fragments);
  const uses = [
    macro,
    { kind: "type-alias", name: "Selected", visibility: "public", generics: emptyRustGenerics, target: macro },
    { kind: "trait", name: "Contract", visibility: "public", generics: emptyRustGenerics, members: [macro] },
    { kind: "impl", target: { kind: "named", path: "Record" }, generics: emptyRustGenerics, members: [macro] },
    { ...method("body"), body: { statements: [{ kind: "macro-statement", invocation: macro, semicolon: true }] } },
    { ...method("local"), body: { statements: [{ kind: "item", item: macro }] } },
    { ...method("pattern"), body: { statements: [{ kind: "tail", expr: { kind: "match",
      expression: { kind: "path", path: "value" }, arms: [{ pattern: macro,
        expression: { kind: "int-literal", text: "0" } }] } }] } },
  ];
  for (const item of uses) {
    for (const alias of ["macros", "types", "patterns", "items", "constants"]) {
      assert.equal(rustItemsReferenceModuleAlias([item], alias), true, `${item.kind}: ${alias}`);
    }
    assert.equal(rustItemsReferenceModuleAlias([item], "unrelated"), false);
  }
});

test("macro tokens and associated-member order invalidate public artifact contracts", () => {
  const surface = item => rustSourceFileContractCandidate("fixture", createRustSourceFile([item]), [])
    .contract.facets.find(facet => facet.facet === "source-file-public-surface").value;
  const first = invocation("first");
  const second = invocation("second");
  assert.notEqual(surface(first), surface(second));
  assert.notEqual(surface(first), surface({ ...first, input: { delimiter: "braces", tokens: [] } }));
  const implementation = { kind: "impl", generics: emptyRustGenerics,
    trait: { kind: "named", path: "Contract" }, target: { kind: "named", path: "Record" },
    members: [first, second] };
  assert.notEqual(surface(implementation), surface({ ...implementation, members: [second, first] }));
  const constant = { kind: "const", name: "SIZE", visibility: "public",
    type: { kind: "primitive", name: "u32" }, value: { kind: "int-literal", text: "1" } };
  const inherent = { ...implementation, trait: undefined, members: [constant] };
  assert.notEqual(surface(inherent), surface({ ...inherent,
    members: [{ ...constant, value: { kind: "int-literal", text: "2" } }] }));
});
