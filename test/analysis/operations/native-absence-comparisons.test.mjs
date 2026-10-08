import assert from "node:assert/strict";
import test from "node:test";
import { selectedOptionNullishRelationship } from "../../../dist/analysis/operations/nullish-comparisons.js";
import { rustAbsenceTargetType, rustOptionTargetType, rustSourcePrimitiveTargetType, rustStringTargetType,
  rustJsValueTargetType } from "../../../dist/target-model/types/index.js";
import { rustSourceOptionalTargetType } from "../../../dist/target-model/types/projections.js";

test("native absence comparisons use immutable physical storage without source flow reconstruction", () => {
  const absence = rustAbsenceTargetType();
  const text = rustStringTargetType();
  const sourceOptional = rustSourceOptionalTargetType(text);
  const parameter = { kind: "type-parameter", identity: "Value", name: "Value" };
  for (const [carrier, depths, negated] of [
    [rustOptionTargetType(text), [0], false],
    [sourceOptional, [0], false],
    [rustSourceOptionalTargetType(parameter), [0], false],
    [rustJsValueTargetType(), [0], false],
    [rustOptionTargetType(sourceOptional), [0, 1], false],
    [rustSourceOptionalTargetType(rustOptionTargetType(text)), [0], false],
    [rustOptionTargetType(rustOptionTargetType(text)), [0], false],
    [rustOptionTargetType(absence), [], true],
  ]) {
    for (const [left, right] of [[carrier, absence], [absence, carrier]]) {
      const relationship = selectedOptionNullishRelationship(left, right);
      assert.deepEqual(relationship, { depths, negated });
      assert.equal(Object.isFrozen(relationship), true);
      assert.equal(Object.isFrozen(relationship.depths), true);
    }
  }
});

test("native absence comparison rejects nonabsence counterparts and malformed option storage", () => {
  const absence = rustAbsenceTargetType();
  const value = rustSourcePrimitiveTargetType("int64");
  const option = rustOptionTargetType(value);
  const cyclic = { ...option, genericArguments: [] };
  cyclic.genericArguments.push({ kind: "type", type: cyclic });
  for (const carrier of [undefined, value, { ...option, genericArguments: [] },
    { ...option, genericArguments: [{ kind: "type", type: value }, { kind: "type", type: value }] },
    { ...value, sourceAbsence: true }, cyclic]) {
    assert.equal(selectedOptionNullishRelationship(carrier, absence), undefined);
    assert.equal(selectedOptionNullishRelationship(absence, carrier), undefined);
  }
  assert.equal(selectedOptionNullishRelationship(option, value), undefined);
  assert.equal(selectedOptionNullishRelationship(value, option), undefined);
  assert.equal(selectedOptionNullishRelationship(option, { ...absence, extra: true }), undefined);
  assert.equal(selectedOptionNullishRelationship({ ...absence, extra: true }, option), undefined);
});
