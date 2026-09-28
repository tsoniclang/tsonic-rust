import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestWorkspace } from "../../../../../tsonic/test/scripts/test-workspaces.mjs";
import { repositoryRoot } from "../../../helpers/rust-session/paths.mjs";
import { createRustNativeSourceTool, defaultRustNativeSourceLimits } from "../../../../dist/providers/native/elaboration/tool.js";
import { decodeNativeEvidence } from "../../../../dist/providers/native/elaboration/decode-evidence.js";
import { nativeDefinitionKey, nativeNodeKey } from "../../../../dist/providers/native/elaboration/evidence.js";

const root = createTestWorkspace(join(repositoryRoot, ".temp/generated"), "rust-native-occurrences-");
const tool = createRustNativeSourceTool({ cacheRoot: join(root, "cache") });

function source(name, text) {
  const path = join(root, `${name}.rs`);
  writeFileSync(path, text);
  return ["--edition=2024", "--crate-type=lib", path];
}

test("native occurrence selections include exact inferred and explicit generic arguments", () => {
  const evidence = tool.check({ compilation: { kind: "compiler", arguments: source("arguments", `
pub fn identity<Value>(value: Value) -> Value { value }
pub fn amount<const SIZE: u64>() -> u64 { SIZE }
pub fn select(input: u64) -> u64 {
    let first = identity(input);
    identity::<u64>(first) + amount::<9007199254740993>()
}
`) }, sources: [] });
  const identity = evidence.definitions.find(row => row.name === "identity" && row.id.krate === 0);
  const uses = evidence.occurrences.filter(row => row.kind === "expression" && row.arguments !== null &&
    row.resolution?.kind === "declaration" && nativeDefinitionKey(row.resolution.id) === nativeDefinitionKey(identity.id));
  assert.equal(uses.length, 2);
  for (const use of uses) {
    assert.equal(use.arguments.length, 1);
    assert.equal(use.arguments[0].kind, "type");
    assert.deepEqual(evidence.types.find(row => row.id === use.arguments[0].id).value, { kind: "primitive", name: "u64" });
  }
  const amount = evidence.definitions.find(row => row.name === "amount" && row.id.krate === 0);
  const constantUse = evidence.occurrences.find(row => row.kind === "expression" && row.arguments !== null &&
    row.resolution?.kind === "declaration" && nativeDefinitionKey(row.resolution.id) === nativeDefinitionKey(amount.id));
  assert.equal(constantUse.arguments[0].kind, "constant");
  assert.equal(evidence.constants.find(row => row.id === constantUse.arguments[0].id).value.bits, "9007199254740993");
  const changed = structuredClone(evidence);
  changed.occurrences.find(row => row.kind === "expression" && row.arguments?.length > 0).arguments[0] = { kind: "type", id: 0xffff_ffff };
  assert.throws(() => decodeNativeEvidence(changed, defaultRustNativeSourceLimits), /absent type/u);
});

test("native deref, borrow, coercion and two-phase facts do not depend on container names", () => {
  const evidence = tool.check({ compilation: { kind: "compiler", arguments: source("adjustments", `
pub struct AuthoredContainer<Value>(Value);
impl<Value> core::ops::Deref for AuthoredContainer<Value> {
    type Target = Value;
    fn deref(&self) -> &Value { &self.0 }
}
impl<Value> core::ops::DerefMut for AuthoredContainer<Value> {
    fn deref_mut(&mut self) -> &mut Value { &mut self.0 }
}
pub fn identity(value: u64) -> u64 { value }
pub fn use_adjustments() -> usize {
    let mut native = AuthoredContainer(String::from("x"));
    native.push_str("y");
    let mut values = Vec::new();
    values.push(values.len());
    let numbers = [1_u8, 2];
    let slice: &[u8] = &numbers;
    let ordinary: fn(u64) -> u64 = identity;
    let converted: unsafe fn(u64) -> u64 = ordinary;
    let closure: fn(u64) -> u64 = |value| value + 1;
    let _ = converted;
    slice.len() + native.len() + closure(ordinary(1)) as usize
}
`) }, sources: [] });
  const operations = evidence.occurrences.flatMap(row => row.kind === "expression"
    ? row.adjustments.map(adjustment => adjustment.operation) : []);
  for (const kind of ["builtin-deref", "overloaded-deref", "borrow-reference", "unsize",
    "reify-function-pointer", "unsafe-function-pointer", "closure-function-pointer"]) {
    assert.ok(operations.some(operation => operation.kind === kind), kind);
  }
  assert.ok(operations.some(operation => operation.kind === "borrow-reference" && operation.mutable && operation.twoPhase));
  for (const operation of operations.filter(operation => operation.kind === "overloaded-deref")) {
    const method = evidence.definitions.find(row => nativeDefinitionKey(row.id) === nativeDefinitionKey(operation.method));
    assert.equal(method.kind, "associated-function");
  }
  const changed = structuredClone(evidence);
  const adjusted = changed.occurrences.find(row => row.kind === "expression" && row.adjustments.length > 0);
  adjusted.adjustedType = 0xffff_ffff;
  assert.throws(() => decodeNativeEvidence(changed, defaultRustNativeSourceLimits), /adjustment|absent type/u);
});

