import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createTestWorkspace } from "../../../../../tsonic/test/scripts/test-workspaces.mjs";
import { createRustNativeSourceTool, defaultRustNativeSourceLimits } from "../../../../dist/providers/native/elaboration/tool.js";
import { decodeNativeTokenResponse } from "../../../../dist/providers/native/elaboration/tokens.js";
import { printRustTokenStream } from "../../../../dist/print/source/macro-input.js";
import { createRustTokenQuotation, bindRustTokenQuotation } from "../../../../dist/target-model/syntax/quotation.js";
import { validateRustNativeEvidenceInputs } from "../../../../dist/providers/native/elaboration/freshness.js";
import { decodeNativeEvidence } from "../../../../dist/providers/native/elaboration/decode-evidence.js";

const root = createTestWorkspace("rust-native-source-service");
const cacheRoot = join(root, "cache");
const tool = createRustNativeSourceTool({ cacheRoot });

function syntax(tokens) {
  return tokens.map(({ source: _source, ...token }) => token.kind === "group"
    ? { ...token, tokens: syntax(token.tokens) } : token);
}

function sourceFile(name, source) {
  const path = join(root, name);
  writeFileSync(path, source);
  return path;
}

test("native tokenizer preserves the entire token grammar without a macro catalogue", () => {
  const source = `'input r#type 9007199254740993_u64 -2_i128 br##"bytes\\n"## c"cstring" => :: && & & ([]) { a; b; }`;
  const tokens = tool.tokens(source, "2024");
  const printed = printRustTokenStream(tokens);
  assert.deepEqual(syntax(tool.tokens(printed, "2024")), syntax(tokens));
  assert.ok(Object.isFrozen(tokens));
  assert.match(printed, /9007199254740993_u64/u);
  assert.match(printed, /r#type/u);
  assert.match(printed, /'input/u);
});

test("native token groups and documentation attributes retain native meaning", () => {
  for (const source of ["()", "[]", "{}", "([{}])", "/// recorded\nstruct Item;", "/*! inner */ mod nested {}"] ) {
    const tokens = tool.tokens(source, "2024");
    assert.deepEqual(syntax(tool.tokens(printRustTokenStream(tokens), "2024")), syntax(tokens));
  }
  assert.throws(() => tool.tokens("([)]", "2024"), /invalid Rust tokens|source service failed/u);
  assert.throws(() => tool.tokens('r#"unterminated', "2024"), /invalid Rust tokens|source service failed/u);
  assert.throws(() => tool.tokens("x", "2099"), /Unsupported Rust edition/u);
});

test("native quotation splices join exact byte ranges rather than placeholder spellings", () => {
  const fragment = { kind: "expression", expression: { kind: "path", path: "source_value" } };
  const quotation = createRustTokenQuotation(["(/* 😀 */\r\n__tsonic_fragment_0, ", ", suffix)"], [fragment]);
  const tokens = bindRustTokenQuotation(quotation, tool.tokens(quotation.source, "2024"));
  const group = tokens[0];
  assert.equal(group.kind, "group");
  assert.equal(group.tokens[0].kind, "identifier");
  assert.equal(group.tokens[0].text, "__tsonic_fragment_0");
  assert.equal(group.tokens[2].kind, "fragment");
  assert.equal(group.tokens[2].fragment, fragment);
  assert.match(printRustTokenStream(tokens), /__tsonic_fragment_0 , source_value , suffix/u);
  for (const text of [["\"", "\""], ["/* ", " */"], ["prefix", ""], ["r#\"", "\"#"]]) {
    const invalid = createRustTokenQuotation(text, [fragment]);
    assert.throws(() => bindRustTokenQuotation(invalid, tool.tokens(invalid.source, "2024")), /source fragment/u);
  }
  assert.throws(() => createRustTokenQuotation(["only"], [fragment]), /one more/u);
  const relocated = { ...quotation, fragments: quotation.fragments.map(binding => ({
    ...binding, source: { start: binding.source.start + 1, end: binding.source.end + 1 },
  })) };
  assert.throws(() => bindRustTokenQuotation(relocated, tool.tokens(quotation.source, "2024")), /source fragment/u);
});

test("native token and evidence locations refer to original UTF-8 bytes, including CRLF and BOM", () => {
  const source = '\uFEFF// 😀\r\n"é"\r\nnext';
  const tokens = tool.tokens(source, "2024");
  const original = Buffer.from(source, "utf8");
  for (const token of tokens) {
    assert.equal(original.subarray(token.source.start, token.source.end).toString("utf8"), token.text);
  }
  const path = sourceFile("locations.rs", '\uFEFF// 😀\r\npub fn read() -> u32 { 123_u32 }\r\n');
  const evidence = tool.check(["--edition=2024", "--crate-type=lib", path]);
  const literal = evidence.occurrences.find(occurrence => occurrence.source !== null &&
    occurrence.source.file === path && occurrence.source.end - occurrence.source.start === 7);
  assert.ok(literal);
  assert.equal(Buffer.from('\uFEFF// 😀\r\npub fn read() -> u32 { 123_u32 }\r\n')
    .subarray(literal.source.start, literal.source.end).toString("utf8"), "123_u32");
});

test("native source evidence is produced only after real typing and borrow checking", () => {
  const path = sourceFile("checked.rs", `
macro_rules! item { () => { pub struct Generated { pub count: i32 } }; }
macro_rules! value { ($input:expr) => { $input }; }
macro_rules! pair { ($element:ty) => { ($element, bool) }; }
macro_rules! present { ($binding:ident) => { Some($binding) }; }
macro_rules! leave { () => { return 7; }; }
item!();
pub type Pair<Element> = pair!(Element);
pub fn borrow(input: &Option<String>) -> Option<&String> {
    match input { present!(item) => Some(item), None => None }
}
pub fn read(input: Generated) -> i32 { value!(input.count) }
pub fn early() -> i32 { leave!(); }
`);
  const evidence = tool.check(["--edition=2024", "--crate-type=lib", path]);
  assert.ok(evidence.definitions.some(definition => definition.name === "Generated" && definition.kind === "struct"));
  const field = evidence.definitions.find(definition => definition.name === "count" && definition.kind === "field");
  assert.ok(field);
  assert.deepEqual(evidence.types.find(type => type.id === field.type).value, { kind: "primitive", name: "i32" });
  assert.ok(evidence.expansions.some(expansion => expansion.name.includes("item") && expansion.kind === "function-like"));
  assert.ok(evidence.occurrences.some(occurrence => occurrence.kind === "pattern" && occurrence.resolution?.kind === "binding"));
  assert.ok(evidence.types.some(type => type.value.kind === "reference"));
  const sourceNames = new Set(evidence.occurrences.flatMap(occurrence => occurrence.source === null ? [] : [occurrence.source.file]));
  assert.ok(sourceNames.has(path));
  const invalid = sourceFile("invalid.rs", `
macro_rules! borrow { ($input:expr) => { &$input }; }
pub fn invalid<'scope>() -> &'scope String {
    let owned = String::from("value");
    borrow!(owned)
}
`);
  assert.throws(() => tool.check(["--edition=2024", "--crate-type=lib", invalid]), /cannot return reference|does not live long enough/u);
});

test("native declaration evidence is available before body checking without claiming body acceptance", () => {
  const path = sourceFile("declarations_before_bodies.rs", `
macro_rules! record { () => { pub struct Generated { pub count: u32 } }; }
record!();
pub fn choose<Element>(input: Element) -> Element { input }
pub fn first(input: Generated) -> Generated { second(input) }
pub fn second(input: Generated) -> Generated { first(input) }
pub fn invalid() -> Generated { Generated { count: "not a u32" } }
`);
  const arguments_ = ["--edition=2024", "--crate-type=lib", path];
  const evidence = tool.declarations(arguments_);
  assert.equal(evidence.phase, "declarations");
  assert.ok(!Object.hasOwn(evidence, "occurrences"));
  assert.ok(!Object.hasOwn(evidence, "effects"));
  assert.ok(Object.isFrozen(evidence));
  assert.ok(evidence.expansions.some(expansion => expansion.name.includes("record")));
  const generated = evidence.definitions.find(definition => definition.name === "Generated");
  const count = evidence.definitions.find(definition => definition.name === "count");
  assert.ok(generated);
  assert.deepEqual(count.parent, generated.id);
  assert.deepEqual(evidence.types.find(type => type.id === count.type).value, { kind: "primitive", name: "u32" });
  for (const name of ["choose", "first", "second", "invalid"]) {
    const declaration = evidence.definitions.find(definition => definition.name === name);
    assert.ok(declaration, name);
    const type = evidence.types.find(type => type.id === declaration.type);
    assert.equal(type.value.kind, "function", name);
    assert.ok(type.value.signature, name);
  }
  validateRustNativeEvidenceInputs(evidence);
  assert.throws(() => tool.check(arguments_), /mismatched types/u);
});

test("native declaration queries still reject unresolved signatures and failed expansion", () => {
  for (const [name, source, message] of [
    ["unresolved_signature", "pub fn read() -> Missing { loop {} }", /cannot find type/u],
    ["failed_expansion", 'compile_error!("expansion rejected");', /expansion rejected/u],
  ]) {
    const path = sourceFile(`${name}.rs`, source);
    assert.throws(() => tool.declarations(["--edition=2024", "--crate-type=lib", path]), message);
  }
});

test("nested declaration parents do not force closure body inference during declaration queries", () => {
  const path = sourceFile("declarations_in_closure.rs", `
pub fn outer() {
    let _callback = || {
        struct Local { field: u32 }
        let _: u32 = "invalid body";
    };
}
`);
  const arguments_ = ["--edition=2024", "--crate-type=lib", path];
  const evidence = tool.declarations(arguments_);
  const local = evidence.definitions.find(definition => definition.name === "Local");
  assert.ok(local);
  const parent = evidence.definitions.find(definition => definition.id.krate === local.parent.krate &&
    definition.id.index === local.parent.index);
  assert.equal(parent.kind, "closure");
  assert.equal(parent.type, null);
  assert.throws(() => tool.check(arguments_), /mismatched types/u);
});

test("invalid native headers reject as diagnostics rather than crashing the native type collector", () => {
  for (const [name, source] of [
    ["missing_return_argument", "pub struct Boxed<Value>(Value); pub fn read() -> Boxed { loop {} }"],
    ["missing_field_argument", "pub struct Boxed<Value>(Value); pub struct Holder { value: Boxed }"],
  ]) {
    const path = sourceFile(`${name}.rs`, source);
    assert.throws(() => tool.declarations(["--edition=2024", "--crate-type=lib", path]), error => {
      assert.match(error.message, /missing generics|generic argument/u);
      assert.doesNotMatch(error.message, /internal compiler error|panicked at|unreachable/u);
      return true;
    });
  }
});

test("unused native variants and constructors remain in declaration evidence", () => {
  const path = sourceFile("unused_constructors.rs", `
pub enum Flag { Off, On(u8), Count { value: u32 } }
pub struct Unit;
pub struct Tuple(pub u32);
`);
  const evidence = tool.declarations(["--edition=2024", "--crate-type=lib", path]);
  const flag = evidence.definitions.find(definition => definition.name === "Flag");
  assert.ok(flag);
  const variants = evidence.definitions.filter(definition => definition.kind === "variant");
  assert.deepEqual(variants.map(definition => definition.name).sort(), ["Count", "Off", "On"]);
  for (const variant of variants) assert.deepEqual(variant.parent, flag.id);
  for (const kind of ["unit-struct-constructor", "tuple-struct-constructor", "unit-variant-constructor", "tuple-variant-constructor"]) {
    const constructor = evidence.definitions.find(definition => definition.kind === kind);
    assert.ok(constructor, kind);
    assert.notEqual(constructor.type, null);
    assert.ok(evidence.types.some(type => type.id === constructor.type));
    assert.ok(evidence.definitions.some(definition => definition.id.krate === constructor.parent.krate &&
      definition.id.index === constructor.parent.index));
  }
});

test("declaration evidence preserves phase identity, graph integrity and resource limits", () => {
  const path = sourceFile("declaration_mutations.rs", "pub fn identity(input: u64) -> u64 { input }");
  const arguments_ = ["--edition=2024", "--crate-type=lib", path];
  const evidence = tool.declarations(arguments_);
  for (const mutate of [
    value => { delete value.phase; },
    value => { value.phase = "checked"; },
    value => { value.effects = []; },
    value => { value.occurrences = []; },
    value => { value.definitions[0].parent = { krate: 0, index: 0xffff_ffff }; },
    value => value.types.push(value.types[0]),
    value => { value.definitions[1].id = value.definitions[0].id; },
    value => { value.definitions[0].publicId = 0; },
  ]) {
    const corrupted = structuredClone(evidence);
    mutate(corrupted);
    assert.throws(() => decodeNativeEvidence(corrupted, defaultRustNativeSourceLimits), /Native Rust/u);
  }
  for (const selection of [{ maximumRows: 1 }, { maximumOutputBytes: 128 }]) {
    const bounded = createRustNativeSourceTool({ cacheRoot, limits: { ...defaultRustNativeSourceLimits, ...selection } });
    assert.throws(() => bounded.declarations(arguments_), /limit/u);
  }
  writeFileSync(path, "pub fn identity(input: i64) -> i64 { input }");
  assert.throws(() => validateRustNativeEvidenceInputs(evidence), /checked input changed/u);
});

test("procedural expansion observes real bodies, produces definitions and runs derives", () => {
  const library = sourceFile("native_fixture.rs", `
extern crate proc_macro;
use proc_macro::{TokenStream, TokenTree};
#[proc_macro_attribute]
pub fn require_body(_: TokenStream, item: TokenStream) -> TokenStream {
    assert!(item.to_string().contains("sentinel"));
    item
}
#[proc_macro_attribute]
pub fn replace(_: TokenStream, _: TokenStream) -> TokenStream {
    "pub fn generated() -> i64 { 41 }".parse().unwrap()
}
#[proc_macro_derive(Tagged, attributes(note))]
pub fn tagged(input: TokenStream) -> TokenStream {
    let mut after_struct = false;
    for token in input {
        if let TokenTree::Ident(name) = token {
            if after_struct { return format!("impl {name} {{ pub const TAG: u32 = 7; }}").parse().unwrap(); }
            after_struct = name.to_string() == "struct";
        }
    }
    panic!("expected struct")
}
#[proc_macro]
pub fn echo(input: TokenStream) -> TokenStream { input }
`);
  const output = join(root, "library");
  mkdirSync(output, { recursive: true });
  const compiled = spawnSync(process.env.RUSTC ?? "rustc", [
    "--edition=2024", "--crate-type=proc-macro", "--out-dir", output, library,
  ], { encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(compiled.status, 0, compiled.stderr);
  const libraryName = process.platform === "win32" ? "native_fixture.dll" : process.platform === "darwin" ? "libnative_fixture.dylib" : "libnative_fixture.so";
  const path = sourceFile("procedural.rs", `
#[native_fixture::require_body]
pub fn observed() -> u32 { let sentinel = 8; sentinel }
#[native_fixture::replace]
pub fn removed() { nonexistent_name(); }
#[derive(native_fixture::Tagged)]
#[note(example)]
pub struct Generated;
native_fixture::echo!(pub fn read() -> i64 { generated() });
pub fn tag() -> u32 { Generated::TAG }
`);
  const arguments_ = ["--edition=2024", "--crate-type=lib", "--extern", `native_fixture=${join(output, libraryName)}`];
  const declarations = tool.declarations([...arguments_, path]);
  assert.equal(declarations.phase, "declarations");
  assert.ok(declarations.definitions.some(definition => definition.name === "generated"));
  assert.ok(declarations.definitions.some(definition => definition.name === "TAG"));
  assert.ok(!declarations.definitions.some(definition => definition.name === "removed"));
  assert.ok(declarations.expansions.some(expansion => expansion.kind === "derive"));
  const evidence = tool.check([...arguments_, path]);
  assert.equal(evidence.phase, "checked");
  assert.ok(evidence.expansions.some(expansion => expansion.kind === "attribute"));
  assert.ok(evidence.expansions.some(expansion => expansion.kind === "derive"));
  assert.ok(evidence.definitions.some(definition => definition.name === "generated"));
  assert.ok(!evidence.definitions.some(definition => definition.name === "removed"));
  const invalid = sourceFile("missing_body.rs", `#[native_fixture::require_body] pub fn invalid() {}`);
  assert.throws(() => tool.declarations([...arguments_, invalid]), /custom attribute panicked/u);
  assert.throws(() => tool.check([...arguments_, invalid]), /custom attribute panicked/u);
});

test("native macro effects retain compiler-selected moves, copies, borrows and captures", () => {
  const path = sourceFile("effects.rs", `
pub struct Owned(pub String);
#[derive(Clone, Copy)]
pub struct Trivial(pub u32);
macro_rules! move_value { ($value:expr) => { $value }; }
macro_rules! edit { ($value:expr) => { $value.push('!') }; }
pub fn consume(input: Owned) -> Owned { move_value!(input) }
pub fn copied(input: Trivial) -> Trivial { move_value!(input) }
pub fn shared(input: &Owned) -> usize { input.0.len() }
pub fn mutate(input: &mut Owned) { edit!(input.0); }
pub fn capture(input: Owned) -> impl FnOnce() -> Owned { move || move_value!(input) }
pub fn assign() -> Owned {
    let mut value = Owned(String::from("first"));
    value.0.push('!');
    value = Owned(String::from("second"));
    value
}
`);
  const evidence = tool.check(["--edition=2024", "--crate-type=lib", path]);
  const identity = value => `${value.krate}:${value.index}`;
  const effectsFor = name => {
    const definition = evidence.definitions.find(definition => definition.name === name && definition.kind === "function");
    assert.ok(definition, name);
    const body = evidence.effects.find(body => identity(body.owner) === identity(definition.id));
    assert.ok(body, name);
    return body.accesses;
  };
  assert.ok(effectsFor("consume").some(access => access.kind === "move" && access.base.kind === "local"));
  assert.ok(effectsFor("copied").some(access => access.kind === "copy" && access.base.kind === "local"));
  assert.ok(effectsFor("shared").some(access => access.kind === "borrow-shared"));
  assert.ok(effectsFor("mutate").some(access => access.kind === "borrow-mutable" &&
    access.projections.some(projection => projection.kind === "field")));
  assert.ok(effectsFor("assign").some(access => access.kind === "mutate"));
  assert.ok(effectsFor("assign").some(access => access.kind === "bind"));
  assert.ok(evidence.effects.some(body => body.accesses.some(access =>
    access.kind === "move" && access.base.kind === "capture")));
  const invalid = sourceFile("moved.rs", `
macro_rules! take { ($value:expr) => { drop($value) }; }
pub fn invalid(value: String) -> String { take!(value); value }
`);
  assert.throws(() => tool.check(["--edition=2024", "--crate-type=lib", invalid]), /use of moved value/u);
});

test("the same native input is rejected by small finite bounds and accepted by adequate bounds", () => {
  const small = createRustNativeSourceTool({ cacheRoot, limits: { ...defaultRustNativeSourceLimits, maximumRows: 2 } });
  assert.throws(() => small.tokens("[one, two]", "2024"), /row limit/u);
  assert.equal(tool.tokens("[one, two]", "2024")[0].kind, "group");
  const shallow = createRustNativeSourceTool({ cacheRoot, limits: { ...defaultRustNativeSourceLimits, maximumDepth: 1 } });
  assert.throws(() => shallow.tokens("((value))", "2024"), /depth limit/u);
  const tiny = createRustNativeSourceTool({ cacheRoot, limits: { ...defaultRustNativeSourceLimits, maximumOutputBytes: 128 } });
  assert.throws(() => tiny.tokens(`"${"x".repeat(256)}"`, "2024"), /byte limit/u);
});

test("native source and include inputs are fingerprinted at the compiler's actual read", () => {
  const include = sourceFile("included.rs", "pub const COUNT: u32 = 7;\n");
  const binary = sourceFile("data.bin", "abcd");
  const path = sourceFile("inputs.rs", 'include!("included.rs");\npub const BYTES: &[u8] = include_bytes!("data.bin");');
  const evidence = tool.check(["--edition=2024", "--crate-type=lib", path]);
  for (const input of [path, include, binary]) assert.ok(evidence.inputs.some(row => row.path === input));
  validateRustNativeEvidenceInputs(evidence);
  writeFileSync(binary, "abce");
  assert.throws(() => validateRustNativeEvidenceInputs(evidence), /checked input changed/u);
});

test("native evidence rejects duplicate identities, missing selected types and wrong categories", () => {
  const path = sourceFile("mutations.rs", "pub fn original(input: u64) -> u64 { input }");
  const evidence = tool.check(["--edition=2024", "--crate-type=lib", path]);
  for (const mutate of [
    value => value.types.push(value.types[0]),
    value => value.definitions.push(value.definitions[0]),
    value => value.expansions.push(value.expansions[0]),
    value => { value.occurrences[0].type = 0xffff_ffff; },
    value => { value.occurrences[0].kind = "statement"; },
    value => { value.occurrences[0].source.start = value.occurrences[0].source.end + 1; },
    value => { value.definitions[0].kind = "not-a-definition"; },
    value => { value.inputs[0].digest = "stale"; },
    value => value.effects.push(value.effects[0]),
    value => { value.effects[0].accesses[0].kind = "guessed-borrow"; },
    value => { value.effects[0].owner.index = 0xffff_ffff; },
  ]) {
    const corrupted = structuredClone(evidence);
    mutate(corrupted);
    assert.throws(() => decodeNativeEvidence(corrupted, defaultRustNativeSourceLimits), /Native Rust evidence/u);
  }
});

test("native source budget selections reject malformed values before a compiler process starts", () => {
  for (const field of Object.keys(defaultRustNativeSourceLimits)) {
    for (const value of [0, -1, Infinity, NaN, 1.5, Number.MAX_SAFE_INTEGER]) {
      assert.throws(() => createRustNativeSourceTool({ cacheRoot, limits: {
        ...defaultRustNativeSourceLimits, [field]: value,
      } }), /positive integer/u);
    }
  }
});

test("token response decoding rejects malformed, truncated and wrongly owned data", () => {
  for (const response of [
    null, {}, { protocolVersion: 2, kind: "tokens", tokens: [] },
    { protocolVersion: 1, kind: "evidence", tokens: [] },
    { protocolVersion: 1, kind: "tokens", tokens: [{ kind: "group", delimiter: "other", tokens: [] }] },
    { protocolVersion: 1, kind: "tokens", tokens: [{ kind: "fragment", fragment: {} }] },
    { protocolVersion: 1, kind: "tokens", tokens: [{ kind: "identifier", text: "name", raw: "false" }] },
    { protocolVersion: 1, kind: "tokens", tokens: [{ kind: "literal", text: "" }] },
  ]) {
    assert.throws(() => decodeNativeTokenResponse(response, defaultRustNativeSourceLimits), /invalid|structured/u);
  }
});
