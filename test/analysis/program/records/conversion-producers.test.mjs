import assert from "node:assert/strict";
import test from "node:test";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";
import { rustFlowReadProjectionEquals } from "../../../../dist/target-model/records/operations/equality.js";
import { rustOptionTargetType } from "../../../../dist/target-model/types/carriers/optional.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";
import { assertRustInheritedRecordConflict } from "../../../helpers/records.mjs";

const source = rustSourcePrimitiveTargetType("int32");
const selected = rustSourcePrimitiveTargetType("int64");
const different = rustSourcePrimitiveTargetType("bool");
const dispatch = rustOptionTargetType(source);
const projection = Object.freeze({ kind: "checked", slot: "selected_payload" });
const project = Object.freeze({ projection, sourceCarrier: source, dispatchCarrier: dispatch, targetCarrier: selected });
const path = Object.freeze([{ union: dispatch, variant: Object.freeze({ kind: "payload", name: "Some" }) }]);
const arms = Object.freeze([Object.freeze({ carrier: source, source: path, target: path }),
  Object.freeze({ carrier: selected, source: path, target: path })]);
const recipes = [
  { kind: "union-map", dispatchCarrier: dispatch, arms },
  { kind: "source-union", dispatchCarrier: dispatch, variant: "Some", project },
  { kind: "runtime-union", dispatchCarrier: dispatch, variant: "Some", project },
  { kind: "builtin-error" }, { kind: "option-value" }, { kind: "option-reference" },
  { kind: "project-downcast", dispatchCarrier: dispatch, projection }, { kind: "closed-native" },
  { kind: "program-error-variant", variant: "Source" },
];
assert.equal(recipes.length, 9, "every selected flow-projection variant has an owner witness");

for (const recipe of recipes) {
  test(`flow producer preserves complete selected ${recipe.kind} metadata and inherited identity`, () => {
    const subject = {};
    const builder = createRustProgramRecordBuilder();
    const input = { ...recipe, ...(recipe.arms === undefined ? {} : { arms: [...recipe.arms] }) };
    builder.flowReadProjections.project(subject, source, selected, input);
    const fact = builder.flowReadProjection.get(subject);
    assert.equal(fact.sourceCarrier === source && fact.selectedCarrier === selected, true, "selected native carriers retain identity");
    assert.equal(rustFlowReadProjectionEquals(fact, { ...recipe, sourceCarrier: source, selectedCarrier: selected }), true);
    assert.deepEqual(Object.keys(fact).sort(), [...Object.keys(recipe), "sourceCarrier", "selectedCarrier"].sort());
    assert.equal(Object.isFrozen(fact), true);
    if (recipe.project !== undefined) assert.equal(fact.project === recipe.project, true, "the complete selected project relation is retained");
    if (recipe.projection !== undefined) assert.equal(fact.projection === recipe.projection, true, "the selected projection recipe is retained");
    if (recipe.arms !== undefined) {
      assert.equal(Object.isFrozen(fact.arms), true);
      assert.equal(fact.arms.length, 2);
      for (const [index, arm] of recipe.arms.entries()) assert.equal(fact.arms[index] === arm, true, "ordered arm metadata retains identity");
      input.arms.push(recipe.arms[0]);
      assert.equal(fact.arms.length, 2, "caller inventory mutation cannot change the admitted record");
    }
    const records = builder.seal([]);
    const child = createRustProgramRecordBuilder(undefined, records);
    child.flowReadProjections.project(subject, source, selected, recipe);
    assert.equal(child.flowReadProjection.get(subject) === fact, true, "an inherited exact record is canonical");
    for (const [changedSource, changedSelected, changedRecipe] of [
      [different, selected, recipe], [source, different, recipe],
      [source, selected, { kind: recipe.kind === "closed-native" ? "option-value" : "closed-native" }],
    ]) assertRustInheritedRecordConflict("flowReadProjection", subject, fact,
      candidate => candidate.flowReadProjections.project(subject, changedSource, changedSelected, changedRecipe), /Conflicting Rust semantic plan/u);
    assert.equal(child.flowReadProjection.get(subject) === fact, true, "a rejected correspondence never replaces the canonical record");
    child.seal([]);
    assert.throws(() => child.flowReadProjections.project({}, source, selected, recipe), /sealed/u);
  });
}