test("native match ergonomics distinguish value binding from shared and mutable references", () => {
  const text = `
pub fn shared(input: &Option<String>) -> Option<&String> {
    match input { Some(shared_value) => Some(shared_value), None => None }
}
pub fn mutable(input: &mut Option<String>) -> Option<&mut String> {
    match input { Some(mutable_value) => Some(mutable_value), None => None }
}
pub fn ordinary() -> u32 { let mut owned_value = 1; owned_value += 1; owned_value }
`;
  const evidence = tool.check({ compilation: { kind: "compiler", arguments: source("bindings", text) }, sources: [] });
  const bytes = Buffer.from(text);
  const named = name => evidence.occurrences.find(row => row.kind === "pattern" && row.binding !== null &&
    row.source !== null && bytes.subarray(row.source.start, row.source.end).toString("utf8").includes(name));
  assert.deepEqual(named("shared_value").binding, { mutable: false, reference: { mutable: false, pinned: false } });
  assert.deepEqual(named("mutable_value").binding, { mutable: false, reference: { mutable: true, pinned: false } });
  assert.deepEqual(named("owned_value").binding, { mutable: true, reference: null });
  assert.ok(evidence.occurrences.some(row => row.kind === "pattern" && row.adjustments.some(step => step.kind === "builtin-deref")));
  const changed = structuredClone(evidence);
  changed.occurrences.find(row => row.kind === "pattern" && row.binding !== null).binding = null;
  assert.throws(() => decodeNativeEvidence(changed, defaultRustNativeSourceLimits), /binding evidence/u);
});

test("native alternative patterns and closure captures point to canonical checked bindings", () => {
  const evidence = tool.check({ compilation: { kind: "compiler", arguments: source("canonical_bindings", `
pub fn select(input: Result<String, String>) -> impl FnOnce() -> String {
    let value = match input { Ok(value) | Err(value) => value };
    move || value
}
`) }, sources: [] });
  const bindings = evidence.occurrences.filter(row => row.kind === "pattern" && row.binding !== null);
  const canonical = new Set(bindings.filter(row => nativeNodeKey(row.id) === nativeNodeKey(row.resolution.id))
    .map(row => nativeNodeKey(row.id)));
  assert.ok(bindings.some(row => nativeNodeKey(row.id) !== nativeNodeKey(row.resolution.id)));
  for (const binding of bindings) assert.ok(canonical.has(nativeNodeKey(binding.resolution.id)));
  const captures = evidence.effects.flatMap(body => body.accesses).filter(access => access.base.kind === "capture");
  assert.ok(captures.length > 0);
  for (const capture of captures) assert.ok(canonical.has(nativeNodeKey(capture.base.binding)));
});

test("duplicated macro input retains distinct native bindings even when every source span agrees", () => {
  const text = `
macro_rules! duplicate_block { ($body:block) => { $body $body } }
pub fn observe(input: u32) {
    duplicate_block!({ let repeated = input; core::hint::black_box(repeated); });
}
`;
  const start = Buffer.byteLength(text.slice(0, text.indexOf("repeated =")), "utf8");
  const evidence = tool.check({ compilation: { kind: "compiler", arguments: source("duplicated_bindings", text) }, sources: [] });
  const bindings = evidence.occurrences.filter(row => row.kind === "pattern" && row.binding !== null &&
    row.source?.start === start && row.source.end === start + "repeated".length);
  assert.equal(bindings.length, 2);
  assert.deepEqual(bindings[0].source, bindings[1].source);
  assert.notDeepEqual(bindings[0].id, bindings[1].id);
  assert.equal(bindings[0].type, bindings[1].type);
  const flowBindings = evidence.flows.flatMap(body => body.locals.flatMap(local => local.binding === null ? [] : [local.binding]));
  for (const binding of bindings) {
    assert.deepEqual(binding.resolution, { kind: "binding", id: binding.id });
    assert.ok(evidence.occurrences.some(row => row.kind === "expression" && row.resolution?.kind === "binding" &&
      nativeNodeKey(row.resolution.id) === nativeNodeKey(binding.id)));
    assert.ok(evidence.effects.some(body => body.accesses.some(access => access.kind === "bind" &&
      access.base.kind === "local" && nativeNodeKey(access.base.binding) === nativeNodeKey(binding.id))));
    assert.ok(flowBindings.some(identity => nativeNodeKey(identity) === nativeNodeKey(binding.id)));
  }
  const changed = structuredClone(evidence);
  changed.occurrences.find(row => nativeNodeKey(row.id) === nativeNodeKey(bindings[1].id)).id = bindings[0].id;
  assert.throws(() => decodeNativeEvidence(changed, defaultRustNativeSourceLimits), /duplicate node identity/u);
});
