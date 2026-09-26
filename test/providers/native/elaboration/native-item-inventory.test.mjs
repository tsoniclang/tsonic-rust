import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestWorkspace } from "../../../../../tsonic/test/scripts/test-workspaces.mjs";
import { createRustNativeSourceTool, defaultRustNativeSourceLimits } from "../../../../dist/providers/native/elaboration/tool.js";
import { decodeNativeEvidence } from "../../../../dist/providers/native/elaboration/decode-evidence.js";
import { nativeDefinitionKey, nativeStableDefinitionKey } from "../../../../dist/providers/native/elaboration/evidence.js";
import { runRustNativeCommand } from "../../../../dist/providers/native/protocol/bounded-command.js";
import { nativeDefinition, nativeEvidenceFixture, nativeIdentity } from "./native-evidence-fixture.mjs";

const root = createTestWorkspace("rust-native-item-inventory");
const tool = createRustNativeSourceTool({ cacheRoot: join(root, "cache") });
const limits = defaultRustNativeSourceLimits;

function source(name, text) {
  const path = join(root, `${name}.rs`);
  writeFileSync(path, text);
  return ["--edition=2024", "--crate-type=lib", path];
}

function stableItems(evidence) {
  const definitions = new Map(evidence.definitions.map(row => [nativeDefinitionKey(row.id), row]));
  return evidence.items.map(id => {
    const definition = definitions.get(nativeDefinitionKey(id));
    assert.ok(definition);
    return [nativeStableDefinitionKey(definition.stable), definition.kind, definition.name];
  }).sort((left, right) => left[0].localeCompare(right[0]));
}

test("empty native crates still publish one complete effective root scope", () => {
  const arguments_ = source("empty", "#![no_std]\n");
  for (const evidence of [tool.declarations(arguments_), tool.check(arguments_)]) {
    const rootDefinition = evidence.definitions.find(row => nativeDefinitionKey(row.id) === nativeDefinitionKey(evidence.root));
    assert.equal(rootDefinition.kind, "module");
    assert.equal(rootDefinition.parent, null);
    assert.ok(evidence.items.some(id => nativeDefinitionKey(id) === nativeDefinitionKey(evidence.root)));
    const scope = evidence.scopes.find(row => nativeDefinitionKey(row.owner) === nativeDefinitionKey(evidence.root));
    assert.equal(scope.kind, "named");
    assert.ok(!scope.bindings.some(binding => binding.resolution.kind === "declaration" &&
      binding.resolution.definition.krate === evidence.root.krate));
  }
});

test("complete native item inventory includes local, foreign, generated and associated owners", () => {
  const arguments_ = source("owners", `
pub mod empty {}
pub mod nested { pub enum Choice { Left, Right(u32) } }
pub trait Read { fn read(&self) -> u32; }
pub struct Value;
impl Read for Value { fn read(&self) -> u32 { 1 } }
unsafe extern "C" { pub fn native_call(); }
macro_rules! declare { () => { pub mod generated { pub struct Record; } }; }
declare!();
pub fn enclosing() { struct Local; impl Local { fn nested() {} } }
`);
  const declarations = tool.declarations(arguments_);
  const checked = tool.check(arguments_);
  assert.deepEqual(stableItems(declarations), stableItems(checked));
  const names = stableItems(checked).map(row => row[2]);
  for (const name of ["empty", "nested", "Choice", "Read", "Value", "native_call", "generated", "Record", "enclosing", "Local"]) {
    assert.ok(names.includes(name), name);
  }
  assert.equal(names.filter(name => name === "read").length, 2);
  for (const evidence of [declarations, checked]) {
    const empty = evidence.definitions.find(row => row.name === "empty" && row.id.krate === evidence.root.krate);
    const scope = evidence.scopes.find(row => nativeDefinitionKey(row.owner) === nativeDefinitionKey(empty.id));
    assert.deepEqual(scope.bindings, []);
    assert.deepEqual(scope.ambiguities, []);
  }
});

