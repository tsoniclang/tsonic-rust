import assert from "node:assert/strict";
import test from "node:test";
import { rustSourceTypeCarrier, rustStructuralObjectTargetType, rustStructuralObjectCarrierValue } from "../../dist/target-model/types/carriers/source-types.js";
import { rustTargetTypeChildren } from "../../dist/target-model/types/carriers/children.js";
import { rustTargetTypeParameterNames } from "../../dist/target-model/types/carriers/generic-references.js";
import { substituteRustTargetTypeParameters } from "../../dist/target-model/types/carriers/substitution.js";
import { inferRustTargetTypeParameterBindings } from "../../dist/target-model/types/carriers/generic-inference.js";
import { structuralStorageKey } from "../../dist/analysis/objects/structural-shape-plan.js";

const parameter = { kind: "type-parameter", name: "Value" };
const number = { kind: "source-primitive", name: "float64" };
const base = (name, argument) => rustSourceTypeCarrier("/src/base.ts", name, "object", [{ kind: "type", type: argument }]);
const view = (name, argument) => rustStructuralObjectTargetType("/src/view.ts", [
  { sourceName: "value", type: argument, presence: "required", readonly: true },
], "reference", undefined, [base(name, argument)]);

test("structural instance views retain exact nominal bases through generic substitution", () => {
  const template = view("Base", parameter);
  const concrete = view("Base", number);
  assert.deepEqual(rustStructuralObjectCarrierValue(template).bases, [base("Base", parameter)]);
  assert.deepEqual(rustTargetTypeChildren(template), [base("Base", parameter), parameter]);
  assert.deepEqual(rustTargetTypeParameterNames(template), ["Value"]);
  assert.deepEqual(substituteRustTargetTypeParameters(template, new Map([["Value", number]])), concrete);
  assert.deepEqual(inferRustTargetTypeParameterBindings(template, concrete, new Set(["Value"])), new Map([["Value", number]]));
  assert.equal(inferRustTargetTypeParameterBindings(template, view("Other", number), new Set(["Value"])), undefined);
  assert.notEqual(structuralStorageKey(concrete, () => "component"), structuralStorageKey(view("Other", number), () => "component"));
});

test("nominal structural bases reject missing, invalid and non-object metadata", () => {
  const original = view("Base", number);
  const { bases: removed, ...missing } = original.value;
  assert.equal(removed.length, 1);
  for (const value of [missing, { ...original.value, bases: [number] },
    { ...original.value, bases: [rustSourceTypeCarrier("/src/base.ts", "Enum", "enum")] },
    { ...original.value, bases: [undefined] }, { ...original.value, bases: [base("Base", number)], representation: "value" },
    { ...original.value, bases: null }]) {
    assert.equal(rustStructuralObjectCarrierValue({ ...original, value }), undefined);
  }
  let reads = 0;
  const value = { ...original.value, get bases() { reads += 1; return []; } };
  assert.equal(rustStructuralObjectCarrierValue({ ...original, value }), undefined);
  assert.equal(reads, 0);
});
