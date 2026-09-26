import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestWorkspace } from "../../../../../tsonic/test/scripts/test-workspaces.mjs";
import { createRustNativeSourceTool, defaultRustNativeSourceLimits } from "../../../../dist/providers/native/elaboration/tool.js";
import { decodeNativeEvidence } from "../../../../dist/providers/native/elaboration/decode-evidence.js";
import { nativeDefinitionKey } from "../../../../dist/providers/native/elaboration/evidence.js";

const root = createTestWorkspace("rust-native-type-graph");
const tool = createRustNativeSourceTool({ cacheRoot: join(root, "cache") });

function source(name, text) {
  const path = join(root, `${name}.rs`);
  writeFileSync(path, text);
  return ["--edition=2024", "--crate-type=lib", path];
}

function selected(evidence, name) {
  const definition = evidence.definitions.find(definition => definition.name === name && definition.id.krate === 0);
  assert.ok(definition, name);
  return definition;
}

function type(evidence, id) {
  const row = evidence.types.find(type => type.id === id);
  assert.ok(row, `type ${id}`);
  return row.value;
}

function constant(evidence, id) {
  const row = evidence.constants.find(constant => constant.id === id);
  assert.ok(row, `constant ${id}`);
  return row.value;
}

test("native declaration graphs retain generic defaults, predicates and higher-ranked binders", () => {
  const arguments_ = source("generic_signatures", `
pub trait Project { type Item; fn project(&self) -> &Self::Item; }
pub struct Record<'a, Target: Project + 'a, const LENGTH: usize = 4> {
    pub owner: &'a Target,
    pub values: [Target::Item; LENGTH],
}
pub struct Defaults<Value = u8, const COUNT: usize = 7> { pub values: [Value; COUNT] }
pub type Callback = for<'scope> fn(&'scope u32) -> &'scope u32;
pub fn project<'scope, Target>(input: &'scope Target) -> &'scope Target::Item
where Target: Project, Target::Item: Copy { input.project() }
pub fn higher<Callback>(callback: Callback) where Callback: for<'scope> Fn(&'scope u32) -> &'scope u32 { let _ = callback; }
`);
  for (const evidence of [tool.declarations(arguments_), tool.check(arguments_)]) {
    const record = selected(evidence, "Record");
    assert.deepEqual(record.generics.parameters.map(parameter => parameter.value.kind), ["lifetime", "type", "constant"]);
    const length = record.generics.parameters[2];
    assert.deepEqual(type(evidence, length.value.type), { kind: "primitive", name: "usize" });
    assert.notEqual(length.value.default, null);
    const defaults = selected(evidence, "Defaults").generics.parameters;
    assert.deepEqual(type(evidence, defaults[0].value.default), { kind: "primitive", name: "u8" });
    assert.notEqual(defaults[1].value.default, null);
    const callback = type(evidence, selected(evidence, "Callback").type);
    assert.equal(callback.kind, "function-pointer");
    assert.deepEqual(callback.signature.variables.map(variable => variable.kind), ["lifetime"]);
    const input = type(evidence, callback.signature.value.inputs[0]);
    const output = type(evidence, callback.signature.value.output);
    assert.equal(input.region.kind, "bound");
    assert.deepEqual(input.region, output.region);
    const project = selected(evidence, "project");
    assert.ok(project.generics.predicates.some(predicate => predicate.value.kind === "trait"));
    assert.ok(record.generics.predicates.some(predicate => predicate.value.kind === "type-outlives"));
    assert.ok(evidence.types.some(type => type.value.kind === "alias" && type.value.alias.category === "projection"));
    const higher = selected(evidence, "higher").generics.predicates;
    assert.ok(higher.some(predicate => predicate.variables.some(variable => variable.kind === "lifetime")));
    const declarations = new Map(evidence.definitions.map(definition => [nativeDefinitionKey(definition.id), definition]));
    for (const definition of evidence.definitions) {
      for (const parameter of definition.generics?.parameters ?? []) assert.ok(declarations.has(nativeDefinitionKey(parameter.definition)));
    }
    assert.ok(Object.isFrozen(record.generics.parameters));
  }
});

