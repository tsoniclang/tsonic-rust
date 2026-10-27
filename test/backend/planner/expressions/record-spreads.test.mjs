import assert from "node:assert/strict";
import test from "node:test";
import { planRustRecordSpread } from "../../../../dist/backend/planner/expressions/record-spreads.js";
import { rustOptionTargetType, rustStructuralObjectTargetType } from "../../../../dist/target-model/types/index.js";
import { analyzeRustRecordContributions, admitRustRecordContributions, rustRecordFinalFieldContributions, rustRecordSpreadRetainsField, rustRecordSpreadReadIsObservable } from "../../../../dist/analysis/reachability/record-contributions.js";
import { createRustRecordContributionProducer } from "../../../../dist/analysis/program/records/objects/record-contributions.js";
import { fakeAstReader, fakeStatement } from "../../../helpers/fake-compile-input.mjs";

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
  const property = fakeStatement({ kindName: "KindSpreadAssignment" });
  const spread = { kind: "spread", property, fields: [], methods: [], sourceStorage: "structural-object",
    sourceCarrier: rustOptionTargetType(source), sourceValueCarrier: source };
  const program = { source: { ast: fakeAstReader() } };
  const shapes = { field: () => assert.fail("an empty spread never selects a field"),
    definitionForCarrier: () => assert.fail("an empty spread never queries a physical definition") };
  for (const selected of [spread, { ...spread, sourceCarrier: source }]) {
    const fact = { contributions: [selected] };
    const contribution = analyzeRustRecordContributions(fact, shapes);
    const producer = createRustRecordContributionProducer(() => undefined);
    assert.equal(admitRustRecordContributions(program, new Map([[fact, contribution]]), producer).length, 0);
    assert.equal(producer.records.recordContribution.get(fact) === contribution, true,
      "the renderer receives the exact contribution admitted by its analysis owner");
    const evidence = contribution.spreads.get(selected);
    assert.equal(evidence.optional, selected === spread, "presence comes from the exact source carrier");
    const planned = planRustRecordSpread(selected, expression, [], [], new Map(), evidence, context());
    assert.equal(planned !== undefined, true, "the admitted empty spread retains its native evaluation");
    assert.equal(planned.bindings.length, 1);
    assert.equal(planned.bindings[0].value === expression, true, "the original source is evaluated once");
    assert.equal(planned.fields.size, 0);
    assert.throws(() => planRustRecordSpread(selected, expression, [], [{ kind: "spread" }],
      new Map(), evidence, context()), error => error?.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT" &&
        error.diagnostic.message === "An admitted spread method requires its exact source contract.",
    "a fabricated internal method cannot bypass the exact source contract");
  }
  const invalid = { ...spread, sourceValueCarrier: spread.sourceCarrier };
  const fact = { contributions: [invalid] };
  const contribution = analyzeRustRecordContributions(fact, shapes);
  const issues = admitRustRecordContributions(program, new Map([[fact, contribution]]),
    createRustRecordContributionProducer(() => undefined));
  assert.equal(issues.length, 1, "a mismatched native presence relation is rejected before rendering");
  assert.equal(issues[0].code, "RUST_UNSUPPORTED_AST");
  assert.equal(issues[0].sourceNode === property, true, "rejection retains the original source spread");
  assert.equal(issues[0].message,
    "Record spread requires its exact native source carrier and non-optional retained method storage. Node kind: KindSpreadAssignment.");
});

test("source contribution evidence owns last writes, observable reads and exact method identities", () => {
  const [firstMethod, secondMethod] = [{}, {}];
  const fields = [0, 1, 2].map(index => ({ sourceName: `field${index}`, sourceStorageIndex: index, targetStorageIndex: index }));
  const spread = { kind: "spread", sourceStorage: "structural-object", sourceCarrier: source,
    sourceValueCarrier: source, fields, methods: [{ contractDeclaration: firstMethod }] };
  const fact = { contributions: [spread, { kind: "property", targetStorageIndex: 1 },
    { kind: "property", targetStorageIndex: 2 }, { kind: "method", contractDeclarations: [firstMethod, secondMethod] }] };
  let observations = 0;
  const shapes = { field: (_carrier, index) => { observations += 1; return { storage: index === 1 ? "property" : "stored" }; },
    definitionForCarrier: () => ({}) };
  const evidence = analyzeRustRecordContributions(fact, shapes);
  assert.equal(evidence.finalFields.get(0), 0);
  assert.equal(evidence.finalFields.get(1), 1);
  assert.equal(evidence.finalFields.get(2), 2);
  assert.equal(evidence.finalMethods.get(firstMethod), 3);
  assert.equal(evidence.finalMethods.get(secondMethod), 3);
  assert.equal(evidence.finalMethods.has({}), false, "spelling cannot substitute for the checked contract declaration");
  const selected = evidence.spreads.get(spread);
  assert.equal(selected.retained.size, 1);
  assert.equal(selected.evaluated.size, 2);
  assert.equal(selected.retained.has(fields[0]), true);
  assert.equal(selected.retained.has(fields[1]), false);
  assert.equal(selected.evaluated.has(fields[1]), true, "overwriting a getter does not erase its observation");
  assert.equal(selected.evaluated.has(fields[2]), false, "an overwritten native stored field is not copied");
  assert.equal(observations, 2, "a retained field needs no redundant observability query");
});

test("native spread reconstruction consumes sealed evidence without reopening source selection", () => {
  const field = { sourceName: "value", sourceStorageIndex: 0, targetStorageIndex: 0 };
  const spread = { kind: "spread", sourceStorage: "structural-object", sourceCarrier: source,
    sourceValueCarrier: source, fields: [field], methods: [] };
  const fact = { contributions: [spread, { kind: "property", targetStorageIndex: 0 }] };
  const evidence = analyzeRustRecordContributions(fact, { field: () => ({ storage: "stored" }), definitionForCarrier: () => ({}) });
  const noSemanticReads = new Proxy({}, { get() { throw new Error("post-seal source selection"); } });
  const selected = planRustRecordSpread(spread, expression, [], [], new Map(), evidence.spreads.get(spread),
    { ...context(), input: { program: noSemanticReads } });
  assert.equal(selected === undefined, false);
  assert.equal(selected.bindings.length, 1);
  assert.equal(selected.bindings[0].value === expression, true, "the spread source remains evaluated once");
  assert.equal(selected.fields.size, 0, "an overwritten unobservable payload is not read or copied");
});
