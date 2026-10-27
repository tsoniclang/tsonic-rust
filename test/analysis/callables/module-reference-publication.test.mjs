import assert from "node:assert/strict";
import test from "node:test";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { recordRustInlineModuleCallableUses } from "../../../dist/analysis/callables/values/module-values.js";
import { rustCallableTargetType } from "../../../dist/target-model/types/index.js";

const integer = { kind: "source-primitive", name: "int32" };
const text = { kind: "target-named", id: "rust.std.String" };

function selected() {
  return { form: "function", sourceDeclaration: {}, fileName: "/project/index.ts", name: "step",
    carrier: rustCallableTargetType([integer], integer), parameterCarriers: [integer], resultCarrier: integer };
}

function admit(producer, reference, value) {
  producer.function(reference, value.sourceDeclaration, value.fileName, value.name,
    value.carrier, value.parameterCarriers, value.resultCarrier);
}

test("overlapping module contributions publish once per exact reference and never merge distinct references", () => {
  const builder = createRustProgramRecordBuilder();
  const first = {};
  const second = {};
  const alias = {};
  const value = selected();
  admit(builder.directCallableReferences, first, value);
  const canonical = builder.directCallableReference.get(first);
  const counts = { values: 0, references: 0 };
  const walk = { context: { requiredRecords: [], records: { ...builder,
    sourceCallableValues: { ...builder.sourceCallableValues, function(...arguments_) {
      counts.values++;
      builder.sourceCallableValues.function(...arguments_);
    } },
    directCallableReferences: { ...builder.directCallableReferences, function(...arguments_) {
      counts.references++;
      builder.directCallableReferences.function(...arguments_);
    } },
  } } };
  const selection = { stored: false, declarationValue: true,
    uses: [{ kind: "first-class", reference: first }, { kind: "first-class", reference: first }],
    aliases: [{ declarations: [alias], references: [first, second, second], producer: value },
      { declarations: [alias], references: [second], producer: { ...value, parameterCarriers: [{ ...integer }] } }],
  };
  recordRustInlineModuleCallableUses(walk, selection);
  assert.deepEqual(counts, { values: 1, references: 1 });
  assert.equal(builder.directCallableReference.get(first) === canonical, true);
  assert.equal(builder.sourceCallableValue.get(first).sourceDeclaration === value.sourceDeclaration, true);
  assert.equal(builder.directCallableReference.get(second).sourceDeclaration === value.sourceDeclaration, true);
  assert.equal(builder.compileTimeSource.get(alias), true);
  recordRustInlineModuleCallableUses(walk, selection);
  assert.deepEqual(counts, { values: 1, references: 1 }, "already admitted full correspondences are reads");
  const third = {};
  recordRustInlineModuleCallableUses(walk, { ...selection, declarationValue: false,
    aliases: [{ declarations: [], references: [third], producer: value }],
  });
  assert.deepEqual(counts, { values: 1, references: 2 }, "same declaration and native ABI do not merge distinct references");
  builder.seal(walk.context.requiredRecords);
  assert.throws(() => recordRustInlineModuleCallableUses(walk, selection), /after analysis is sealed/u);
  assert.deepEqual(counts, { values: 1, references: 2 });
});

for (const [name, change] of [
  ["declaration", { sourceDeclaration: {} }], ["file", { fileName: "/project/other.ts" }],
  ["name", { name: "other" }], ["carrier", { carrier: rustCallableTargetType([integer], text) }],
  ["parameters", { parameterCarriers: [text] }], ["result", { resultCarrier: text }],
]) test(`overlapping module aliases retain the full native ${name} conflict`, () => {
  const builder = createRustProgramRecordBuilder();
  const reference = {};
  const alias = {};
  const value = selected();
  assert.throws(() => recordRustInlineModuleCallableUses({ context: { requiredRecords: [], records: builder } }, {
    stored: false, declarationValue: false, uses: [], aliases: [
      { declarations: [alias], references: [reference], producer: value },
      { declarations: [], references: [reference], producer: { ...value, ...change } },
    ],
  }), /Conflicting Rust semantic plan 'tsonic\.rust\.directCallableReference'/u);
  assert.equal(builder.directCallableReference.get(reference) === undefined, true, "no poisoned reference publication");
  assert.equal(builder.compileTimeSource.get(alias) === undefined, true, "no erasure before complete contribution validation");
});

test("module value demand refuses a conflicting existing selected reference", () => {
  const builder = createRustProgramRecordBuilder();
  const reference = {};
  const value = selected();
  admit(builder.directCallableReferences, reference, value);
  admit(builder.sourceCallableValues, reference, { ...value, sourceDeclaration: {} });
  const canonical = builder.sourceCallableValue.get(reference);
  assert.throws(() => recordRustInlineModuleCallableUses({ context: { requiredRecords: [], records: builder } }, {
    stored: false, declarationValue: true, uses: [{ kind: "first-class", reference }], aliases: [],
  }), /Conflicting Rust semantic plan 'tsonic\.rust\.sourceCallableValue'/u);
  assert.equal(builder.sourceCallableValue.get(reference) === canonical, true);
});
