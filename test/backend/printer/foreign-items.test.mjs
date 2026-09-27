import assert from "node:assert/strict";
import test from "node:test";
import { createRustSourceFile, emptyRustGenerics } from "../../../dist/backend/target-ast/nodes.js";
import { rustValueAttribute, rustWordAttribute } from "../../../dist/backend/target-ast/attributes.js";
import { printRustItem } from "../../../dist/print/source/items.js";
import { rustItemsReferenceModuleAlias } from "../../../dist/backend/target-ast/inspection/source-module-usage.js";
import { finalizeRustSourceStyle } from "../../../dist/backend/target-ast/normalization/source-style.js";
import { finalizeRustDeadCode } from "../../../dist/backend/target-ast/normalization/dead-code.js";
import { nameRustSignatureTypes } from "../../../dist/backend/target-ast/normalization/signature-aliases.js";
import { rustSourceFileContractCandidate } from "../../../dist/backend/planner/artifacts/source-file-contract.js";

const integer = { kind: "primitive", name: "u32" };
const named = path => ({ kind: "named", path });
const foreign = members => ({ kind: "extern-block", isUnsafe: true, abi: "C", members });
const declaration = (name, overrides = {}) => ({ kind: "function", name, visibility: "public",
  generics: emptyRustGenerics, params: [{ name: "value", type: integer }], returnType: integer, ...overrides });
const macro = (delimiter = "parentheses") => ({ kind: "macro-invocation", path: "native::members",
  input: { delimiter, tokens: [] } });
const surface = item => rustSourceFileContractCandidate("foreign", createRustSourceFile([item]), [])
  .contract.facets.find(facet => facet.facet === "source-file-public-surface").value;

test("extern blocks preserve ordered members, native ABI, safety and attributes", () => {
  const block = foreign([
    declaration("first", { safety: "safe" }),
    macro("braces"),
    { kind: "static", name: "VALUE", visibility: "crate", safety: "unsafe", mutable: true, type: integer },
    macro("brackets"),
    { kind: "type", name: "Opaque", visibility: "public" },
    declaration("last", { safety: "unsafe", variadic: true, attrs: [
      rustValueAttribute("link_name", { kind: "string", value: "native_last" }),
    ] }),
  ]);
  const item = { ...block, attrs: [rustWordAttribute("outer")], innerAttrs: [rustWordAttribute("inner")] };
  assert.equal(printRustItem(item), [
    "#[outer]", 'unsafe extern "C" {', "    #![inner]",
    "    pub safe fn first(value: u32) -> u32;", "    native::members!{}",
    "    pub(crate) unsafe static mut VALUE: u32;", "    native::members![];",
    "    pub type Opaque;", '    #[link_name = "native_last"]',
    "    pub unsafe fn last(value: u32, ...) -> u32;", "}",
  ].join("\n"));
  assert.equal(printRustItem({ ...foreign([]), abi: undefined, isUnsafe: false }), "extern {}");
  assert.equal(printRustItem({ ...foreign([]), abi: "Rust" }), 'unsafe extern "Rust" {}');
  for (const delimiter of ["parentheses", "brackets", "braces"]) {
    const invocation = macro(delimiter);
    const printed = printRustItem(invocation);
    assert.equal(printRustItem(foreign([invocation])), `unsafe extern "C" {\n    ${printed}\n}`);
  }
  assert.equal(printRustItem(foreign([declaration("empty", { params: [], returnType: undefined })])),
    'unsafe extern "C" {\n    pub fn empty();\n}');
});

test("foreign signatures retain lifetime binders without inventing a function body", () => {
  const lifetime = { kind: "named", name: "input" };
  const reference = { kind: "reference", lifetime, mutable: false, referent: integer };
  const member = declaration("borrow", { params: [{ name: "value", type: reference }], returnType: reference,
    generics: { parameters: [{ kind: "lifetime", name: "input", outlives: [] }], wherePredicates: [] } });
  assert.equal(printRustItem({ ...foreign([member]), abi: "Rust" }),
    'unsafe extern "Rust" {\n    pub fn borrow<\'input>(value: &\'input u32) -> &\'input u32;\n}');
});

test("foreign dependencies include member types, exact tokens and both attribute placements", () => {
  const item = { ...foreign([
    declaration("first", { attrs: [rustWordAttribute("member::attribute")],
      params: [{ name: "value", type: named("argument::Value") }], returnType: named("result::Value"),
      generics: { parameters: [{ kind: "type", name: "Type", bounds: [{ kind: "trait", path: "bound::Trait" }] }],
        wherePredicates: [] } }),
    { kind: "static", name: "VALUE", visibility: "public", mutable: false, type: named("storage::Value") },
    { kind: "type", name: "Opaque", visibility: "public", attrs: [rustWordAttribute("opaque::attribute")] },
    { ...macro(), input: { delimiter: "braces", tokens: [
      { kind: "fragment", fragment: { kind: "type", type: named("splice::Value") } },
    ] } },
  ]), attrs: [rustWordAttribute("outer::attribute")], innerAttrs: [rustWordAttribute("inner::attribute")] };
  for (const alias of ["member", "argument", "result", "bound", "storage", "opaque", "native", "splice", "outer", "inner"]) {
    assert.equal(rustItemsReferenceModuleAlias([item], alias), true, alias);
  }
  assert.equal(rustItemsReferenceModuleAlias([item], "unrelated"), false);
});

