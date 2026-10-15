import assert from "node:assert/strict";
import { assertRustInheritedRecordConflict, assertRustInheritedRecordCorrespondence } from "../../../helpers/records.mjs";
import test from "node:test";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";

const cases = [
  ["compileTimeSource", "compileTimeSources", (builder, node) => builder.compileTimeSources.erase(node)],
  ["selfMode", "selfModes", (builder, node) => builder.selfModes.method(node, "ref")],
  ["memoryLayoutObservation", "memoryLayoutObservations", (builder, node) => builder.memoryLayoutObservations.observe(node, 0)],
];

for (const [family, producer, construct] of cases) {
  test(`${family} exposes one frozen producer and only a read-only final family`, () => {
    const builder = createRustProgramRecordBuilder();
    assert.equal(builder[family].set === undefined, true, family);
    assert.equal(Object.isFrozen(builder[family]), true, family);
    assert.equal(Object.isFrozen(builder[producer]), true, producer);
    assert.equal(builder[producer].records === builder[family], true, "builder and producer share the same reader");
    const sealed = builder.seal([]);
    assert.equal(sealed[family] === builder[family], true, "sealing preserves reader identity");
    assert.equal(sealed[family].set === undefined, true, "the final family has no general writer");
    assert.equal(sealed[producer] === undefined, true, "the final program has no producer port");
    assert.equal(builder.minimumFoundation(), "core", "these facts add no foundation requirement");
  });

  test(`${family} publishes only for the exact selected source identity`, () => {
    const builder = createRustProgramRecordBuilder();
    const subject = {};
    assert.equal(builder[family].get(subject) === undefined, true, "absence before publication");
    assert.equal(builder[family].get(undefined) === undefined, true, "absent source subject");
    construct(builder, subject);
    const fact = builder[family].get(subject);
    assert.equal(fact !== undefined, true, "publication exists");
    assert.equal(Object.isFrozen(fact), true, "the admitted fact is immutable");
    assert.equal(builder[family].get({}) === undefined, true, "same shape is not the same source node");
    assertRustInheritedRecordCorrespondence(family, subject, fact, candidate => construct(candidate, subject));
    if (family === "compileTimeSource") construct(builder, subject);
    else assert.throws(() => construct(builder, subject), /Duplicate Rust semantic plan/u);
    assert.equal(builder[family].get(subject) === fact, true, "query/event or duplicate refusal retains canonical identity");
    assert.equal(builder.minimumFoundation(), "core");
    assert.equal(builder.seal([])[family].get(subject) === fact, true, "sealing retains exact data identity");
  });

  test(`${family} retains parent identity and isolates fresh child admissions`, () => {
    const parent = createRustProgramRecordBuilder();
    const subject = {};
    construct(parent, subject);
    const sealed = parent.seal([]);
    const child = createRustProgramRecordBuilder(undefined, sealed);
    const fact = sealed[family].get(subject);
    assert.equal(child[family].get(subject) === fact, true, "inherited exact fact");
    construct(child, subject);
    assert.equal(child[family].get(subject) === fact, true, "equal child admission retains the inherited fact");
    const fresh = {};
    construct(child, fresh);
    assert.equal(child[family].get(fresh) !== undefined, true, "fresh child publication");
    assert.equal(sealed[family].get(fresh) === undefined, true, "no write reaches the sealed parent");
    assert.equal(child.seal([])[family].get(subject) === fact, true);
  });

  test(`${family} rejects every admission after the seal, including inherited and equal facts`, () => {
    const parent = createRustProgramRecordBuilder();
    const subject = {};
    construct(parent, subject);
    const sealedParent = parent.seal([]);
    const child = createRustProgramRecordBuilder(undefined, sealedParent);
    const local = {};
    construct(child, local);
    const sealedChild = child.seal([]);
    for (const node of [subject, local, {}]) {
      assert.throws(() => construct(child, node), /after analysis is sealed/u);
    }
    assert.equal(sealedChild[family].get(subject) === sealedParent[family].get(subject), true);
    assert.throws(() => child.seal([]), /can be sealed only once/u);
  });
}

