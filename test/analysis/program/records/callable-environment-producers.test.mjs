import assert from "node:assert/strict";
import { assertRustInheritedRecordCorrespondence } from "../../../helpers/records.mjs";
import test from "node:test";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";
import { rustCallableTargetType } from "../../../../dist/target-model/types/carriers/callables.js";

const integer = { kind: "source-primitive", name: "int32" };
const text = { kind: "target-named", id: "rust.std.String" };
const callable = rustCallableTargetType([integer], text);
const lifetime = { kind: "parameter", identity: "checked-owned-environment", name: "environment" };
const callableFamilies = [["sourceCallableValue", "sourceCallableValues"],
  ["directCallableReference", "directCallableReferences"]];

for (const [family, producer] of callableFamilies) {
  test(`${family} constructs the exact function identity and selected native signature`, () => {
    const builder = createRustProgramRecordBuilder();
    const reference = {};
    const declaration = {};
    const parameters = [integer];
    builder[producer].function(reference, declaration, "native.ts", "keepMyCase", callable, parameters, text);
    const fact = builder[family].get(reference);
    assert.deepEqual(Object.keys(fact).sort(), ["carrier", "fileName", "form", "name", "parameterCarriers", "resultCarrier", "sourceDeclaration"]);
    assert.equal(fact.form, "function");
    assert.equal(fact.sourceDeclaration === declaration, true);
    assert.equal(fact.fileName, "native.ts");
    assert.equal(fact.name, "keepMyCase");
    assert.equal(fact.carrier === callable && fact.resultCarrier === text, true);
    assert.equal(fact.parameterCarriers.length, 1);
    assert.equal(fact.parameterCarriers[0] === integer, true);
    assert.equal(Object.isFrozen(fact) && Object.isFrozen(fact.parameterCarriers), true);
    parameters.push(text);
    assert.equal(fact.parameterCarriers.length, 1, "the native signature inventory is sealed independently of the input array");
    assert.equal(builder[family].get(declaration) === undefined, true, "only the exact reference receives a callable record");
    assert.equal(builder[family].get({}) === undefined, true, "a lookalike reference is not the checked identity");
    assert.equal(builder.minimumFoundation(), "core", "producer transport adds no new carrier requirement");
  });

  test(`${family} keeps zero inputs absent of invented optional metadata`, () => {
    const builder = createRustProgramRecordBuilder();
    const reference = {};
    builder[producer].function(reference, reference, "empty.ts", "empty", rustCallableTargetType([], integer), [], integer);
    const fact = builder[family].get(reference);
    assert.equal(fact.parameterCarriers.length, 0);
    for (const field of ["lifetime", "receiver", "captures", "storage", "async", "generator"]) {
      assert.equal(Object.hasOwn(fact, field), false, field);
    }
  });

  test(`${family} preserves equal repeat and inherited first-record identity`, () => {
    const builder = createRustProgramRecordBuilder();
    const reference = {};
    const declaration = {};
    builder[producer].function(reference, declaration, "input.ts", "step", callable, [integer], text);
    const fact = builder[family].get(reference);
    assertRustInheritedRecordCorrespondence(family, reference, fact,
      candidate => candidate[producer].function(reference, declaration, "input.ts", "step", rustCallableTargetType([{ ...integer }], { ...text }), [{ ...integer }], { ...text }));
    assert.throws(() => builder[producer].function(reference, declaration, "input.ts", "step", callable, [integer], text), /Duplicate Rust semantic plan/u);
    assert.equal(builder[family].get(reference) === fact, true);
    const child = createRustProgramRecordBuilder(undefined, builder.seal([]));
    child[producer].function(reference, declaration, "input.ts", "step", callable, [integer], text);
    assert.equal(child[family].get(reference) === fact, true);
    const other = {};
    child[producer].function(other, declaration, "input.ts", "step", callable, [integer], text);
    assert.equal(child[family].get(other)?.sourceDeclaration === declaration, true);
    assert.equal(builder[family].get(other) === undefined, true);
  });

  for (const field of ["sourceDeclaration", "fileName", "name", "carrier", "parameterCarriers", "resultCarrier"]) {
    test(`${family} rejects changed ${field} without replacing the existing record`, () => {
      const builder = createRustProgramRecordBuilder();
      const reference = {};
      const declaration = {};
      builder[producer].function(reference, declaration, "input.ts", "step", callable, [integer], text);
      const fact = builder[family].get(reference);
      const child = createRustProgramRecordBuilder(undefined, builder.seal([]));
      assert.throws(() => child[producer].function(reference,
        field === "sourceDeclaration" ? {} : declaration,
        field === "fileName" ? "other.ts" : "input.ts",
        field === "name" ? "other" : "step",
        field === "carrier" ? rustCallableTargetType([integer], integer) : callable,
        field === "parameterCarriers" ? [text] : [integer],
        field === "resultCarrier" ? integer : text), /Conflicting Rust semantic plan/u);
      assert.equal(child[family].get(reference) === fact, true);
    });
  }
}

