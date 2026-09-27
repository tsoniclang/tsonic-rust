import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestWorkspace } from "../../../../../tsonic/test/scripts/test-workspaces.mjs";
import { createRustNativeSourceTool, defaultRustNativeSourceLimits } from "../../../../dist/providers/native/elaboration/tool.js";
import { decodeNativeEvidence } from "../../../../dist/providers/native/elaboration/decode-evidence.js";
import { nativeDefinitionKey } from "../../../../dist/providers/native/elaboration/evidence.js";

const root = createTestWorkspace("rust-native-scopes");
const tool = createRustNativeSourceTool({ cacheRoot: join(root, "cache") });
const same = (left, right) => nativeDefinitionKey(left) === nativeDefinitionKey(right);

function source(name, text) {
  const path = join(root, `${name}.rs`);
  writeFileSync(path, text);
  return ["--edition=2024", "--crate-type=lib", path];
}

function definition(evidence, name, kind) {
  const selected = evidence.definitions.find(row => row.id.krate === 0 && row.name === name && (kind === undefined || row.kind === kind));
  assert.ok(selected, `${kind ?? "definition"} ${name}`);
  return selected;
}

function scope(evidence, owner) {
  const selected = evidence.scopes.find(row => same(row.owner, owner.id));
  assert.ok(selected, owner.path);
  return selected;
}

test("native effective scopes retain aliases, namespace facets, visibility and exact reexports", () => {
  const arguments_ = source("aliases", `
pub mod definitions {
    pub struct Pair(pub u32);
    pub struct Record { pub value: u32, pub(crate) internal: u32, hidden: u32 }
    pub fn same() -> u32 { 7 }
    macro_rules! same { () => { 7_u32 }; }
    pub(crate) use same;
    pub mod nested { pub(super) fn limited() {} }
}
pub use definitions::Pair as Alias;
pub mod exported { pub use crate::definitions::*; }
pub fn verify(value: Alias) -> u32 { definitions::same!() + definitions::same() + value.0 }
`);
  for (const evidence of [tool.declarations(arguments_), tool.check(arguments_)]) {
    const rootScope = scope(evidence, evidence.definitions.find(row => row.id.krate === 0 && row.parent === null));
    const aliases = rootScope.bindings.filter(binding => binding.name === "Alias");
    assert.deepEqual(aliases.map(binding => binding.namespace).sort(), ["type", "value"]);
    assert.notDeepEqual(aliases[0].resolution.definition, aliases[1].resolution.definition);
    for (const alias of aliases) {
      assert.equal(alias.visibility.kind, "public");
      assert.ok(alias.reexports.some(step => step.kind === "single"));
      assert.ok(alias.source);
    }
    const definitions = definition(evidence, "definitions", "module");
    assert.deepEqual(scope(evidence, definitions).bindings.filter(binding => binding.name === "same").map(binding => binding.namespace).sort(), ["macro", "value"]);
    const hidden = definition(evidence, "hidden", "field");
    assert.equal(hidden.visibility.kind, "restricted");
    assert.deepEqual(hidden.visibility.module, definitions.id);
    assert.equal(definition(evidence, "value", "field").visibility.kind, "public");
    const internal = definition(evidence, "internal", "field");
    assert.equal(internal.visibility.kind, "restricted");
    assert.deepEqual(internal.visibility.module, rootScope.owner);
    assert.deepEqual(definition(evidence, "limited", "function").visibility.module, definitions.id);
    const exported = scope(evidence, definition(evidence, "exported", "module"));
    assert.ok(exported.bindings.some(binding => binding.name === "Pair" && binding.reexports.some(step => step.kind === "glob")));
    assert.ok(Object.isFrozen(exported.bindings));
  }
});

test("ambiguous native glob imports remain ambiguity evidence rather than a selected definition", () => {
  const evidence = tool.declarations(source("ambiguous", `
pub mod left { pub struct Value; }
pub mod right { pub struct Value; }
pub mod joined { pub use crate::left::*; pub use crate::right::*; }
`));
  const joined = scope(evidence, definition(evidence, "joined", "module"));
  assert.ok(!joined.bindings.some(binding => binding.name === "Value"));
  const matches = joined.ambiguities.filter(row => row.main.name === "Value");
  assert.deepEqual(matches.map(row => row.main.namespace).sort(), ["type", "value"]);
  for (const ambiguity of matches) {
    assert.equal(ambiguity.main.name, ambiguity.second.name);
    assert.notDeepEqual(ambiguity.main.resolution.definition, ambiguity.second.resolution.definition);
    assert.ok(ambiguity.main.reexports.some(row => row.kind === "glob"));
    assert.ok(ambiguity.second.reexports.some(row => row.kind === "glob"));
  }
});