test("flow construction preserves optional project-property presence without losing payload data", () => {
  for (const present of [false, true]) {
    const builder = createRustProgramRecordBuilder();
    const subject = {};
    builder.flowReadProjections.project(subject, source, selected, { kind: "source-union", dispatchCarrier: dispatch,
      variant: "Some", ...(present ? { project: undefined } : {}) });
    assert.equal(Object.hasOwn(builder.flowReadProjection.get(subject), "project"), present);
    const opposite = { kind: "source-union", dispatchCarrier: dispatch, variant: "Some",
      ...(!present ? { project: undefined } : {}) };
    assertRustInheritedRecordConflict("flowReadProjection", subject, builder.flowReadProjection.get(subject),
      candidate => candidate.flowReadProjections.project(subject, source, selected, opposite),
      /Conflicting Rust semantic plan/u);
    assert.equal(Object.hasOwn(builder.flowReadProjection.get(subject), "project"), present);
  }
});

test("option producers retain exact native absence and presence operands", () => {
  const builder = createRustProgramRecordBuilder();
  const absent = {};
  const present = {};
  const option = rustOptionTargetType(selected);
  builder.optionProjections.none(absent, source, option);
  builder.optionProjections.some(present, source, selected, option);
  assert.deepEqual(builder.optionProjection.get(absent), { kind: "none", sourceCarrier: source, resultCarrier: option });
  const fact = builder.optionProjection.get(present);
  assert.equal(fact.kind, "some");
  assert.equal(fact.sourceCarrier === source && fact.elementCarrier === selected && fact.resultCarrier === option, true);
  assert.equal(Object.isFrozen(builder.optionProjection.get(absent)) && Object.isFrozen(fact), true);
  const child = createRustProgramRecordBuilder(undefined, builder.seal([]));
  child.optionProjections.some(present, source, selected, option);
  assert.equal(child.optionProjection.get(present) === fact, true);
  for (const attempt of [candidate => candidate.optionProjections.none(present, source, option),
    candidate => candidate.optionProjections.some(present, selected, selected, option),
    candidate => candidate.optionProjections.some(present, source, source, option)]) {
    assertRustInheritedRecordConflict("optionProjection", present, fact, attempt, /Conflicting Rust semantic plan/u);
  }
});

test("conversion producers preserve both an absent selection and the exact selected carrier", () => {
  const builder = createRustProgramRecordBuilder();
  const absent = {};
  const converted = {};
  builder.conversions.converted(absent, undefined);
  builder.conversions.converted(converted, selected);
  assert.deepEqual(builder.conversion.get(absent), {});
  assert.equal(builder.conversion.get(converted).convertedType === selected, true);
  assert.equal(Object.isFrozen(builder.conversion.get(absent)) && Object.isFrozen(builder.conversion.get(converted)), true);
  const child = createRustProgramRecordBuilder(undefined, builder.seal([]));
  child.conversions.converted(converted, selected);
  assert.equal(child.conversion.get(converted) === builder.conversion.get(converted), true);
  assertRustInheritedRecordConflict("conversion", converted, builder.conversion.get(converted),
    candidate => candidate.conversions.converted(converted, different), /Conflicting Rust semantic plan/u);
});

test("contextual conversion producer preserves the complete selected conversion and carrier pair", () => {
  const builder = createRustProgramRecordBuilder();
  const subject = {};
  const conversion = Object.freeze({ kind: "semantic-conversion", id: "checked-f64-to-i32-trunc" });
  builder.contextualValueConversions.convert(subject, source, selected, conversion);
  const fact = builder.contextualValueConversion.get(subject);
  assert.equal(fact.sourceCarrier === source && fact.targetCarrier === selected && fact.conversion === conversion, true);
  assert.equal(Object.isFrozen(fact), true);
  const child = createRustProgramRecordBuilder(undefined, builder.seal([]));
  child.contextualValueConversions.convert(subject, source, selected, conversion);
  assert.equal(child.contextualValueConversion.get(subject) === fact, true);
  for (const attempt of [candidate => candidate.contextualValueConversions.convert(subject, different, selected, conversion),
    candidate => candidate.contextualValueConversions.convert(subject, source, different, conversion)]) {
    assertRustInheritedRecordConflict("contextualValueConversion", subject, fact, attempt, /Conflicting Rust semantic plan/u);
  }
});

test("all final conversion families have one immutable reader and no sealed producer port", () => {
  const builder = createRustProgramRecordBuilder();
  for (const [family, producer] of [["conversion", "conversions"], ["optionProjection", "optionProjections"],
    ["flowReadProjection", "flowReadProjections"], ["contextualValueConversion", "contextualValueConversions"]]) {
    assert.equal(builder[family] === builder[producer].records, true, "the builder composes the canonical reader rather than another store");
    assert.equal(Object.isFrozen(builder[family]), true);
    assert.deepEqual(Object.keys(builder[family]), ["get"]);
  }
  const records = builder.seal([]);
  for (const producer of ["conversions", "optionProjections", "flowReadProjections", "contextualValueConversions"]) {
    assert.equal(Object.hasOwn(records, producer), false);
  }
});
