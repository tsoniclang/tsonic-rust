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
  assert.deepEqual(evidence.types.find(type => type.id === field.type).kind, { RigidTy: { Int: "I32" } });
  assert.ok(evidence.expansions.some(expansion => expansion.name.includes("item") && expansion.kind === "function-like"));
  assert.ok(evidence.occurrences.some(occurrence => occurrence.kind === "pattern" && occurrence.resolution?.kind === "binding"));
  assert.ok(evidence.types.some(type => type.kind.RigidTy?.Ref !== undefined));
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
  const evidence = tool.check([...arguments_, path]);
  assert.ok(evidence.expansions.some(expansion => expansion.kind === "attribute"));
  assert.ok(evidence.expansions.some(expansion => expansion.kind === "derive"));
  assert.ok(evidence.definitions.some(definition => definition.name === "generated"));
  assert.ok(!evidence.definitions.some(definition => definition.name === "removed"));
  const invalid = sourceFile("missing_body.rs", `#[native_fixture::require_body] pub fn invalid() {}`);
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