test("native implementation evidence binds generic self types and exact trait members before bodies", () => {
  const arguments_ = source("implementations", `
pub trait Read<T> { type Output; const COUNT: usize; fn read(&self) -> &Self::Output; }
pub struct Record<T> { value: T }
impl<T> Record<T> { pub fn create(value: T) -> Self { Self { value } } pub(crate) fn value(&self) -> &T { &self.value } }
impl<T> Read<T> for Record<T> {
    type Output = T;
    const COUNT: usize = 1;
    fn read(&self) -> &T { &self.value }
}
pub fn invalid() -> u32 { "not an integer" }
`);
  const evidence = tool.declarations(arguments_);
  const implementations = evidence.scopes.filter(row => row.kind === "implementation");
  assert.equal(implementations.length, 2);
  const trait = definition(evidence, "Read", "trait");
  const record = definition(evidence, "Record", "struct");
  for (const implementation of implementations) {
    const self = evidence.types.find(row => row.id === implementation.selfType).value;
    assert.equal(self.kind, "adt");
    assert.deepEqual(self.definition, record.id);
    assert.equal(self.arguments[0].kind, "type");
    if (implementation.trait === null) {
      assert.ok(implementation.members.every(member => member.traitMember === null));
    } else {
      assert.deepEqual(implementation.trait.definition, trait.id);
      assert.equal(implementation.trait.polarity, "positive");
      assert.equal(implementation.trait.safety, "safe");
      assert.equal(implementation.trait.constness, "ordinary");
      assert.equal(implementation.members.length, 3);
      for (const member of implementation.members) {
        const selected = evidence.definitions.find(row => same(row.id, member.traitMember));
        assert.deepEqual(selected.parent, trait.id);
      }
    }
  }
  assert.throws(() => tool.check(arguments_), /mismatched types/u);
});

test("native generated modules expose compiler-resolved members and nested scopes", () => {
  const evidence = tool.check(source("generated", `
macro_rules! declare {
    () => { pub mod generated {
        pub struct Value(pub u32);
        impl Value { pub fn get(&self) -> u32 { self.0 } }
        pub use Value as Visible;
    } };
}
declare!();
pub fn read() -> u32 { generated::Visible(7).get() }
`));
  const generated = scope(evidence, definition(evidence, "generated", "module"));
  assert.equal(generated.bindings.filter(binding => binding.name === "Visible").length, 2);
  assert.ok(generated.bindings.some(binding => binding.source.context.length > 0));
  assert.ok(evidence.scopes.some(row => row.kind === "implementation" && row.members.some(member =>
    same(member.definition, definition(evidence, "get", "associated-function").id))));
});

test("native scope mutation controls preserve namespace, visibility, membership and ambiguity boundaries", () => {
  const evidence = tool.declarations(source("scope_mutations", `
pub trait Read { fn read(&self) -> u32; }
pub struct Record;
impl Read for Record { fn read(&self) -> u32 { 1 } }
pub mod source { pub struct Value; }
pub use source::Value as Alias;
`));
  const implementation = value => value.scopes.find(row => row.kind === "implementation");
  const alias = value => value.scopes.flatMap(row => row.kind === "named" ? row.bindings : []).find(row => row.name === "Alias");
  for (const mutate of [
    value => { value.scopes.push(value.scopes[0]); },
    value => { alias(value).namespace = "macro"; },
    value => { alias(value).resolution.definition.index = 0xffff_ffff; },
    value => { alias(value).visibility = { kind: "restricted", module: definition(value, "Record", "struct").id }; },
    value => { alias(value).reexports[0].definition = definition(value, "Record", "struct").id; },
    value => { alias(value).source.context.push({ expansion: { krate: 0, index: 0xffff_ffff }, transparency: "opaque" }); },
    value => { implementation(value).selfType = 0xffff_ffff; },
    value => { implementation(value).trait = null; },
    value => { implementation(value).members[0].traitMember = null; },
    value => { implementation(value).members.push(implementation(value).members[0]); },
    value => { implementation(value).members[0].definition = implementation(value).members[0].traitMember; },
    value => { implementation(value).trait.arguments.push({ kind: "type", id: 0xffff_ffff }); },
    value => { value.scopes.find(row => row.kind === "named").unexpected = true; },
  ]) {
    const corrupted = structuredClone(evidence);
    mutate(corrupted);
    assert.throws(() => decodeNativeEvidence(corrupted, defaultRustNativeSourceLimits), /Native Rust/u);
  }
  assert.throws(() => decodeNativeEvidence(evidence, { ...defaultRustNativeSourceLimits, maximumRows: 5 }), /row limit/u);
});
