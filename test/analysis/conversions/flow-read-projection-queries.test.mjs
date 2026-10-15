import assert from "node:assert/strict";
import test from "node:test";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { createRustFlowReadProjectionQueries } from "../../../dist/analysis/control-flow/flow-read-projections.js";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustOptionTargetType, rustSourcePrimitiveTargetType, rustSourceUnionTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";

const integer = rustSourcePrimitiveTargetType("int32");
const boolean = rustSourcePrimitiveTargetType("bool");
const projectTypes = Object.freeze({ definitionForCarrier: () => undefined });

function unionFixture() {
  const registry = createRustTypeDefinitionRegistry();
  const union = rustSourceUnionTargetType("/probe/index.ts", "Values");
  assert.equal(registry.registerSourceUnion({ carrier: union, variants: [
    { name: "Value", carrier: integer }, { name: "Text", carrier: rustStringTargetType() },
  ] }, true), true);
  const original = registry.seal();
  let reads = 0;
  const definitions = { ...original, sourceUnionVariants(carrier) { reads++; return original.sourceUnionVariants(carrier); } };
  return { union, definitions, reads: () => reads };
}

test("flow queries resolve once, admit once and validate the canonical complete native fact", () => {
  const { union, definitions, reads } = unionFixture();
  const records = createRustProgramRecordBuilder();
  const recordsRequiredRecords = [];
  let admissions = 0;
  const queries = createRustFlowReadProjectionQueries({ assertOpen: records.assertOpen, records: records.flowReadProjection,
    publish(subject, fact) { admissions++; records.flowReadProjections.project(subject, fact.sourceCarrier, fact.selectedCarrier, fact); },
  });
  const subject = {};
  const first = queries.resolve(recordsRequiredRecords, subject, union, integer, projectTypes, definitions);
  assert.equal(first.kind, "projection");
  assert.equal(first.fact === records.flowReadProjection.get(subject), true);
  const resolvedReads = reads();
  assert.equal(resolvedReads > 0, true, "the real native union selector is exercised");
  assert.equal(queries.resolve(recordsRequiredRecords, subject, union, { ...integer }, projectTypes, definitions).fact === first.fact, true);
  assert.equal(queries.validate(subject, union, projectTypes, definitions).fact === first.fact, true);
  assert.equal(reads(), resolvedReads, "neither complete query re-enters native selection");
  assert.equal(admissions, 1);
  assert.equal(queries.validate({}, union, projectTypes, definitions) === undefined, true);
  assert.equal(queries.validate(subject, boolean, projectTypes, definitions).kind, "incompatible");
  assert.throws(() => queries.resolve(recordsRequiredRecords, subject, union, union, projectTypes, definitions), /Conflicting Rust semantic plan/u);
  assert.equal(records.flowReadProjection.get(subject) === first.fact, true);
  records.seal(recordsRequiredRecords);
  const unreadable = new Proxy({}, { get() { throw new Error("closed query read caller metadata"); } });
  assert.throws(() => queries.resolve(recordsRequiredRecords, subject, unreadable, unreadable, unreadable, unreadable), /sealed/u);
  assert.throws(() => queries.validate(subject, unreadable, unreadable, unreadable), /sealed/u);
});

test("an inherited flow proof and a new native namespace are fully revalidated without child admission", () => {
  const { union, definitions, reads } = unionFixture();
  const parent = createRustProgramRecordBuilder();
  const parentRequiredRecords = [];
  const child = createRustProgramRecordBuilder(undefined, parent);
  const childRequiredRecords = [];
  const subject = {};
  const first = parent.flowReadProjections.resolve(parentRequiredRecords, subject, union, integer, projectTypes, definitions);
  const parentReads = reads();
  const inherited = child.flowReadProjections.resolve(childRequiredRecords, subject, union, integer, projectTypes, definitions);
  assert.equal(inherited.fact === first.fact, true);
  assert.equal(reads() > parentReads, true, "a child does not inherit completion state");
  const childReads = reads();
  child.flowReadProjections.resolve(childRequiredRecords, subject, union, integer, projectTypes, definitions);
  assert.equal(reads(), childReads);
  child.flowReadProjections.resolve(childRequiredRecords, subject, union, integer, { ...projectTypes }, definitions);
  assert.equal(reads() > childReads, true, "a different policy is not the same completed native request");
  const policyReads = reads();
  child.flowReadProjections.resolve(childRequiredRecords, subject, union, integer, projectTypes, { ...definitions });
  assert.equal(reads() > policyReads, true, "a different definitions reader is fully checked");
});