test("compile-time erasure constructs true without admitting arbitrary flags or touching other families", () => {
  const builder = createRustProgramRecordBuilder();
  const declaration = {};
  const initializer = {};
  builder.compileTimeSources.erase(declaration);
  builder.compileTimeSources.erase(initializer);
  builder.compileTimeSources.erase(declaration);
  assert.equal(builder.compileTimeSource.get(declaration), true);
  assert.equal(builder.compileTimeSource.get(initializer), true);
  assert.equal(builder.selfMode.get(declaration) === undefined, true);
  assert.equal(builder.memoryLayoutObservation.get(initializer) === undefined, true);
  const child = createRustProgramRecordBuilder(undefined, builder.seal([]));
  child.compileTimeSources.erase(declaration);
  assert.equal(child.compileTimeSource.get(declaration), true);
  child.seal([]);
  assert.throws(() => child.compileTimeSources.erase(declaration), /after analysis is sealed/u);
  assert.throws(() => child.compileTimeSources.erase({}), /after analysis is sealed/u);
});

for (const mode of ["ref", "mut-ref"]) {
  test(`method receiver construction retains the selected native ${mode} and rejects another selection`, () => {
    const parent = createRustProgramRecordBuilder();
    const member = {};
    parent.selfModes.method(member, mode);
    const fact = parent.selfMode.get(member);
    assert.deepEqual(fact, { mode });
    const different = mode === "ref" ? "mut-ref" : "ref";
    assertRustInheritedRecordConflict("selfMode", member, fact, candidate => candidate.selfModes.method(member, different),
      /Conflicting Rust semantic plan 'tsonic\.rust\.selfMode'/u);
    assert.equal(parent.selfMode.get(member) === fact, true, "a conflict never replaces the admitted fact");
    const child = createRustProgramRecordBuilder(undefined, parent.seal([]));
    assert.throws(() => child.selfModes.method(member, different),
      /Conflicting Rust semantic plan 'tsonic\.rust\.selfMode'/u);
    assert.equal(child.selfMode.get(member) === fact, true, "an inherited conflict leaves the parent intact");
    const other = {};
    child.selfModes.method(other, different);
    assert.equal(child.selfMode.get(other)?.mode, different, "another exact source member is independent");
  });
}

for (const value of [0, 1, 4, 8, 65536]) {
  test(`layout observation constructs the exact selected scalar ${value} without carrier or foundation changes`, () => {
    const builder = createRustProgramRecordBuilder();
    const expression = {};
    builder.memoryLayoutObservations.observe(expression, value);
    assert.deepEqual(builder.memoryLayoutObservation.get(expression), { value });
    assert.equal(builder.runtimeCarrier.get(expression) === undefined, true, "the existing carrier producer remains independent");
    assert.equal(builder.minimumFoundation(), "core");
  });
}

test("layout conflicts reject locally and through inheritance without replacing the first scalar", () => {
  const parent = createRustProgramRecordBuilder();
  const expression = {};
  parent.memoryLayoutObservations.observe(expression, 0);
  const fact = parent.memoryLayoutObservation.get(expression);
  assertRustInheritedRecordConflict("memoryLayoutObservation", expression, fact, candidate => candidate.memoryLayoutObservations.observe(expression, 4),
    /Conflicting Rust semantic plan 'tsonic\.rust\.memoryLayoutObservation'/u);
  assert.equal(parent.memoryLayoutObservation.get(expression) === fact, true);
  const child = createRustProgramRecordBuilder(undefined, parent.seal([]));
  assert.throws(() => child.memoryLayoutObservations.observe(expression, 8),
    /Conflicting Rust semantic plan 'tsonic\.rust\.memoryLayoutObservation'/u);
  assert.equal(child.memoryLayoutObservation.get(expression) === fact, true);
  child.memoryLayoutObservations.observe(expression, 0);
  assert.equal(child.memoryLayoutObservation.get(expression) === fact, true);
});
