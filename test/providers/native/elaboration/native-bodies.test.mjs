import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestWorkspace } from "../../../../../tsonic/test/scripts/test-workspaces.mjs";
import { repositoryRoot } from "../../../helpers/rust-session/paths.mjs";
import { createRustNativeSourceTool } from "../../../../dist/providers/native/elaboration/tool.js";
import { createRustNativeBodyQueries } from "../../../../dist/providers/native/elaboration/body-queries.js";
import { nativeDefinitionKey, nativeNodeKey } from "../../../../dist/providers/native/elaboration/evidence.js";

const root = createTestWorkspace(join(repositoryRoot, ".temp/generated"), "rust-native-bodies-");
const tool = createRustNativeSourceTool({ cacheRoot: join(root, "cache") });

function program(name, source, phase = "check") {
  const path = join(root, `${name}.rs`);
  writeFileSync(path, source);
  const evidence = tool[phase]({ compilation: { kind: "compiler", directory: root,
    arguments: ["--edition=2024", "--crate-type=lib", path] } });
  const queries = createRustNativeBodyQueries(evidence);
  const original = Buffer.from(source);
  const text = occurrence => occurrence.source?.file === path
    ? original.subarray(occurrence.source.start, occurrence.source.end).toString("utf8") : undefined;
  const local = name => {
    const selected = evidence.bodies.flatMap(body => body.locals).filter(local => text(queries.pattern(local)) === name);
    assert.equal(selected.length, 1, `Expected exactly one declaration for '${name}'.`);
    return selected[0];
  };
  const type = occurrence => evidence.types.find(row => row.id === occurrence.type)?.value;
  return { evidence, queries, text, local, type };
}

for (const phase of ["typing", "check"]) {
  test(`native ${phase} selects macro result types through actual initializer relationships`, () => {
    const { evidence, queries, local, type } = program(`results_${phase}`, `
macro_rules! owned { () => { String::from("value") } }
macro_rules! nested { () => { owned!() } }
macro_rules! identity { ($value:expr) => { $value } }
macro_rules! twice { ($value:expr) => { $value + $value } }
macro_rules! discard { ($value:expr) => { 31_u64 } }
macro_rules! record { () => { { struct Local { length: u64 } Local { length: 9 } } } }
macro_rules! empty { () => { Vec::new() } }
pub fn value() -> u64 { 9007199254740993 }
pub fn string_identity(value: String) -> String { value }
pub fn observe() -> usize {
    let string_result = owned!();
    let nested_result = nested!();
    let identity_result = identity!(value());
    let twice_result = twice!(value());
    let discarded_result = discard!(missing());
    let record_result = record!();
    let mut constrained_result = empty!();
    constrained_result.push(18446744073709551615_u64);
    string_result.len() + nested_result.len() + constrained_result.len()
        + (identity_result + twice_result + discarded_result + record_result.length) as usize
}
`, phase);
    const stringType = type(queries.initializer(local("string_result")));
    assert.equal(stringType.kind, "adt");
    const control = evidence.definitions.find(row => row.name === "string_identity" && row.id.krate === 0);
    const controlBody = evidence.bodies.find(body => nativeDefinitionKey(body.owner) === nativeDefinitionKey(control.id));
    assert.deepEqual(stringType, type(queries.parameters(controlBody)[0]));
    assert.deepEqual(stringType, type(queries.result(controlBody)));
    assert.deepEqual(type(queries.initializer(local("nested_result"))), stringType);
    for (const name of ["identity_result", "twice_result", "discarded_result"]) {
      assert.deepEqual(type(queries.initializer(local(name))), { kind: "primitive", name: "u64" });
    }
    const recordType = type(queries.initializer(local("record_result")));
    assert.equal(recordType.kind, "adt");
    assert.notDeepEqual(recordType.definition, stringType.definition);
    assert.equal(evidence.definitions.find(row => nativeDefinitionKey(row.id) === nativeDefinitionKey(recordType.definition)).name, "Local");
    const vectorType = type(queries.initializer(local("mut constrained_result")));
    assert.equal(vectorType.kind, "adt");
    assert.deepEqual(evidence.types.find(row => row.id === vectorType.arguments[0].id).value, { kind: "primitive", name: "u64" });
    const repeated = queries.children(queries.initializer(local("twice_result")));
    assert.equal(repeated.length, 2);
    assert.deepEqual(repeated[0].source, repeated[1].source);
    assert.notEqual(nativeNodeKey(repeated[0].id), nativeNodeKey(repeated[1].id));
    for (const occurrence of evidence.occurrences) {
      const parent = queries.parent(occurrence);
      if (parent !== undefined) assert.ok(queries.children(parent).includes(occurrence));
    }
  });
}

test("native body roots distinguish closure, constant and function contexts and exact nested patterns", () => {
  const { evidence, queries, local, type } = program("body_owners", `
pub fn produce((input, enabled): (u64, bool)) -> impl FnOnce() -> u64 {
    let (first, second) = (input, const { 3_u64 });
    let delayed;
    delayed = first + second;
    let closure = move || { let captured = delayed; if enabled { captured } else { 0 } };
    closure
}
pub fn condition(value: Option<u64>) -> u64 {
    let Some(selected) = value else { return 0; };
    selected
}
`);
  assert.equal(queries.initializer(local("delayed")), undefined);
  const owners = evidence.bodies.map(body => evidence.definitions.find(row =>
    nativeDefinitionKey(row.id) === nativeDefinitionKey(body.owner)));
  assert.ok(owners.some(owner => owner.kind === "closure"));
  assert.ok(owners.some(owner => owner.kind === "inline-constant"));
  const closure = evidence.bodies.find(body => evidence.definitions.find(row =>
    nativeDefinitionKey(row.id) === nativeDefinitionKey(body.owner))?.kind === "closure");
  assert.deepEqual(type(queries.result(closure)), { kind: "primitive", name: "u64" });
  assert.equal(queries.parameters(closure).length, 0);
  const produce = evidence.bodies.find(body => evidence.definitions.find(row =>
    nativeDefinitionKey(row.id) === nativeDefinitionKey(body.owner))?.name === "produce");
  const parameter = queries.parameters(produce)[0];
  assert.equal(parameter.kind, "pattern");
  assert.equal(queries.children(parameter).length, 2);
  const captured = local("captured");
  assert.equal(nativeDefinitionKey(captured.id.owner), nativeDefinitionKey(produce.owner));
  assert.ok(closure.locals.includes(captured));
  assert.ok(!produce.locals.includes(captured));
  assert.deepEqual(type(queries.initializer(captured)), { kind: "primitive", name: "u64" });
});
