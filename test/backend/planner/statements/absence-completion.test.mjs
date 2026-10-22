import assert from "node:assert/strict";
import test from "node:test";
import { planRustAbsentValue } from "../../../../dist/backend/planner/expressions/optional-storage.js";
import { rustAbsenceTargetType, rustOptionTargetType, rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";
import { rustProgramPlanContext, rustProgramWithTypeEmissions } from "../../../helpers/plan-context.mjs";

// The planner reads each carrier's sealed optional storage; a real program selects the two admitted carriers.
const context = rustProgramPlanContext(rustProgramWithTypeEmissions([
  rustAbsenceTargetType(), rustOptionTargetType(rustSourcePrimitiveTargetType("uint64"))]));

test("absence completion uses the exact native storage without an adapter", () => {
  assert.deepEqual(planRustAbsentValue(rustAbsenceTargetType(), context), { kind: "tuple-literal", elements: [] });
  assert.deepEqual(planRustAbsentValue(rustOptionTargetType(rustSourcePrimitiveTargetType("uint64")), context), { kind: "none" });
});

test("absence completion rejects missing or unproved native storage", () => {
  for (const carrier of [undefined, rustSourcePrimitiveTargetType("uint64"), { kind: "target-named", id: "External.Value" }]) {
    assert.throws(() => planRustAbsentValue(carrier, context), /finalized native optional storage/u);
  }
});