test("validation refuses forged variants, dispatch, result and extra metadata through its original failure channel", () => {
  const { union, definitions } = unionFixture();
  const parent = createRustProgramRecordBuilder();
  const parentRequiredRecords = [];
  const subject = {};
  const first = parent.flowReadProjections.resolve(parentRequiredRecords, subject, union, integer, projectTypes, definitions);
  let existing = first.fact;
  let lookups = 0;
  const queries = createRustFlowReadProjectionQueries({ assertOpen: () => {},
    records: { get() { lookups++; return existing; } }, publish: () => assert.fail("validation never admits"),
  });
  assert.equal(queries.validate(subject, union, projectTypes, definitions).fact === first.fact, true);
  for (const mutation of [{ variant: "Missing" }, { dispatchCarrier: integer }, { selectedCarrier: boolean }, { extra: true }]) {
    existing = { ...first.fact, ...mutation };
    assert.equal(queries.validate(subject, union, projectTypes, definitions).kind, "incompatible");
  }
  assert.equal(lookups, 5, "each request reads the canonical family once");
  existing = first.fact;
  assert.equal(queries.validate(subject, union, projectTypes, definitions).fact === first.fact, true);
});

test("option queries retain distinct shared-value and mutable-reference projections", () => {
  for (const selected of [integer, { kind: "reference", mutable: true, referent: integer, lifetime: { kind: "static" } }]) {
    const records = createRustProgramRecordBuilder();
    const recordsRequiredRecords = [];
    const subject = {};
    const first = records.flowReadProjections.resolve(recordsRequiredRecords, subject, rustOptionTargetType(selected), selected, projectTypes, emptyRustTypeDefinitions);
    assert.equal(first.kind, "projection");
    assert.equal(first.fact.kind, selected.kind === "reference" ? "option-reference" : "option-value");
    assert.equal(first.fact.selectedCarrier === selected, true);
  }
});

test("an incomplete nested native definition stays retryable until its proof is complete", () => {
  const registry = createRustTypeDefinitionRegistry();
  const outer = rustSourceUnionTargetType("/probe/index.ts", "Outer");
  const nested = rustSourceUnionTargetType("/probe/index.ts", "Nested");
  assert.equal(registry.registerSourceUnion({ carrier: outer, variants: [
    { name: "Value", carrier: integer }, { name: "Nested", carrier: nested },
  ] }, true), true);
  const records = createRustProgramRecordBuilder();
  const recordsRequiredRecords = [];
  const subject = {};
  assert.equal(records.flowReadProjections.resolve(recordsRequiredRecords, subject, outer, integer, projectTypes, registry).kind, "incompatible");
  assert.equal(records.flowReadProjection.get(subject) === undefined, true, "incomplete native evidence is not published");
  assert.equal(registry.registerSourceUnion({ carrier: nested, variants: [
    { name: "Flag", carrier: boolean }, { name: "Text", carrier: rustStringTargetType() },
  ] }, true), true);
  const first = records.flowReadProjections.resolve(recordsRequiredRecords, subject, outer, integer, projectTypes, registry);
  assert.equal(first.kind, "projection");
  assert.equal(first.fact.variant, "Value");
  assert.equal(records.flowReadProjections.resolve(recordsRequiredRecords, subject, outer, integer, projectTypes, registry).fact === first.fact, true);
});
