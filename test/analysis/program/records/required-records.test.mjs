import assert from "node:assert/strict";
import test from "node:test";
import { resolvedTargetStage, runTargetCompilationStages } from "@tsonic/target-api/artifacts";
import { analyzeRustOperations } from "../../../helpers/rust-operation-analysis.mjs";
import { analyzeRustErrorEffects } from "../../../helpers/rust-error-analysis.mjs";
import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";
import { createRustCarrierProbe } from "../../../../dist/analysis/program/carrier-probe.js";
import { assertRustRequiredRecords, requireRustRecord } from "../../../../dist/analysis/program/records/objects/required-records.js";

const { context, walk } = analyzeRustOperations("export function selected(value: number): number { return value; }", { surfaces: [] });
const subject = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node));
const other = context.ast.parameters(subject)[0];
assert.equal(subject !== undefined && other !== undefined, true);
const families = Object.keys(createRustProgramRecordBuilder().seal([]));
assert.equal(families.length, 68, "67 receiving families plus the one canonical native-handler family");

function requirement(family, node = subject) {
  return { subject: node, construct: "checked selected construct", family, producer: "selected native owner" };
}

function missingRecord(error, family, node = subject) {
  assert.equal(error.diagnostic?.code, "TSONIC_INTERNAL_ANALYSIS_INVARIANT");
  assert.equal(error.diagnostic?.source, "tsonic-rust");
  assert.equal(error.diagnostic?.category, "error");
  assert.equal(error.diagnostic?.sourceNode === node, true, "the exact checked subject survives failure transport");
  assert.equal(error.diagnostic?.message,
    `Required Rust semantic plan '${family}' was not published for 'checked selected construct' by 'selected native owner'.`);
  return true;
}

for (const family of families) test(`the required-record seal detects an omitted ${family} at its exact checked subject`, () => {
  const reads = [];
  const records = createRustRecordFixture(Object.fromEntries(families.map(selected => [selected, {
    get(node) {
      reads.push(selected);
      return selected === family && node === subject ? undefined : context.records[selected].get(node);
    },
  }])));
  assert.throws(() => assertRustRequiredRecords(records, [requirement(family)]), error => missingRecord(error, family));
  assert.deepEqual(reads, [family], "only the required family at its exact source subject is read");
});

test("false, zero and selected empty records are present, including through the canonical inherited reader", () => {
  const parent = createRustProgramRecordBuilder();
  parent.nativeGuardResults.resolve(subject, () => false);
  parent.memoryLayoutObservations.observe(other, 0);
  const inherited = createRustRecordFixture({ projectCallableAdapters: { get: node => node === subject ? Object.freeze([]) : undefined } }, parent);
  const child = createRustProgramRecordBuilder(undefined, inherited);
  const required = [requirement("nativeGuardResult"), requirement("memoryLayoutObservation", other), requirement("projectCallableAdapters")];
  assertRustRequiredRecords(child, required);
  const selected = child.seal(required);
  assert.equal(selected.nativeGuardResult.get(subject), false);
  assert.equal(selected.memoryLayoutObservation.get(other).value, 0);
  assert.equal(selected.projectCallableAdapters.get(subject).length, 0);
  assert.equal(Object.hasOwn(selected, "requiredRecords"), false);
  assert.equal(Object.hasOwn(selected, "requireRustRecord"), false);
});

test("a foreign checked subject cannot discharge the selected source identity", () => {
  const records = createRustRecordFixture({ nativeGuardResult: { get: node => node === subject ? false : undefined } });
  assert.throws(() => assertRustRequiredRecords(records, [requirement("nativeGuardResult", other)]),
    error => missingRecord(error, "nativeGuardResult", other));
});

test("required-record validation is linear and stops exactly at the first missing source premise", () => {
  let reads = 0;
  const records = createRustRecordFixture({ nativeGuardResult: {
    get(node) { reads++; return node === subject ? false : undefined; },
  } });
  const complete = Object.freeze(Array.from({ length: 4096 }, () => Object.freeze(requirement("nativeGuardResult"))));
  assertRustRequiredRecords(records, complete);
  assert.equal(reads, 4096);
  reads = 0;
  const incomplete = [...complete.slice(0, 97), requirement("nativeGuardResult", other), ...complete];
  assert.throws(() => assertRustRequiredRecords(records, incomplete), error => missingRecord(error, "nativeGuardResult", other));
  assert.equal(reads, 98, "the seal neither reselects source evidence nor scans after the first missing record");
  for (const position of [0, 2048, 4095]) {
    reads = 0;
    const rows = Object.freeze(complete.map((row, index) => index === position
      ? Object.freeze(requirement("nativeGuardResult", other)) : row));
    assert.throws(() => assertRustRequiredRecords(records, rows), error => missingRecord(error, "nativeGuardResult", other));
    assert.equal(reads, position + 1, "validation reads exactly through the first omitted premise");
  }
});