test("all three final families publish one immutable reader and no generic writer or producer", () => {
  const builder = createRustProgramRecordBuilder();
  const records = builder.seal([]);
  for (const [family, producer] of [...callableFamilies, ["retainedEnvironment", "retainedEnvironments"]]) {
    assert.equal(builder[producer].records === builder[family] && records[family] === builder[family], true, family);
    assert.equal(Object.isFrozen(builder[producer]) && Object.isFrozen(records[family]), true, family);
    assert.deepEqual(Object.keys(records[family]), ["get"], family);
    assert.equal(builder[family].set === undefined && records[family].set === undefined, true, family);
    assert.equal(records[producer] === undefined, true, producer);
    assert.equal(records[family].get(undefined) === undefined && records[family].get({}) === undefined, true, family);
  }
  for (const [, producer] of callableFamilies) {
    assert.throws(() => builder[producer].function({}, {}, "input.ts", "step", callable, [integer], text), /after analysis is sealed/u);
  }
  assert.throws(() => builder.retainedEnvironments.retain({}, lifetime, []), /after analysis is sealed/u);
});

test("retained environments preserve exact parameter/lifetime identity and freeze only their inventory", () => {
  const builder = createRustProgramRecordBuilder();
  const declaration = {};
  const first = {};
  const second = {};
  const parameters = [{ kind: "parameter", declaration: first }, { kind: "parameter", declaration: second }];
  builder.retainedEnvironments.retain(declaration, lifetime, parameters);
  const fact = builder.retainedEnvironment.get(declaration);
  assert.deepEqual(Object.keys(fact).sort(), ["inputs", "lifetime"]);
  assert.equal(fact.lifetime === lifetime, true);
  assert.equal(fact.inputs.length, 2);
  assert.equal(fact.inputs[0].declaration === first && fact.inputs[1].declaration === second, true);
  assert.equal(Object.isFrozen(fact) && Object.isFrozen(fact.inputs), true);
  parameters.reverse();
  parameters.push({ kind: "parameter", declaration: {} });
  assert.equal(fact.inputs.length, 2);
  assert.equal(fact.inputs[0].declaration === first && fact.inputs[1].declaration === second, true);
  assert.equal(builder.retainedEnvironment.get(first) === undefined && builder.retainedEnvironment.get({}) === undefined, true);
  assert.equal(builder.minimumFoundation(), "core");
});

test("retained environments preserve equality semantics including lifetime name independence", () => {
  const builder = createRustProgramRecordBuilder();
  const declaration = {};
  const parameter = {};
  builder.retainedEnvironments.retain(declaration, lifetime, [{ kind: "parameter", declaration: parameter }]);
  const fact = builder.retainedEnvironment.get(declaration);
  builder.retainedEnvironments.retain(declaration, { ...lifetime, name: "renamed" }, [{ kind: "parameter", declaration: parameter }]);
  assert.equal(builder.retainedEnvironment.get(declaration) === fact, true);
  const child = createRustProgramRecordBuilder(undefined, builder.seal([]));
  child.retainedEnvironments.retain(declaration, { ...lifetime }, [{ kind: "parameter", declaration: parameter }]);
  assert.equal(child.retainedEnvironment.get(declaration) === fact, true);
  const other = {};
  child.retainedEnvironments.retain(other, lifetime, []);
  assert.equal(child.retainedEnvironment.get(other)?.inputs.length, 0);
  assert.equal(builder.retainedEnvironment.get(other) === undefined, true);
});

for (const change of ["lifetime", "parameter", "count", "order"]) {
  test(`retained environment ${change} conflicts preserve the inherited record`, () => {
    const builder = createRustProgramRecordBuilder();
    const declaration = {};
    const first = {};
    const second = {};
    builder.retainedEnvironments.retain(declaration, lifetime, [{ kind: "parameter", declaration: first }, { kind: "parameter", declaration: second }]);
    const fact = builder.retainedEnvironment.get(declaration);
    const child = createRustProgramRecordBuilder(undefined, builder.seal([]));
    const parameters = change === "count" ? [first] : change === "order" ? [second, first]
      : change === "parameter" ? [first, {}] : [first, second];
    assert.throws(() => child.retainedEnvironments.retain(declaration,
      change === "lifetime" ? { ...lifetime, identity: "other-owned-environment" } : lifetime, parameters.map(declaration => ({ kind: "parameter", declaration }))), /Conflicting Rust semantic plan/u);
    assert.equal(child.retainedEnvironment.get(declaration) === fact, true);
  });
}
