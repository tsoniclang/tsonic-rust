import assert from "node:assert/strict";
import test from "node:test";
import { planRustRecordSpread } from "../../../../dist/backend/planner/expressions/record-spreads.js";
import { rustOptionTargetType, rustStructuralObjectTargetType } from "../../../../dist/target-model/types/index.js";

const source = rustStructuralObjectTargetType("/src/index.ts", []);
const expression = { kind: "call", path: "source", args: [] };
const context = () => ({ syntheticNames: { reserved: new Set(), nextSuffixByBase: new Map() } });

test("empty optional record spread retains one evaluation and validates the exact presence relation", () => {
  const spread = { kind: "spread", fields: [], methods: [], sourceStorage: "structural-object",
    sourceCarrier: rustOptionTargetType(source), sourceValueCarrier: source };
  const planned = planRustRecordSpread(spread, expression, [], [], new Map(), context());
  assert.ok(planned);
  assert.equal(planned.bindings.length, 1);
  assert.equal(planned.bindings[0].value, expression);
  assert.equal(planned.fields.size, 0);
  assert.equal(planRustRecordSpread({ ...spread, sourceValueCarrier: spread.sourceCarrier },
    expression, [], [], new Map(), context()) === undefined, true);
  assert.equal(planRustRecordSpread({ ...spread, sourceCarrier: source },
    expression, [], [], new Map(), context()).bindings.length, 1);
  assert.equal(planRustRecordSpread(spread, expression, [], [{ kind: "spread" }], new Map(), context()) === undefined, true);
});
