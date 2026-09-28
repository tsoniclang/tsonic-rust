import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestWorkspace } from "../../../../tsonic/test/scripts/test-workspaces.mjs";
import { repositoryRoot } from "../../helpers/rust-session/paths.mjs";
import { emptyRustGenerics } from "../../../dist/backend/target-ast/nodes.js";
import { printRustItem } from "../../../dist/print/source/items.js";
import { rustValueAttribute } from "../../../dist/backend/target-ast/attributes.js";
import { finalizeRustSourceStyle } from "../../../dist/backend/target-ast/normalization/source-style.js";
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
  const root = createTestWorkspace(join(repositoryRoot, ".temp/generated"), `rust-macro-positions-${name}-`);
  const path = join(root, "program.rs");
  const binary = join(root, process.platform === "win32" ? "program.exe" : "program");
  writeFileSync(path, `${definitions}\n${items.map(printRustItem).join("\n")}\n${consumer}\n`);
  runRustNativeCommand({ executable: process.env.RUSTC ?? "rustc",
    arguments: ["--edition=2024", "-Dwarnings", path, "-o", binary], directory: root,
    environment: process.env, timeoutMilliseconds: 60_000, maximumDiagnosticBytes: 1024 * 1024 });
  return runRustNativeCommand({ executable: binary, arguments: [], directory: root,
    environment: process.env, timeoutMilliseconds: 10_000, maximumDiagnosticBytes: 1024 * 1024 });
}

test("canonical native receivers preserve alias, pinning and mutable ownership syntax", () => {
  const named = path => ({ kind: "named", path });
  const apply = (path, type) => ({ kind: "named", path, genericArguments: [{ kind: "type", type }] });
  const receiver = type => ({ kind: "typed", type });
  const field = owner => ({ kind: "field", receiver: { kind: "path", path: owner }, name: "value" });
  const read = selfParam => ({ ...method("read", [{ kind: "tail", expr: field("self") }]), selfParam });
  const pin = apply("core::pin::Pin", { kind: "reference", mutable: true, referent: named("Self") });
  const items = [
    { kind: "trait", name: "Read", visibility: "public", generics: emptyRustGenerics,
      members: [{ ...read(receiver(apply("Box", named("Self")))), body: undefined }] },
    { kind: "impl", trait: named("Read"), target: named("Counter"), generics: emptyRustGenerics,
      members: [read(receiver(apply("Box", named("Self"))))] },
    { kind: "impl", target: named("Counter"), generics: emptyRustGenerics, members: [
      { ...read(receiver(apply("Receiver", named("Self")))), name: "through_alias" },
      { ...method("consume", [{ kind: "assign", target: field("self"), operator: "+=", value: { kind: "int-literal", text: "1" } },
        { kind: "tail", expr: field("self") }]), selfParam: { kind: "value", mutable: true } },
      { ...method("advance", [
        { kind: "let", pattern: { kind: "binding", name: "value" }, init: {
          kind: "method-call", receiver: { kind: "path", path: "self" }, method: "get_mut", args: [],
        } },
        { kind: "assign", target: field("value"), operator: "+=", value: { kind: "int-literal", text: "1" } },
        { kind: "tail", expr: field("value") },
      ]), selfParam: receiver(pin) },
    ] },
  ];
  assert.equal(nativeProgram("typed-receivers", items,
    "pub struct Counter { pub value: u32 }\npub type Receiver<Value> = Box<Value>;", `fn main() {
      assert_eq!(Read::read(Box::new(Counter { value: 3 })), 3);
      assert_eq!(Box::new(Counter { value: 4 }).through_alias(), 4);
      assert_eq!(Counter { value: 5 }.consume(), 6);
      let mut counter = Counter { value: 7 };
      assert_eq!(core::pin::Pin::new(&mut counter).advance(), 8);
      assert_eq!(counter.value, 8);
    }`), "");
});

