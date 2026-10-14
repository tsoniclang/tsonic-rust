import assert from "node:assert/strict";
import test from "node:test";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";
import { recordCallableReturnFact } from "../../../../dist/analysis/callables/signatures.js";
import { isRustUnitCarrier, rustCallableTargetType } from "../../../../dist/target-model/types/index.js";

const integer = { kind: "source-primitive", name: "int32" };
const text = { kind: "target-named", id: "rust.std.String" };
const families = [
  ["typeOnlyDeclaration", "typeOnlyDeclarations"],
  ["moduleBinding", "moduleBindings"],
  ["moduleCallableStorage", "moduleCallableStoragePlans"],
  ["sourceCallableReturn", "sourceCallableReturns"],
  ["capturedFieldStorage", "capturedFieldStoragePlans"],
];

test("all five declaration and callable families expose one immutable reader and no general writer", () => {
  const builder = createRustProgramRecordBuilder();
  const sealed = builder.seal();
  for (const [family, producer] of families) {
    assert.equal(builder[producer].records === builder[family], true, family);
    assert.equal(builder[family] === sealed[family], true, family);
    assert.equal(Object.isFrozen(sealed[family]), true, family);
    assert.deepEqual(Object.keys(sealed[family]), ["get"], family);
    assert.equal(sealed[family].get(undefined) === undefined, true, family);
    assert.equal(sealed[family].get({}) === undefined, true, family);
    assert.equal(builder[family].set === undefined, true, family);
    assert.equal(sealed[producer] === undefined, true, family);
  }
  const subject = {};
  const value = { name: "step", carrier: rustCallableTargetType([], integer), parameterCarriers: [], resultCarrier: integer };
  for (const attempt of [
    () => builder.typeOnlyDeclarations.finalize({}, []),
    () => builder.typeOnlyDeclarations.representationAliases({}, []),
    () => builder.moduleBindings.value({}, subject, "const", integer),
    () => builder.moduleBindings.function(subject, "step", value),
    () => builder.moduleBindings.callable(subject, subject, "step", undefined),
    () => builder.moduleBindings.defaultExport(subject, integer),
    () => builder.moduleCallableStoragePlans.finalize({}),
    () => builder.sourceCallableReturns.resolve({}, subject),
    () => builder.sourceCallableReturns.setter(subject),
    () => builder.capturedFieldStoragePlans.resolve({}, subject, integer),
  ]) assert.throws(attempt, /after analysis is sealed/u);
});

test("module value admission uses the existing declaration classifier and exact source inputs", () => {
  const builder = createRustProgramRecordBuilder();
  const subject = {};
  const selected = { storage: "module-cell", declarationKind: "let", initialization: "declaration", valueCarrier: text };
  let calls = 0;
  const walk = { moduleBindings: { classifyValue(declaration, kind, carrier) {
    assert.equal(declaration === subject, true);
    assert.equal(kind, "let");
    assert.equal(carrier === text, true);
    calls++;
    return selected;
  } } };
  builder.moduleBindings.value(walk, subject, "let", text);
  assert.equal(calls, 1);
  assert.equal(builder.moduleBinding.get(subject) === selected, true, "the selected physical storage remains exact");
  assert.equal(builder.minimumFoundation(), "core", "this family adds no competing carrier accounting");
  const absent = {};
  builder.moduleBindings.value({ moduleBindings: { classifyValue: () => undefined } }, absent, "const", integer);
  assert.equal(builder.moduleBinding.get(absent) === undefined, true);
});

test("module callable and default constructors retain the complete native ABI and declaration identities", () => {
  const builder = createRustProgramRecordBuilder();
  const declaration = {};
  const implementation = {};
  const callable = { name: "step_value", carrier: rustCallableTargetType([integer], text), parameterCarriers: [integer], resultCarrier: text };
  builder.moduleBindings.function(declaration, "step", callable);
  const hoisted = builder.moduleBinding.get(declaration);
  assert.equal(hoisted.declarationKind, "function");
  assert.equal(hoisted.storage, "native-callable");
  assert.equal(hoisted.callableDeclaration === declaration, true);
  assert.equal(hoisted.value === callable, true);
  builder.moduleBindings.callable(implementation, declaration, "step", callable);
  assert.equal(builder.moduleBinding.get(implementation).callableDeclaration === declaration, true);
  assert.equal(builder.moduleBinding.get(implementation).declarationKind, "const");
  const unobserved = {};
  builder.moduleBindings.callable(unobserved, implementation, "native_step", undefined);
  assert.equal(Object.hasOwn(builder.moduleBinding.get(unobserved), "value"), false);
  const exported = {};
  builder.moduleBindings.defaultExport(exported, integer);
  assert.equal(builder.moduleBinding.get(exported).storage, "module-cell");
  assert.equal(builder.moduleBinding.get(exported).initialization, "value");
  assert.equal(builder.moduleBinding.get(exported).valueCarrier === integer, true);
});