test("a failed mandatory seal cannot partially close either record store and a valid repair closes once", () => {
  const builder = createRustProgramRecordBuilder();
  const required = [requirement("nativeGuardResult")];
  assert.throws(() => builder.seal(required), error => missingRecord(error, "nativeGuardResult"));
  builder.assertOpen();
  builder.selectedOperations.checked(subject, { kind: "accept", value: {} });
  builder.nativeGuardResults.resolve(subject, () => false);
  const selected = builder.seal(required);
  assert.equal(selected.nativeGuardResult.get(subject), false);
  assert.throws(builder.assertOpen, /after analysis is sealed/u);
  assert.throws(() => builder.selectedOperations.checked(subject, { kind: "accept", value: {} }), /after analysis is sealed/u);
  assert.throws(() => builder.seal(required), /can be sealed only once/u);
  const unreadable = new Proxy([], { get() { assert.fail("already-sealed validation cannot inspect requirements"); } });
  assert.throws(() => builder.seal(unreadable), /can be sealed only once/u);
});

test("the removed zero-argument seal fails without closing either store", () => {
  const builder = createRustProgramRecordBuilder();
  assert.throws(() => builder.seal(), TypeError);
  builder.assertOpen();
  builder.selectedOperations.checked(subject, { kind: "accept", value: {} });
  builder.seal([]);
});

test("requirements are analysis-local selected data and every probe owns its own obligation inventory", () => {
  const parent = { ...walk, context: { ...context, requiredRecords: [] } };
  requireRustRecord(parent.context.requiredRecords, "nativeGuardResult", subject,
    "checked selected construct", "selected native owner");
  const child = createRustCarrierProbe(parent);
  const sibling = createRustCarrierProbe(parent);
  assert.equal(child.context.requiredRecords.length, 0);
  assert.equal(sibling.context.requiredRecords.length, 0);
  assert.equal(child.context.requiredRecords === parent.context.requiredRecords, false);
  assert.equal(child.context.requiredRecords === sibling.context.requiredRecords, false);
  requireRustRecord(child.context.requiredRecords, "nativeGuardResult", other,
    "checked selected construct", "selected native owner");
  assert.equal(child.context.requiredRecords[0].subject === other, true);
  assert.equal(parent.context.requiredRecords.length, 1);
  assert.equal(parent.context.requiredRecords[0].subject === subject, true);
  assert.equal(sibling.context.requiredRecords.length, 0);
});

test("a missing child-only premise cannot poison or seal the parent or a sibling probe", () => {
  const records = createRustProgramRecordBuilder();
  records.nativeGuardResults.resolve(subject, () => false);
  const parent = { ...walk, context: { ...context, records, requiredRecords: [requirement("nativeGuardResult")] } };
  const child = createRustCarrierProbe(parent);
  const sibling = createRustCarrierProbe(parent);
  child.context.requiredRecords.push(requirement("nativeGuardResult", other));
  assert.throws(() => child.context.records.seal(child.context.requiredRecords),
    error => missingRecord(error, "nativeGuardResult", other));
  child.context.records.assertOpen();
  parent.context.records.assertOpen();
  assert.equal(sibling.context.records.seal(sibling.context.requiredRecords).nativeGuardResult.get(subject), false);
  assert.equal(parent.context.records.seal(parent.context.requiredRecords).nativeGuardResult.get(subject), false);
});

test("an omitted actual native guard publication rejects in analysis without planning or partial artifacts", () => {
  const selected = analyzeRustErrorEffects(`
export function selected(): number { if (false) return 1; return 2; }
`, { surfaces: [] }, original => ({ ...original, records: { ...original.records,
    nativeGuardResults: { ...original.records.nativeGuardResults, resolve(_node, select) { return select(); } },
  } }));
  const omitted = selected.requiredRecords.find(row => row.family === "nativeGuardResult");
  assert.equal(omitted !== undefined, true, "the checked native selection registers independently of its omitted write");
  assert.equal(selected.records.nativeGuardResult.get(omitted.subject) === undefined, true);
  const result = runTargetCompilationStages({
    analyze: () => resolvedTargetStage(selected.records.seal(selected.requiredRecords)),
    plan() { assert.fail("missing selected records must never reach planning"); },
    materialize() { assert.fail("missing selected records must never produce artifacts"); },
  }, {
    analyzed() { assert.fail("rejected analysis must never be observed"); },
    planned() { assert.fail("rejected analysis must never publish a plan"); },
  });
  assert.equal(result.kind, "rejected");
  assert.equal(Object.hasOwn(result, "value"), false);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "TSONIC_INTERNAL_ANALYSIS_INVARIANT");
  assert.equal(result.diagnostics[0].sourceNode === omitted.subject, true);
});
