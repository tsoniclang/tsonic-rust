import assert from "node:assert/strict";
import test from "node:test";
import { planRustAbsentValue } from "../../../../dist/backend/planner/expressions/optional-storage.js";
import { rustAbsenceTargetType, rustOptionTargetType, rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";
import { rustProgramPlanContext, rustProgramWithTypeEmissions } from "../../../helpers/plan-context.mjs";
import { printRustExpr } from "../../../../dist/print/source/index.js";

// The planner reads each carrier's sealed optional storage; a real program selects the two admitted carriers.
const context = rustProgramPlanContext(rustProgramWithTypeEmissions([
  rustAbsenceTargetType(), rustOptionTargetType(rustSourcePrimitiveTargetType("uint64"))]));

test("absence completion uses the exact native storage without an adapter", () => {
  assert.deepEqual(planRustAbsentValue(rustAbsenceTargetType(), context), { kind: "tuple-literal", elements: [] });
  const absent = planRustAbsentValue(rustOptionTargetType(rustSourcePrimitiveTargetType("uint64")), context);
  assert.deepEqual(absent, { kind: "associated-value", owner: { kind: "named", path: "Option",
    genericArguments: [{ kind: "type", type: { kind: "primitive", name: "u64" } }] }, name: "None" });
  assert.equal(printRustExpr(absent), "Option::<u64>::None");
});

// The refusal wording follows PORT-MAP row 373 (backend optional storage selection is sealed; RULINGS.md).
test("absence completion rejects missing or unproved native storage", () => {
  for (const carrier of [rustSourcePrimitiveTargetType("uint64"), { kind: "target-named", id: "External.Value" }]) {
    assert.throws(() => planRustAbsentValue(carrier, context), error =>
      error?.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT" &&
      error.diagnostic.message.startsWith("An admitted absence requires its native optional storage."));
  }
  // A missing carrier has no closed identity to look up; it still produces no value.
  assert.throws(() => planRustAbsentValue(undefined, context));
});
