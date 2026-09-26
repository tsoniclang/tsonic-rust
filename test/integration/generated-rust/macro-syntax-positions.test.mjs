import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestWorkspace } from "../../../../tsonic/test/scripts/test-workspaces.mjs";
import { emptyRustGenerics } from "../../../dist/backend/target-ast/nodes.js";
import { printRustItem } from "../../../dist/print/source/items.js";
import { runRustNativeCommand } from "../../../dist/providers/native/protocol/bounded-command.js";

function invocation(path, delimiter = "parentheses", fragments = []) {
  return { kind: "macro-invocation", path, input: {
    delimiter, tokens: fragments.map(fragment => ({ kind: "fragment", fragment })),
  } };
}

function method(name, statements, returnType = { kind: "primitive", name: "u32" }) {
  return { kind: "function", name, visibility: "public", generics: emptyRustGenerics,
    params: [], returnType, body: { statements } };
}

function nativeProgram(name, items, definitions, consumer) {
  const root = createTestWorkspace(`rust-macro-positions-${name}`);
  const path = join(root, "program.rs");
  const binary = join(root, process.platform === "win32" ? "program.exe" : "program");
  writeFileSync(path, `${definitions}\n${items.map(printRustItem).join("\n")}\n${consumer}\n`);
  runRustNativeCommand({ executable: process.env.RUSTC ?? "rustc",
    arguments: ["--edition=2024", "-Dwarnings", path, "-o", binary], directory: root,
    environment: process.env, timeoutMilliseconds: 60_000, maximumDiagnosticBytes: 1024 * 1024 });
  return runRustNativeCommand({ executable: binary, arguments: [], directory: root,
    environment: process.env, timeoutMilliseconds: 10_000, maximumDiagnosticBytes: 1024 * 1024 });
}

test("canonical macro AST compiles in type, pattern, module and local-item positions", () => {
  const element = { kind: "primitive", name: "u32" };
  const generated = invocation("record", "braces");
  const type = invocation("pair", "parentheses", [{ kind: "type", type: element }]);
  const pattern = invocation("present", "parentheses", [
    { kind: "pattern", pattern: { kind: "binding", name: "found" } },
  ]);
  const items = [
    generated,
    { kind: "type-alias", name: "Pair", visibility: "public", generics: emptyRustGenerics, target: type },
    { ...method("read", [{ kind: "tail", expr: { kind: "match",
      expression: { kind: "path", path: "input" }, arms: [
        { pattern, expression: { kind: "path", path: "found" } },
        { pattern: { kind: "path", path: "None" }, expression: { kind: "int-literal", text: "0" } },
      ] } }]), params: [{ name: "input", type: { kind: "named", path: "Option",
        genericArguments: [{ kind: "type", type: element }] } }] },
    method("local", [
      { kind: "item", item: invocation("local_item", "brackets") },
      { kind: "tail", expr: { kind: "call", path: "inside", args: [] } },
    ]),
    { kind: "mod-decl", name: "nested", visibility: "public", body: {
      headerComment: "fixture", items: [invocation("record", "braces")],
    } },
  ];
  assert.equal(nativeProgram("positions", items, `
macro_rules! record { () => { pub struct Generated { pub value: u32 } }; }
macro_rules! pair { ($element:ty) => { ($element, bool) }; }
macro_rules! present { ($binding:ident) => { Some($binding) }; }
macro_rules! local_item { () => { fn inside() -> u32 { 7 } }; }
`, `fn main() {
    let pair: Pair = (4, true);
    let first = Generated { value: pair.0 };
    let second = nested::Generated { value: first.value };
    assert_eq!(read(Some(second.value)), 4);
    assert_eq!(read(None), 0);
    assert_eq!(local(), 7);
}`), "");
});

test("trait and implementation macro members retain native associated-item ordering", () => {
  const trait = { kind: "trait", name: "Values", visibility: "public", generics: emptyRustGenerics,
    members: [
      { kind: "type", name: "First", bounds: [] },
      invocation("contract"),
      { ...method("last", []), body: undefined },
    ] };
  const implementation = { kind: "impl", generics: emptyRustGenerics,
    trait: { kind: "named", path: "Values" }, target: { kind: "named", path: "Record" }, members: [
      { kind: "type", name: "First", type: { kind: "primitive", name: "u32" } },
      invocation("implementation", "braces"),
      method("last", [{ kind: "tail", expr: { kind: "int-literal", text: "3" } }]),
    ] };
  assert.equal(nativeProgram("members", [trait, implementation], `
pub struct Record;
macro_rules! contract { () => { fn middle() -> u32; }; }
macro_rules! implementation { () => { fn middle() -> u32 { 2 } }; }
`, "fn main() { assert_eq!(Record::middle() + Record::last(), 5); }"), "");
});

test("statement semicolons retain native tail-value and discard behavior", () => {
  const value = invocation("number", "braces");
  const retained = method("retained", [{ kind: "macro-statement", invocation: value, semicolon: false }]);
  const discarded = method("discarded", [{ kind: "macro-statement", invocation: value, semicolon: true }],
    { kind: "unit" });
  const definitions = "macro_rules! number { () => { 7_u32 }; }";
  assert.equal(nativeProgram("semicolon", [retained, discarded], definitions,
    "fn main() { assert_eq!(retained(), 7); assert_eq!(discarded(), ()); }"), "");
  assert.throws(() => nativeProgram("wrong_semicolon", [
    { ...retained, body: { statements: [{ kind: "macro-statement", invocation: value, semicolon: true }] } },
  ], definitions, "fn main() {}"), /mismatched types|expected `u32`/u);
});

test("invalid native macro positions and expansion types remain native errors", () => {
  const items = [{ kind: "type-alias", name: "Wrong", visibility: "public", generics: emptyRustGenerics,
    target: invocation("expression") }];
  assert.throws(() => nativeProgram("invalid_type", items,
    "macro_rules! expression { () => { 7_u32 }; }", "fn main() {}"), /expected type/u);
  assert.throws(() => nativeProgram("invalid_result", [method("wrong", [
    { kind: "tail", expr: invocation("text") },
  ])], 'macro_rules! text { () => { "not a number" }; }', "fn main() {}"), /mismatched types/u);
});
