import assert from "node:assert/strict";
import test from "node:test";
import { planRustRecordSpread } from "../../../../dist/backend/planner/expressions/record-spreads.js";
import { rustOptionTargetType, rustStructuralObjectTargetType } from "../../../../dist/target-model/types/index.js";
import { rustRecordFinalFieldContributions, rustRecordSpreadRetainsField, rustRecordSpreadReadIsObservable } from "../../../../dist/backend/planner/objects/record-contributions.js";

const source = rustStructuralObjectTargetType("/src/index.ts", []);
const expression = { kind: "call", path: "source", args: [] };
const context = () => ({ syntheticNames: { reserved: new Set(), nextSuffixByBase: new Map() } });

test("spread evaluation and liveness share exact final-field and observable-read selection", () => {
  const field = { sourceName: "value", sourceStorageIndex: 0, targetStorageIndex: 0 };
  const required = { kind: "spread", sourceStorage: "structural-object", sourceCarrier: source,
    sourceValueCarrier: source, fields: [field], methods: [] };
  const optional = { ...required, sourceCarrier: rustOptionTargetType(source) };
  const fact = { contributions: [{ kind: "property", targetStorageIndex: 0 }, required, optional,
    { kind: "property", targetStorageIndex: 1 }] };
  const final = rustRecordFinalFieldContributions(fact);
  assert.deepEqual([...final], [[0, 1], [1, 3]]);
  assert.equal(rustRecordSpreadRetainsField(required, field, 1, final), true);
  assert.equal(rustRecordSpreadRetainsField(optional, field, 2, final), true);
  const overwritten = rustRecordFinalFieldContributions({ contributions: [...fact.contributions,
    { kind: "property", targetStorageIndex: 0 }] });
  assert.equal(rustRecordSpreadRetainsField(required, field, 1, overwritten), false);
  assert.equal(rustRecordSpreadRetainsField(optional, field, 2, overwritten), false);
  for (const storage of ["stored", "property", "bound"]) {
    const shapes = { field: () => ({ storage }), definitionForCarrier: () => ({}) };
    assert.equal(rustRecordSpreadReadIsObservable(required, field, shapes), storage !== "stored");
    assert.equal(rustRecordSpreadReadIsObservable(required, { ...field, accessor: { getter: true, setter: false } }, shapes), true);
    assert.equal(rustRecordSpreadReadIsObservable(required, field, { ...shapes,
      definitionForCarrier: () => ({ dispatchName: "CheckedDispatch" }) }), true);
    assert.equal(rustRecordSpreadReadIsObservable(required, field, { ...shapes,
      field: () => ({ storage, nativeLayout: {} }) }), true);
  }
});

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