test("module callable inherited equality compares every physical ABI member without publishing over its parent", () => {
  const parent = createRustProgramRecordBuilder();
  const subject = {};
  const value = { name: "value", carrier: rustCallableTargetType([integer], text), parameterCarriers: [integer], resultCarrier: text };
  parent.moduleBindings.function(subject, "implementation", value);
  const original = parent.moduleBinding.get(subject);
  const sealed = parent.seal();
  const child = createRustProgramRecordBuilder(undefined, sealed);
  child.moduleBindings.function(subject, "implementation", { ...value, parameterCarriers: [{ ...integer }] });
  assert.equal(child.moduleBinding.get(subject) === original, true);
  const conflicts = [
    () => child.moduleBindings.function(subject, "other", value),
    () => child.moduleBindings.callable(subject, {}, "implementation", value),
    ...[{ ...value, name: "other" }, { ...value, carrier: text }, { ...value, parameterCarriers: [] },
      { ...value, parameterCarriers: [text] }, { ...value, resultCarrier: integer }].map(changed =>
      () => child.moduleBindings.function(subject, "implementation", changed)),
    () => child.moduleBindings.defaultExport(subject, integer),
  ];
  for (const write of conflicts) {
    assert.throws(write, /Conflicting Rust semantic plan 'tsonic\.rust\.moduleBinding'/u);
    assert.equal(child.moduleBinding.get(subject) === original, true);
  }
  const fresh = {};
  child.moduleBindings.defaultExport(fresh, integer);
  assert.equal(sealed.moduleBinding.get(fresh) === undefined, true);
});

test("module value conflicts retain const/cell kind, initialization and exact integer width", () => {
  const builder = createRustProgramRecordBuilder();
  const subject = {};
  const original = { declarationKind: "let", storage: "module-cell", initialization: "declaration", valueCarrier: integer };
  const admit = value => builder.moduleBindings.value({ moduleBindings: { classifyValue: () => value } }, subject, "let", integer);
  admit(original);
  admit({ ...original, valueCarrier: { ...integer } });
  for (const changed of [{ ...original, declarationKind: "var" }, { ...original, initialization: "value" },
    { ...original, valueCarrier: { kind: "source-primitive", name: "int64" } },
    { declarationKind: "const", storage: "native-const", valueCarrier: integer }]) {
    assert.throws(() => admit(changed), /Conflicting Rust semantic plan/u);
    assert.equal(builder.moduleBinding.get(subject) === original, true);
  }
});

test("complete return queries reuse inherited facts and setters preserve native unit results", () => {
  const parent = createRustProgramRecordBuilder();
  const declaration = {};
  assert.equal(parent.sourceCallableReturns.inferred === undefined, true, "the incomplete constructor is removed");
  parent.sourceCallableReturns.setter(declaration);
  const original = parent.sourceCallableReturn.get(declaration);
  const child = createRustProgramRecordBuilder(undefined, parent.seal());
  const noSelection = new Proxy({}, { get() { throw new Error("the complete inherited query must be a lookup"); } });
  assert.equal(child.sourceCallableReturns.resolve(noSelection, declaration), true);
  child.sourceCallableReturns.setter(declaration);
  assert.equal(child.sourceCallableReturn.get(declaration) === original, true);
  const setter = {};
  child.sourceCallableReturns.setter(setter);
  assert.equal(isRustUnitCarrier(child.sourceCallableReturn.get(setter).returnCarrier), true);
  assert.deepEqual(child.sourceCallableReturn.get(setter).returnCarrier, { kind: "tuple", elements: [] });
  assert.equal(parent.sourceCallableReturn.get(setter) === undefined, true);
  child.seal();
  assert.equal(child.sourceCallableReturns.inferred === undefined, true);
});

