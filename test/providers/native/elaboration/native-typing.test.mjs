import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestWorkspace } from "../../../../../tsonic/test/scripts/test-workspaces.mjs";
import { repositoryRoot } from "../../../helpers/rust-session/paths.mjs";
import { createRustNativeSourceTool, defaultRustNativeSourceLimits } from "../../../../dist/providers/native/elaboration/tool.js";
import { decodeNativeEvidence } from "../../../../dist/providers/native/elaboration/decode-evidence.js";
import { nativeDefinitionKey, nativeNodeKey } from "../../../../dist/providers/native/elaboration/evidence.js";
import { nativeEvidenceFixture } from "./native-evidence-fixture.mjs";

const root = createTestWorkspace(join(repositoryRoot, ".temp/generated"), "rust-native-typing-");
const cacheRoot = join(root, "cache");
const tool = createRustNativeSourceTool({ cacheRoot });

function input(name, text) {
  const path = join(root, `${name}.rs`);
  const output = join(root, `${name}.rlib`);
  writeFileSync(path, text);
  return { output, arguments: ["--edition=2024", "--crate-type=lib", "-D", "warnings", path, "-o", output] };
}

test("native typing exposes compiler macro flow without certifying use-after-move", () => {
  const program = input("conditional_move", `
macro_rules! consume { ($condition:expr, $value:expr) => { if $condition { drop($value); } }; }
pub fn decision(value: String, condition: bool) -> String { consume!(condition, value); value }
`);
  const evidence = tool.typing(program.arguments);
  assert.equal(evidence.phase, "typed");
  const definition = evidence.definitions.find(row => row.name === "decision" && row.id.krate === 0);
  assert.ok(definition);
  const body = evidence.flows.find(row => nativeDefinitionKey(row.owner) === nativeDefinitionKey(definition.id));
  assert.ok(body);
  assert.ok(body.blocks.some(block => block.terminator.control.kind === "switch"));
  assert.ok(body.blocks.some(block => block.terminator.control.kind === "call"));
  const effects = evidence.effects.find(row => nativeDefinitionKey(row.owner) === nativeDefinitionKey(definition.id));
  assert.ok(effects);
  const moves = effects.accesses.filter(access => access.kind === "move" && access.base.kind === "local");
  assert.ok(moves.length >= 2);
  assert.ok(moves.some(access => moves.filter(other =>
    nativeNodeKey(other.base.binding) === nativeNodeKey(access.base.binding)).length >= 2));
  assert.ok(moves.some(access => access.source !== null && evidence.expansions.some(expansion => expansion.kind === "function-like" &&
    nativeDefinitionKey(expansion.id) === nativeDefinitionKey(access.source.expansion))));
  assert.ok(Object.isFrozen(evidence));
  assert.throws(() => tool.check(program.arguments), /use of moved value/u);
  assert.equal(existsSync(program.output), false);
});

test("typed and checked paths retain the same native body analysis for valid source", () => {
  const program = input("accepted", `
macro_rules! consume { ($condition:expr, $value:expr) => { if $condition { return $value; } }; }
pub fn decision(value: String, condition: bool) -> String { consume!(condition, value); value }
pub fn callback(value: String) -> impl FnOnce() -> usize { move || value.len() }
pub mod nested { pub fn length(value: &str) -> usize { value.len() } }
`);
  const typed = tool.typing(program.arguments);
  const checked = tool.check(program.arguments);
  assert.equal(typed.phase, "typed");
  assert.equal(checked.phase, "checked");
  for (const key of ["occurrences", "effects", "flows"]) assert.deepEqual(typed[key], checked[key], key);
  assert.ok(typed.effects.length >= 4);
  assert.equal(existsSync(program.output), false);
});

test("native typing does not suppress parse, resolution or type errors", () => {
  for (const [name, text, diagnostic] of [
    ["invalid_syntax", "pub fn value( {", /unclosed delimiter|expected/u],
    ["invalid_resolution", "pub fn value() -> u32 { missing() }", /cannot find function/u],
    ["invalid_type", 'pub fn value() -> u32 { "wrong" }', /mismatched types/u],
    ["invalid_bound", "pub fn value<T: Copy>(_input: T) {} pub fn caller() { value(String::new()); }", /Copy.*not satisfied|Copy.*not implemented/su],
  ]) {
    const program = input(name, text);
    assert.throws(() => tool.typing(program.arguments), diagnostic);
    assert.throws(() => tool.check(program.arguments), diagnostic);
    assert.equal(existsSync(program.output), false);
  }
});

test("native lifetime and unsafe acceptance still requires the checked phase", () => {
  for (const [name, text, diagnostic] of [
    ["invalid_lifetime", "pub fn value() -> &'static u32 { let local = 1; &local }", /cannot return reference to local variable/u],
    ["invalid_unsafe", "pub fn value(pointer: *const u32) -> u32 { *pointer }", /dereference of raw pointer is unsafe/u],
  ]) {
    const program = input(name, text);
    const typed = tool.typing(program.arguments);
    assert.equal(typed.phase, "typed");
    assert.ok(typed.occurrences.length > 0);
    assert.throws(() => tool.check(program.arguments), diagnostic);
    assert.equal(existsSync(program.output), false);
  }
});

test("native typing retains finite row and output budgets", () => {
  const program = input("budgets", "pub fn identity(value: u64) -> u64 { value }");
  for (const limits of [
    { ...defaultRustNativeSourceLimits, maximumRows: 1 },
    { ...defaultRustNativeSourceLimits, maximumOutputBytes: 64 },
  ]) {
    const bounded = createRustNativeSourceTool({ cacheRoot, limits });
    assert.throws(() => bounded.typing(program.arguments), /limit/u);
    assert.equal(existsSync(program.output), false);
  }
});

test("native typing uses the complete body decoder without accepting malformed phase data", () => {
  const typed = { ...nativeEvidenceFixture(), phase: "typed", occurrences: [], effects: [], flows: [] };
  assert.equal(decodeNativeEvidence(typed, defaultRustNativeSourceLimits).phase, "typed");
  for (const phase of ["declarations", "partial", "typechecked"]) {
    assert.throws(() => decodeNativeEvidence({ ...typed, phase }, defaultRustNativeSourceLimits));
  }
  for (const key of ["occurrences", "effects", "flows"]) {
    const missing = { ...typed };
    delete missing[key];
    assert.throws(() => decodeNativeEvidence(missing, defaultRustNativeSourceLimits));
    assert.throws(() => decodeNativeEvidence({ ...typed, [key]: [{}] }, defaultRustNativeSourceLimits));
  }
  assert.throws(() => decodeNativeEvidence({ ...typed, checked: true }, defaultRustNativeSourceLimits));
});
