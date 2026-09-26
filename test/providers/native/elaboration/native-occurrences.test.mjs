import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestWorkspace } from "../../../../../tsonic/test/scripts/test-workspaces.mjs";
import { createRustNativeSourceTool, defaultRustNativeSourceLimits } from "../../../../dist/providers/native/elaboration/tool.js";
import { decodeNativeEvidence } from "../../../../dist/providers/native/elaboration/decode-evidence.js";
import { nativeDefinitionKey } from "../../../../dist/providers/native/elaboration/evidence.js";

const root = createTestWorkspace("rust-native-occurrences");
const tool = createRustNativeSourceTool({ cacheRoot: join(root, "cache") });

function source(name, text) {
  const path = join(root, `${name}.rs`);
  writeFileSync(path, text);
  return ["--edition=2024", "--crate-type=lib", path];
}

test("native occurrence selections include exact inferred and explicit generic arguments", () => {
  const evidence = tool.check(source("arguments", `
pub fn identity<Value>(value: Value) -> Value { value }
pub fn amount<const SIZE: u64>() -> u64 { SIZE }
pub fn select(input: u64) -> u64 {
    let first = identity(input);
    identity::<u64>(first) + amount::<9007199254740993>()
}
`));
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
  const evidence = tool.check(source("adjustments", `
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
`));
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
  const evidence = tool.check(source("bindings", text));
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