test("missing suspension evidence rejects through the actual source-return producer before source inspection", () => {
  for (const [label, asynchronous, generator] of [["async", true, false], ["generator", false, true], ["async-generator", true, true]]) {
    const builder = createRustProgramRecordBuilder();
    const declaration = {};
    const walk = { context: { records: builder, ast: { hasModifierKind: () => asynchronous },
      semanticsFor: () => ({ operations: { generator: () => generator ? {} : undefined } }) } };
    assert.equal(recordCallableReturnFact(walk, declaration), false, label);
    assert.equal(builder.sourceCallableReturn.get(declaration) === undefined, true, label);
  }
});

function capturedField(builder, { carrier = integer, captured = true, readonly = false, deferred = false, immutable = false } = {}) {
  const declaration = {};
  const captures = { isCaptured: () => captured, storageDeclaration: () => declaration,
    storageReadonly: () => readonly, isDeferred: () => deferred, storageImmutable: () => immutable };
  const walk = { context: { records: builder, objectRepresentations: { receiverCaptures: captures } } };
  return { declaration, walk, resolve: () => builder.capturedFieldStoragePlans.resolve(walk, declaration, carrier) };
}

for (const [name, input, kind, initialization] of [
  ["immutable scalar", { readonly: true, immutable: true }, "copy", "ready"],
  ["mutable scalar", {}, "cell", "ready"],
  ["immutable owned value", { carrier: text, readonly: true, immutable: true }, "shared", "ready"],
  ["mutable owned value", { carrier: text }, "borrow-cell", "ready"],
  ["deferred immutable scalar", { readonly: true, immutable: true, deferred: true }, "shared", "deferred"],
]) test(`captured field producer preserves the native ${name} representation`, () => {
  const builder = createRustProgramRecordBuilder();
  const selected = capturedField(builder, input);
  selected.resolve();
  const fact = builder.capturedFieldStorage.get(selected.declaration);
  assert.equal(fact.valueCarrier === (input.carrier ?? integer), true);
  assert.equal(fact.storage.kind, kind);
  assert.equal(fact.storage.initialization, initialization);
  assert.equal(Object.isFrozen(fact.storage), true);
  assert.equal(builder.minimumFoundation(), "core", "native storage selection does not double-account its carrier");
  selected.resolve();
  assert.equal(builder.capturedFieldStorage.get(selected.declaration) === fact, true);
  const noSelection = new Proxy({}, { get() { throw new Error("captured storage was already selected"); } });
  builder.capturedFieldStoragePlans.resolve({ context: { objectRepresentations: noSelection } },
    selected.declaration, { ...fact.valueCarrier });
  assert.equal(builder.capturedFieldStorage.get(selected.declaration) === fact, true, "same complete native field query is a lookup");
  builder.seal();
  assert.throws(selected.resolve, /after analysis is sealed/u);
});

test("uncaptured fields do not manufacture storage and inherited captures keep their exact carrier and identity", () => {
  const parent = createRustProgramRecordBuilder();
  const absent = capturedField(parent, { captured: false });
  absent.resolve();
  assert.equal(parent.capturedFieldStorage.get(absent.declaration) === undefined, true);
  const selected = capturedField(parent);
  selected.resolve();
  const fact = parent.capturedFieldStorage.get(selected.declaration);
  const child = createRustProgramRecordBuilder(undefined, parent.seal());
  child.capturedFieldStoragePlans.resolve(selected.walk, selected.declaration, { ...integer });
  assert.equal(child.capturedFieldStorage.get(selected.declaration) === fact, true);
  assert.throws(() => child.capturedFieldStoragePlans.resolve(selected.walk, selected.declaration, text), /Conflicting Rust semantic plan/u);
  assert.equal(child.capturedFieldStorage.get(selected.declaration) === fact, true);
});

test("an unavailable captured-field query stays retryable until its receiver evidence is complete", () => {
  const builder = createRustProgramRecordBuilder();
  const selected = capturedField(builder, { captured: false });
  selected.resolve();
  assert.equal(builder.capturedFieldStorage.get(selected.declaration) === undefined, true);
  selected.walk.context.objectRepresentations.receiverCaptures.isCaptured = () => true;
  selected.resolve();
  assert.equal(builder.capturedFieldStorage.get(selected.declaration) !== undefined, true,
    "an earlier unavailable query must not be cached as completed");
});

