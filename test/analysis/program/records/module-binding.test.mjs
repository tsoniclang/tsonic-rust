import assert from "node:assert/strict";
import test from "node:test";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";

const integer = Object.freeze({ kind: "source-primitive", name: "int32" });
const wider = Object.freeze({ kind: "source-primitive", name: "int64" });

function patternRequest(builder, root, leaves, overrides = {}) {
  const selected = { declarationKind: "let", storage: "module-pattern", valueCarrier: integer,
    initializer: root, steps: leaves.map(declaration => ({ declaration, source: root, kind: "binding" })), ...overrides };
  return { context: { records: builder, requiredRecords: [] }, moduleBindings: { classifyValue: () => selected } };
}

function project(builder, declaration, carrier = integer) {
  builder.bindingProjections.resolve([], declaration, integer, carrier, { kind: "tuple-element", index: 0 });
}

test("module pattern publication waits for every leaf and preserves original identities", () => {
  const builder = createRustProgramRecordBuilder();
  const root = {};
  const first = {};
  const second = {};
  const walk = patternRequest(builder, root, [first, second]);
  project(builder, first);
  builder.moduleBindings.value(walk, root, "let", integer);
  assert.equal(builder.moduleBinding.get(root) === undefined, true, "unavailable root is not published");
  assert.equal(builder.moduleBinding.get(first) === undefined, true, "no partial leaf publication");
  project(builder, second);
  builder.moduleBindings.value(walk, root, "let", integer);
  const original = builder.moduleBinding.get(root);
  assert.equal(original?.storage, "module-pattern", "complete root uses the existing family's pattern form");
  assert.equal(original.steps[0].declaration === first && original.steps[1].declaration === second, true, "original leaf identities and order");
  for (const leaf of [first, second]) {
    assert.equal(builder.moduleBinding.get(leaf)?.storage, "module-cell", "ordinary live module storage");
    assert.equal(builder.moduleBinding.get(leaf)?.initialization, "value", "leaf is initialized by projection");
  }
  builder.moduleBindings.value(walk, root, "let", { ...integer });
  assert.equal(builder.moduleBinding.get(root) === original, true, "identical request preserves canonical root identity");
  const foreign = {};
  const foreignWalk = patternRequest(builder, foreign, [foreign]);
  builder.moduleBindings.value(foreignWalk, foreign, "let", integer);
  assert.equal(builder.moduleBinding.get(foreign) === undefined, true, "structurally similar foreign leaves do not borrow projections");
  builder.seal(walk.context.requiredRecords);
  assert.throws(() => builder.moduleBindings.value(walk, root, "let", integer), /after analysis is sealed/u);
});

test("changed or inherited module pattern requests cannot publish partial transactions", () => {
  const parent = createRustProgramRecordBuilder();
  const root = {};
  const first = {};
  project(parent, first);
  const walk = patternRequest(parent, root, [first]);
  parent.moduleBindings.value(walk, root, "let", integer);
  const original = parent.moduleBinding.get(root);
  const sealed = parent.seal(walk.context.requiredRecords);
  const child = createRustProgramRecordBuilder(undefined, sealed);
  const same = patternRequest(child, root, [first]);
  child.moduleBindings.value(same, root, "let", integer);
  assert.equal(child.moduleBinding.get(root) === original, true, "child reuses exact inherited evidence");
  for (const change of [
    { initializer: {} },
    { steps: [] },
    { steps: [{ declaration: first, source: {}, kind: "binding" }] },
    { steps: [{ declaration: first, source: root, kind: "pattern" }] },
  ]) {
    assert.throws(() => child.moduleBindings.value(patternRequest(child, root, [first], change), root, "let", integer),
      /Conflicting Rust semantic plan/u);
    assert.equal(child.moduleBinding.get(root) === original, true, "changed source transaction does not replace inherited root");
  }
  const second = {};
  project(child, second, wider);
  assert.throws(() => child.moduleBindings.value(patternRequest(child, root, [second]), root, "let", integer),
    /Conflicting Rust semantic plan/u);
  assert.equal(child.moduleBinding.get(second) === undefined, true, "a conflicting root cannot leak a fresh leaf");
  assert.equal(parent.moduleBinding.get(second) === undefined, true, "parent remains immutable");
});

test("array omissions retain checked identity without manufacturing a projected value", () => {
  const parent = createRustProgramRecordBuilder();
  const required = [];
  const subject = {};
  const source = { kind: "tuple", elements: [integer] };
  parent.bindingProjections.omitted(required, subject, source);
  const selected = parent.bindingProjection.get(subject);
  assert.equal(selected?.projection.kind, "omitted", "one existing projection family owns the omission");
  assert.equal(selected.sourceCarrier === source, true, "the original aggregate carrier is retained");
  for (const field of ["projectedCarrier", "storageCarrier", "bindingCarrier", "normalization"]) {
    assert.equal(field in selected, false, `${field}: no runtime value exists for a hole`);
  }
  assert.equal(Object.isFrozen(selected) && Object.isFrozen(selected.projection), true, "sealed immutable no-value evidence");
  const invalidRoot = {};
  parent.moduleBindings.value(patternRequest(parent, invalidRoot, [subject]), invalidRoot, "let", integer);
  assert.equal(parent.moduleBinding.get(invalidRoot) === undefined, true, "an omission cannot stand in for a runtime leaf projection");
  assert.equal(parent.moduleBinding.get(subject) === undefined, true, "no runtime module leaf is fabricated");
  assert.equal(required.some(entry => entry.family === "bindingProjection" && entry.subject === subject), true,
    "the exact original omitted element is a required record subject");
  assert.throws(() => parent.bindingProjections.omitted(required, subject, source), /Duplicate Rust semantic plan/u);
  const sealed = parent.seal(required);
  const child = createRustProgramRecordBuilder(undefined, sealed);
  child.bindingProjections.omitted([], subject, { ...source, elements: [...source.elements] });
  assert.equal(child.bindingProjection.get(subject) === selected, true, "inherited omission identity remains canonical");
  for (const change of [
    builder => builder.bindingProjections.omitted([], subject, { kind: "tuple", elements: [wider] }),
    builder => builder.bindingProjections.resolve([], subject, source, integer, { kind: "tuple-element", index: 0 }),
  ]) {
    const conflicting = createRustProgramRecordBuilder(undefined, sealed);
    assert.throws(() => change(conflicting), /Conflicting Rust semantic plan/u);
    assert.equal(conflicting.bindingProjection.get(subject) === selected, true, "conflicting value/evidence cannot replace a hole");
  }
  assert.equal(child.bindingProjection.get({}) === undefined, true, "a lookalike subject does not inherit an omission");
  child.seal([]);
  assert.throws(() => child.bindingProjections.omitted([], {}, source), /after analysis is sealed/u);
});