test("exact 64/128-bit const arguments never pass through JSON numbers", () => {
  const evidence = tool.declarations(source("wide_constants", `
pub struct Wide<const VALUE: u128>;
pub struct Holder {
    pub first: Wide<9007199254740993>,
    pub last: Wide<340282366920938463463374607431768211455>,
    pub empty: [(); 9007199254740993],
}
`));
  for (const [name, bits] of [["first", "9007199254740993"], ["last", "340282366920938463463374607431768211455"]]) {
    const field = type(evidence, selected(evidence, name).type);
    assert.equal(field.kind, "adt");
    assert.equal(field.arguments[0].kind, "constant");
    const value = constant(evidence, field.arguments[0].id);
    assert.equal(value.kind, "scalar");
    assert.equal(value.bytes, 16);
    assert.equal(value.bits, bits);
  }
  const empty = type(evidence, selected(evidence, "empty").type);
  assert.equal(empty.kind, "array");
  assert.equal(constant(evidence, empty.length).bits, "9007199254740993");
});

test("native object traits, recursive types and coroutine closures close one graph", () => {
  const evidence = tool.check(source("recursive_closures", `
pub trait Named { fn name(&self) -> &str; }
pub struct Link { pub next: Option<Box<Link>> }
pub fn name(input: &(dyn Named + Send)) -> &str { input.name() }
pub fn callbacks() {
    let callback = async |value: u32| value + 1;
    let _future = callback(3);
    let plain = |value: u32| value * 2;
    let _result = plain(5);
}
`));
  for (const kind of ["dynamic", "closure", "coroutine-closure", "coroutine"]) {
    assert.ok(evidence.types.some(type => type.value.kind === kind), kind);
  }
  const dynamic = evidence.types.find(type => type.value.kind === "dynamic").value;
  assert.ok(dynamic.predicates.some(predicate => predicate.value.kind === "trait"));
  assert.ok(dynamic.predicates.some(predicate => predicate.value.kind === "auto-trait"));
  assert.equal(new Set(evidence.types.map(type => type.id)).size, evidence.types.length);
  assert.equal(new Set(evidence.constants.map(constant => constant.id)).size, evidence.constants.length);
});

test("nested semantic references, sorts and bound signatures reject mutation", () => {
  const evidence = tool.declarations(source("nested_mutations", `
pub trait Read { type Value; }
pub struct Data<T: Read, const LENGTH: usize = 8> { pub bytes: [u8; LENGTH], pub value: T::Value }
pub fn callback(input: for<'a> fn(&'a u32) -> &'a u32) { let _ = input; }
pub struct Scalar { pub bytes: [u8; 16] }
`));
  const mutations = [
    value => { value.types.find(row => row.value.kind === "array").value.element = 0xffff_ffff; },
    value => { value.types.find(row => row.value.kind === "array").value.length = 0xffff_ffff; },
    value => { value.types.find(row => row.value.kind === "adt").value.definition = selected(value, "callback").id; },
    value => { value.types.find(row => row.value.kind === "alias").value.alias.sort = "constant"; },
    value => { value.types.find(row => row.value.kind === "function-pointer").value.signature.value.output = 0xffff_ffff; },
    value => { value.types.find(row => row.value.kind === "function-pointer").value.signature.variables[0].kind = "guessed"; },
    value => { selected(value, "Data").generics.parameters[0].index += 1; },
    value => { selected(value, "Data").generics.parentCount = 1; },
    value => { selected(value, "Data").generics.parameters[1].value.type = 0xffff_ffff; },
    value => { selected(value, "Data").generics.parameters[1].value.default = 0xffff_ffff; },
    value => { selected(value, "Data").generics.predicates[0].value.kind = "unchecked"; },
    value => { value.constants.push(value.constants[0]); },
    value => { value.constants.find(row => row.value.kind === "scalar").value.bits = "18446744073709551616"; },
    value => { value.constants.find(row => row.value.kind === "scalar").value.bits = 16; },
    value => { value.types[0].value = { kind: "unknown" }; },
    value => { value.types[0].kind = "old-opaque-graph"; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const corrupted = structuredClone(evidence);
    mutate(corrupted);
    assert.throws(() => decodeNativeEvidence(corrupted, defaultRustNativeSourceLimits), /Native Rust/u, `mutation ${index}`);
  }
  assert.throws(() => decodeNativeEvidence(evidence, { ...defaultRustNativeSourceLimits, maximumRows: 4 }), /row limit/u);
});