test("native receiver acceptance belongs to rustc, not the syntax printer", () => {
  const item = { kind: "impl", target: { kind: "named", path: "Counter" }, generics: emptyRustGenerics,
    members: [{ ...method("invalid", [{ kind: "tail", expr: { kind: "int-literal", text: "1" } }]),
      selfParam: { kind: "typed", type: { kind: "primitive", name: "u32" } } }] };
  assert.match(printRustItem(item), /self: u32/u);
  assert.throws(() => nativeProgram("invalid-receiver", [item], "pub struct Counter;", "fn main() {}"),
    /invalid `self` parameter type/u);
});

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
      ] } }]), params: [{ pattern: { kind: "binding", name: "input" }, type: { kind: "named", path: "Option",
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

test("native macro patterns occupy real function and closure parameters", () => {
  const integer = { kind: "primitive", name: "u32" };
  const binding = name => ({ kind: "binding", name });
  const path = name => ({ kind: "path", path: name });
  const pair = { kind: "tuple", elements: [binding("left"), binding("right")] };
  const parameter = invocation("pattern", "brackets", [{ kind: "pattern", pattern: pair }]);
  const sum = { kind: "binary", operator: "+", left: path("left"), right: path("right") };
  const tuple = { kind: "tuple", elements: [integer, integer] };
  const direct = { ...method("combine", [{ kind: "tail", expr: sum }]), params: [{ pattern: parameter, type: tuple }] };
  const closure = { kind: "closure", params: [{ pattern: parameter, type: tuple }], body: sum };
  const invoke = { ...method("via_closure", [{ kind: "tail", expr: { kind: "invoke", callee: closure, args: [path("values")] } }]),
    params: [{ pattern: binding("values"), type: tuple }] };
  assert.equal(nativeProgram("parameters", [direct, invoke], "macro_rules! pattern { ($value:pat) => { $value }; }",
    "fn main() { assert_eq!(combine((3, 4)), 7); assert_eq!(via_closure((5, 6)), 11); }"), "");
});

test("native macro patterns preserve all statement positions and let-else completion", () => {
  const binding = (name, mutable = false) => ({ kind: "binding", name, mutable });
  const path = name => ({ kind: "path", path: name });
  const integer = text => ({ kind: "int-literal", text });
  const selected = pattern => invocation("selected", "parentheses", [{ kind: "pattern", pattern }]);
  const tuple = elements => ({ kind: "tuple", elements });
  const present = name => ({ kind: "tuple-variant", path: "Some", elements: [binding(name)] });
  const add = name => ({ kind: "assign", target: path("total"), operator: "+=", value: path(name) });
  const item = { ...method("all_positions", [
    { kind: "let", pattern: selected(tuple([binding("left"), binding("right")])),
      init: { kind: "tuple-literal", elements: [integer("1u32"), integer("2u32")] } },
    { kind: "let", pattern: binding("total", true), init: { kind: "binary", left: path("left"), operator: "+", right: path("right") } },
    { kind: "for", pattern: selected(tuple([binding("offset"), binding("value", true)])),
      iterable: { kind: "slice-literal", elements: [
        { kind: "tuple-literal", elements: [integer("1u32"), integer("4u32")] },
        { kind: "tuple-literal", elements: [integer("2u32"), integer("5u32")] },
      ] }, body: { statements: [{ kind: "assign", target: path("value"), operator: "+=", value: path("offset") }, add("value")] } },
    { kind: "let", pattern: binding("remaining", true), init: { kind: "call", path: "Some", args: [integer("3u32")] } },
    { kind: "while-let", pattern: selected(present("value")),
      expression: { kind: "method-call", receiver: path("remaining"), method: "take", args: [] }, body: { statements: [add("value")] } },
    { kind: "if-let", pattern: selected(present("value")),
      expression: { kind: "call", path: "Some", args: [integer("5u32")] }, body: { statements: [add("value")] } },
    { kind: "let", pattern: selected(present("value")), init: { kind: "block", bindings: [], value: path("input") },
      else: { statements: [{ kind: "return", expr: path("total") }] } },
    { kind: "tail", expr: { kind: "binary", left: path("total"), operator: "+", right: path("value") } },
  ]), params: [{ pattern: binding("input"), type: { kind: "named", path: "Option",
    genericArguments: [{ kind: "type", type: { kind: "primitive", name: "u32" } }] } }] };
  const styled = finalizeRustSourceStyle({ headerComment: "fixture", items: [item] });
  assert.equal(nativeProgram("statement-patterns", styled.items,
    "macro_rules! selected { ($value:pat) => { $value }; }",
    "fn main() { assert_eq!(all_positions(None), 23); assert_eq!(all_positions(Some(7)), 30); }"), "");
});

test("native checking retains refutable-binding and nondiverging let-else failures", () => {
  const pattern = invocation("selected", "parentheses", [{ kind: "pattern", pattern: { kind: "binding", name: "value" } }]);
  const input = { kind: "call", path: "Some", args: [{ kind: "int-literal", text: "1u32" }] };
  const definitions = "macro_rules! selected { ($value:ident) => { Some($value) }; }";
  const invalidLet = method("invalid", [{ kind: "let", pattern, init: input }, { kind: "tail", expr: { kind: "path", path: "value" } }]);
  assert.throws(() => nativeProgram("refutable-let", [invalidLet], definitions, "fn main() {}"), /refutable pattern/u);
  const invalidElse = { ...invalidLet, body: { statements: [{ kind: "let", pattern, init: input, else: { statements: [] } },
    { kind: "tail", expr: { kind: "path", path: "value" } }] } };
  assert.throws(() => nativeProgram("nondiverging-let-else", [invalidElse], definitions, "fn main() {}"), /does not diverge/u);
  const invalidFor = method("invalid", [{ kind: "for", pattern, iterable: { kind: "slice-literal", elements: [input] },
    body: { statements: [{ kind: "return", expr: { kind: "path", path: "value" } }] } },
  { kind: "tail", expr: { kind: "int-literal", text: "0" } }]);
  assert.throws(() => nativeProgram("refutable-for", [invalidFor], definitions, "fn main() {}"), /refutable pattern/u);
});

test("native parameter patterns retain shared destructuring, mutable bindings and inferred closure types", () => {
  const integer = { kind: "primitive", name: "u32" };
  const reference = { kind: "reference", referent: integer, mutable: false };
  const binding = { kind: "binding", name: "element", mutable: true };
  const pattern = { kind: "reference", mutable: false, pattern: binding };
  const closure = { kind: "closure-block", params: [{ pattern }], move: false, async: false,
    body: { statements: [{ kind: "assign", target: { kind: "path", path: "element" }, operator: "+=", value: { kind: "int-literal", text: "1" } },
      { kind: "tail", expr: { kind: "path", path: "element" } }] } };
  const item = { ...method("increment_copy", [{ kind: "tail", expr: {
    kind: "invoke", callee: closure, args: [{ kind: "path", path: "value" }],
  } }]), params: [{ pattern: { kind: "binding", name: "value" }, type: reference }] };
  assert.equal(nativeProgram("reference-parameters", [item], "",
    "fn main() { let value = 9; assert_eq!(increment_copy(&value), 10); assert_eq!(value, 9); }"), "");
});

test("native checking rejects refutable and non-Copy parameter patterns without weakening ownership", () => {
  const integer = { kind: "primitive", name: "u32" };
  const parameter = invocation("selected", "parentheses", [{ kind: "pattern", pattern: { kind: "binding", name: "value" } }]);
  const refutable = { ...method("value", [{ kind: "tail", expr: { kind: "path", path: "value" } }]),
    params: [{ pattern: parameter, type: { kind: "named", path: "Option", genericArguments: [{ kind: "type", type: integer }] } }] };
  assert.throws(() => nativeProgram("refutable-parameter", [refutable],
    "macro_rules! selected { ($value:ident) => { Some($value) }; }", "fn main() {}"), /refutable pattern/u);
  const borrowed = { ...method("owned", [{ kind: "tail", expr: { kind: "path", path: "value" } }], { kind: "string" }),
    params: [{ pattern: { kind: "reference", mutable: false, pattern: { kind: "binding", name: "value" } },
      type: { kind: "reference", mutable: false, referent: { kind: "string" } } }] };
  assert.throws(() => nativeProgram("noncopy-parameter", [borrowed], "", "fn main() {}"), /cannot move out|does not implement the `Copy`/u);
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

test("foreign macro members link and execute in their exact native scope", () => {
  const integer = { kind: "primitive", name: "u32" };
  const link = name => [rustValueAttribute("link_name", { kind: "string", value: name })];
  const foreign = { kind: "extern-block", isUnsafe: true, abi: "C", members: [
    { kind: "function", name: "doubleValue", visibility: "public", safety: "safe",
      generics: emptyRustGenerics, params: [{ pattern: { kind: "binding", name: "inputValue" }, type: integer }], returnType: integer,
      attrs: link("proof_double") },
    invocation("foreign_first", "parentheses"),
    { kind: "static", name: "nativeValue", visibility: "public", safety: "safe", mutable: false,
      type: integer, attrs: link("PROOF_VALUE") },
    invocation("foreign_second", "brackets"),
    { kind: "static", name: "SLOT", visibility: "public", mutable: true,
      type: integer, attrs: link("PROOF_SLOT") },
    invocation("foreign_third", "braces"),
  ] };
  const items = finalizeRustSourceStyle({ headerComment: "fixture", items: [foreign] }).items;
  assert.equal(nativeProgram("foreign", items, `
mod implementation {
    #[unsafe(export_name = "proof_double")]
    pub extern "C" fn double(value: u32) -> u32 { value * 2 }
    #[unsafe(export_name = "proof_identity")]
    pub extern "C" fn identity(value: u32) -> u32 { value }
    #[unsafe(export_name = "PROOF_VALUE")]
    pub static VALUE: u32 = 9;
    #[unsafe(export_name = "PROOF_SLOT")]
    pub static mut SLOT: u32 = 0;
}
macro_rules! foreign_first { () => {
    #[link_name = "proof_identity"] pub safe fn first(value: u32) -> u32;
}; }
macro_rules! foreign_second { () => {
    #[link_name = "proof_identity"] pub unsafe fn second(value: u32) -> u32;
}; }
macro_rules! foreign_third { () => {
    #[link_name = "proof_identity"] pub fn third(value: u32) -> u32;
}; }
`, `fn main() {
    assert_eq!(doubleValue(first(4)) + nativeValue, 17);
    unsafe {
        SLOT = second(third(11));
        assert_eq!(std::ptr::read(std::ptr::addr_of!(SLOT)), 11);
    }
}`), "");
});

test("foreign macro position and native safety restrictions remain errors", () => {
  const block = { kind: "extern-block", isUnsafe: true, abi: "C", members: [invocation("declaration")] };
  assert.throws(() => nativeProgram("foreign_body", [block],
    "macro_rules! declaration { () => { pub fn invalid() {} }; }", "fn main() {}"),
  /functions in `extern` blocks cannot have a body/u);
  assert.throws(() => nativeProgram("foreign_safety", [block],
    "macro_rules! declaration { () => { pub unsafe fn foreign_operation(); }; }",
    "fn main() { foreign_operation(); }"), /call to unsafe function/u);
  assert.throws(() => nativeProgram("foreign_unsafe_block", [{ ...block, isUnsafe: false }],
    "macro_rules! declaration { () => { pub fn foreign_operation(); }; }", "fn main() {}"),
  /extern blocks must be unsafe/u);
});