test("foreign declaration normalization preserves authored names and ordered macro members", () => {
  const item = foreign([
    declaration("foreignName", { params: [{ name: "inputValue", type: integer }] }),
    macro(),
    { kind: "static", name: "nativeValue", visibility: "public", mutable: false, type: integer },
    { kind: "type", name: "native_type", visibility: "public" },
  ]);
  const result = finalizeRustSourceStyle(createRustSourceFile([item]));
  assert.deepEqual(result.items[0].members.map(member => member.name ?? member.path),
    ["foreignName", "native::members", "nativeValue", "native_type"]);
  assert.deepEqual(result.items[0].members[1], item.members[1]);
  const printed = printRustItem(result.items[0]);
  for (const lint of ["non_snake_case", "non_upper_case_globals", "non_camel_case_types"]) {
    assert.ok(printed.includes(lint), lint);
  }
  assert.deepEqual(finalizeRustSourceStyle(result), result);
  const dead = finalizeRustDeadCode(createRustSourceFile([foreign([
    declaration("unused", { visibility: "private", deadCode: "authored-declaration" }), macro(),
  ])]));
  assert.equal("deadCode" in dead.items[0].members[0], false);
  assert.match(printRustItem(dead.items[0]), /allow\(dead_code/u);
  assert.deepEqual(dead.items[0].members[1], macro());
});

test("foreign public signatures expose required local types, including foreign types", () => {
  const value = { kind: "struct", name: "Value", visibility: "private", generics: emptyRustGenerics, fields: [] };
  const pointer = { kind: "raw-pointer", mutable: false, pointee: named("Opaque") };
  const item = foreign([
    { kind: "type", name: "Opaque", visibility: "private" },
    declaration("use_value", { params: [{ name: "value", type: named("Value") }], returnType: pointer }),
  ]);
  const result = finalizeRustSourceStyle(createRustSourceFile([value, item]));
  assert.equal(result.items[0].visibility, "public");
  assert.equal(result.items[1].members[0].visibility, "public");
  const privateOnly = finalizeRustSourceStyle(createRustSourceFile([value, foreign([
    { ...item.members[1], visibility: "private" }, item.members[0],
  ])]));
  assert.equal(privateOnly.items[0].visibility, "private");
  assert.equal(privateOnly.items[1].members[1].visibility, "private");
});

test("foreign signatures and macro placement invalidate artifact contracts", () => {
  const member = declaration("read");
  const initial = foreign([member, macro()]);
  for (const changed of [
    { ...initial, abi: "Rust" }, { ...initial, isUnsafe: false },
    { ...initial, attrs: [rustWordAttribute("outer")] },
    { ...initial, innerAttrs: [rustWordAttribute("inner")] },
    foreign([macro(), member]), foreign([member, macro("braces")]),
    foreign([{ ...member, safety: "safe" }, macro()]),
    foreign([{ ...member, variadic: true }, macro()]),
    foreign([{ ...member, returnType: { kind: "primitive", name: "u64" } }, macro()]),
  ]) assert.notEqual(surface(initial), surface(changed));
  assert.equal(surface(foreign([{ ...member, visibility: "private" }])), surface(foreign([])));
  const constant = { kind: "static", name: "VALUE", visibility: "public", mutable: false, type: integer };
  assert.notEqual(surface(foreign([constant])), surface(foreign([{ ...constant, mutable: true }])));
});

test("signature alias names never shadow foreign declarations in the surrounding scope", () => {
  let large = integer;
  for (let index = 0; index < 8; index += 1) large = { kind: "named", path: "Container",
    genericArguments: [{ kind: "type", type: large }] };
  const callable = { ...declaration("read", { returnType: large }), body: { statements: [] } };
  const first = nameRustSignatureTypes([callable]);
  assert.equal(first.aliases.length, 1);
  const reserved = first.aliases[0].name;
  for (const member of [declaration(reserved),
    { kind: "type", name: reserved, visibility: "public" },
    { kind: "static", name: reserved, visibility: "public", mutable: false, type: integer },
  ]) {
    const result = nameRustSignatureTypes([foreign([member]), callable]);
    assert.notEqual(result.aliases[0].name, reserved);
    assert.deepEqual(result.items[0].members, [member]);
  }
});