test("erasing attributes yield complete replacement scopes, not fabricated expansion rows", () => {
  const macroPath = join(root, "inventory_attributes.rs");
  const libraryPath = join(root, process.platform === "win32" ? "inventory_attributes.dll" :
    process.platform === "darwin" ? "libinventory_attributes.dylib" : "libinventory_attributes.so");
  writeFileSync(macroPath, `
extern crate proc_macro;
use proc_macro::TokenStream;
#[proc_macro_attribute]
pub fn erase(_: TokenStream, _: TokenStream) -> TokenStream { TokenStream::new() }
#[proc_macro_attribute]
pub fn replace(_: TokenStream, _: TokenStream) -> TokenStream {
    "pub mod generated { pub fn value() -> u32 { 7 } }".parse().unwrap()
}
`);
  runRustNativeCommand({ executable: "rustc", arguments: ["--edition=2024", "--crate-type=proc-macro",
    "--crate-name", "inventory_attributes", macroPath, "-o", libraryPath], directory: root,
    environment: { ...process.env }, timeoutMilliseconds: 60_000, maximumDiagnosticBytes: 1_048_576 });
  const arguments_ = [...source("replaced", `
#[inventory_attributes::erase]
pub mod erased { pub fn invalid() { nonexistent(); } }
#[inventory_attributes::replace]
pub fn before() { nonexistent(); }
pub mod retained {
    #[inventory_attributes::erase]
    pub fn erased() { nonexistent(); }
}
pub fn read() -> u32 { generated::value() }
`), "--extern", `inventory_attributes=${libraryPath}`];
  const declarations = tool.declarations(arguments_);
  const checked = tool.check(arguments_);
  assert.deepEqual(stableItems(declarations), stableItems(checked));
  for (const evidence of [declarations, checked]) {
    const names = stableItems(evidence).map(row => row[2]);
    assert.ok(!names.includes("erased"));
    assert.ok(!names.includes("before"));
    assert.ok(names.includes("generated"));
    assert.ok(names.includes("value"));
    const retained = evidence.definitions.find(row => row.name === "retained" && row.id.krate === evidence.root.krate);
    assert.deepEqual(evidence.scopes.find(row => nativeDefinitionKey(row.owner) === nativeDefinitionKey(retained.id)).bindings, []);
  }
});

test("stable definition components remain exact above the source number precision boundary", () => {
  const input = nativeEvidenceFixture();
  input.definitions[0].stable = { krate: "ffffffffffffffff", path: "0020000000000001" };
  const evidence = decodeNativeEvidence(input, limits);
  assert.deepEqual(evidence.definitions[0].stable, input.definitions[0].stable);
  assert.equal(nativeStableDefinitionKey(evidence.definitions[0].stable), "ffffffffffffffff:0020000000000001");
  assert.ok(Object.isFrozen(evidence.definitions[0].stable));
  assert.ok(Object.isFrozen(evidence.items));
});

test("item coverage rejects missing, foreign, duplicate and contradictory identities", () => {
  const input = nativeEvidenceFixture();
  input.definitions.push(nativeDefinition(1, "module"));
  input.items.push(nativeIdentity(1));
  input.scopes.push({ kind: "named", owner: nativeIdentity(1), bindings: [], ambiguities: [] });
  assert.equal(decodeNativeEvidence(input, limits).items.length, 2);
  const mutations = [
    value => { delete value.root; },
    value => { delete value.items; },
    value => { value.root = nativeIdentity(1); },
    value => { value.root = nativeIdentity(9); },
    value => { value.items.shift(); },
    value => { value.items.pop(); },
    value => { value.items.push(nativeIdentity(1)); },
    value => { value.items.push(nativeIdentity(9)); },
    value => { value.scopes.pop(); },
    value => { value.definitions[1].parent = null; },
    value => { value.definitions[1].id.krate = 1; },
    value => { value.definitions[1].kind = "field"; },
    value => { value.definitions[1].stable = value.definitions[0].stable; },
    value => { value.definitions[1].stable.krate = "ffffffffffffffff"; },
    value => { value.definitions[1].stable.path = "1"; },
    value => { value.definitions[1].stable.path = "fffffffffffffffff"; },
    value => { value.definitions[1].stable.path = 9007199254740992; },
    value => { value.definitions[1].stable.guessed = true; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(input);
    mutate(changed);
    assert.throws(() => decodeNativeEvidence(changed, limits), /Native Rust/u);
  }
  assert.throws(() => decodeNativeEvidence(input, { ...limits, maximumRows: 3 }), /row limit/u);
});