function ambientFixture(builder, { malformed = false, runtime = false } = {}) {
  const file = { kind: "KindSourceFile" };
  const statement = { kind: "KindVariableStatement", parent: file };
  const declaration = { kind: "KindVariableDeclaration", parent: statement };
  const list = { kind: "KindVariableDeclarationList", Declarations: { Nodes: malformed ? [undefined] : [declaration] } };
  const reference = { kind: "KindIdentifier", parent: file };
  const events = [];
  const ast = { statements: () => [statement], parent: node => node.parent, kindName: node => node?.kind,
    hasModifierKind: () => true, is: { IsVariableStatement: node => node === statement,
      IsVariableDeclarationList: node => node === list, IsSourceFile: node => node === file },
    as: { AsVariableStatement: () => ({ DeclarationList: list }), AsVariableDeclarationList: () => list } };
  const walk = { context: { ast, records: builder, diagnostics: [], typeFamilies: { families: () => [] },
    source: { navigation: { declarationUses(subject) {
      assert.equal(subject === declaration, true);
      events.push(builder.typeOnlyDeclaration.get(statement)?.reason);
      assert.equal(builder.typeOnlyDeclaration.get(declaration) === undefined, true, "use diagnostics precede declaration admission");
      return runtime ? [{ kind: "first-class", reference }] : [{ kind: "type-only", reference }];
    } } } }, rejectedExpressions: new WeakSet(), resolving: new Set() };
  return { file, statement, declaration, reference, walk, events, list };
}

test("ambient finalization preserves statement admission, then diagnostics, then declaration admission", () => {
  const builder = createRustProgramRecordBuilder();
  const selected = ambientFixture(builder, { runtime: true });
  builder.typeOnlyDeclarations.finalize(selected.walk, [selected.file]);
  assert.deepEqual(selected.events, ["ambient"]);
  assert.equal(builder.typeOnlyDeclaration.get(selected.declaration).reason, "ambient");
  const diagnostics = selected.walk.context.diagnostics;
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, "RUST_AMBIENT_VALUE_IMPLEMENTATION_MISSING");
  assert.equal(diagnostics[0].sourceNode === selected.reference, true);
  assert.equal(selected.walk.rejectedExpressions.has(selected.reference), true);
  builder.typeOnlyDeclarations.finalize(selected.walk, [selected.file]);
  assert.deepEqual(selected.events, ["ambient"], "a complete ambient query does not recheck uses");
  assert.equal(diagnostics.length, 1, "the original diagnostic is not duplicated");
});

test("malformed ambient declarations retain the original early statement admission and invariant refusal", () => {
  const builder = createRustProgramRecordBuilder();
  const selected = ambientFixture(builder, { malformed: true });
  assert.throws(() => builder.typeOnlyDeclarations.finalize(selected.walk, [selected.file]),
    /Ambient declaration analysis received an incomplete checked declaration list/u);
  assert.equal(builder.typeOnlyDeclaration.get(selected.statement).reason, "ambient");
  assert.equal(builder.typeOnlyDeclaration.get(selected.declaration) === undefined, true);
  assert.equal(selected.walk.context.diagnostics.length, 0);
});

test("an incomplete ambient query retains its earlier statement fact and can finish without re-admission", () => {
  const builder = createRustProgramRecordBuilder();
  const selected = ambientFixture(builder, { malformed: true });
  assert.throws(() => builder.typeOnlyDeclarations.finalize(selected.walk, [selected.file]),
    /Ambient declaration analysis received an incomplete checked declaration list/u);
  const statement = builder.typeOnlyDeclaration.get(selected.statement);
  selected.list.Declarations.Nodes = [selected.declaration];
  builder.typeOnlyDeclarations.finalize(selected.walk, [selected.file]);
  assert.equal(builder.typeOnlyDeclaration.get(selected.statement) === statement, true);
  assert.equal(builder.typeOnlyDeclaration.get(selected.declaration).reason, "ambient");
  assert.deepEqual(selected.events, ["ambient"]);
  builder.typeOnlyDeclarations.finalize(selected.walk, [selected.file]);
  assert.deepEqual(selected.events, ["ambient"], "only complete finalization is cached");
});
