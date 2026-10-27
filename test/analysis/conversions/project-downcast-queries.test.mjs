import assert from "node:assert/strict";
import test from "node:test";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { rustSourceTypeCarrier, rustOptionTargetType } from "../../../dist/target-model/types/index.js";
import { rustProjectDowncastEquals } from "../../../dist/target-model/records/operations/equality.js";

function fixture(kind = "closed") {
  const base = rustSourceTypeCarrier("/model.ts", "Base", "object", []);
  const derived = rustSourceTypeCarrier("/model.ts", "Derived", "object", []);
  const source = { kind: "class", declaration: {} };
  const target = { kind: "class", declaration: {} };
  let available = true;
  let resolutions = 0;
  const policy = {
    definitionForCarrier(carrier) {
      resolutions += 1;
      return available ? carrier.id === base.id ? source : carrier.id === derived.id ? target : undefined : undefined;
    },
    relationship: () => ({ kind: "related", targetType: base }),
    downcastRoute: () => kind === "generic" ? undefined : { kind, slot: "cast" },
    downcastRoutesFor: () => [],
  };
  return { base, derived, policy, setAvailable: value => { available = value; }, resolutions: () => resolutions };
}

test("native cast queries resolve and publish once per complete policy namespace", () => {
  for (const kind of ["closed", "checked"]) {
    const selected = fixture(kind);
    const builder = createRustProgramRecordBuilder();
    const builderRequiredRecords = [];
    const node = {};
    const optional = rustOptionTargetType(selected.base);
    const first = builder.projectDowncasts.resolve(builderRequiredRecords, node, optional, selected.derived, selected.policy);
    assert.equal(first === builder.projectDowncast.get(node), true, "complete canonical cast");
    assert.equal(first.projection.kind, kind);
    assert.equal(first.dispatchCarrier === selected.base, true);
    const counted = selected.resolutions();
    assert.equal(builder.projectDowncasts.resolve(builderRequiredRecords, node, { ...optional }, { ...selected.derived }, selected.policy) === first, true);
    assert.equal(selected.resolutions(), counted, "completed native policy does not rerun selection");
    assert.equal(builder.projectDowncasts.resolve(builderRequiredRecords, node, optional, selected.derived, { ...selected.policy }) === first, true);
    assert.equal(selected.resolutions() > counted, true, "another namespace validates the whole proof");
    const child = createRustProgramRecordBuilder(undefined, builder.seal(builderRequiredRecords));
    const childRequiredRecords = [];
    const beforeChild = selected.resolutions();
    assert.equal(child.projectDowncasts.resolve(childRequiredRecords, node, optional, selected.derived, selected.policy) === first, true);
    assert.equal(selected.resolutions() > beforeChild, true, "child does not inherit completion state");
    assert.throws(() => builder.projectDowncasts.resolve(builderRequiredRecords, node, optional, selected.derived,
      new Proxy({}, { get: () => assert.fail("closed query reads caller metadata") })), /after analysis is sealed/u);
    const conflicting = { ...selected.policy, downcastRoute: () => ({ kind, slot: "other" }) };
    assert.throws(() => child.projectDowncasts.resolve(childRequiredRecords, node, optional, selected.derived, conflicting), /Conflicting Rust semantic plan/u);
    assert.equal(child.projectDowncast.get(node) === first, true);
  }
});

test("unavailable cast premises stay retryable and flow facts never publish casts", () => {
  const selected = fixture();
  selected.setAvailable(false);
  const builder = createRustProgramRecordBuilder();
  const builderRequiredRecords = [];
  const node = {};
  assert.equal(builder.projectDowncasts.resolve(builderRequiredRecords, node, selected.base, selected.derived, selected.policy) === undefined, true);
  assert.equal(builder.projectDowncast.get(node) === undefined, true);
  selected.setAvailable(true);
  assert.equal(builder.projectDowncasts.resolve(builderRequiredRecords, node, selected.base, selected.derived, selected.policy) !== undefined, true);
  const narrowed = {};
  builder.flowReadProjections.project(narrowed, selected.base, selected.derived,
    { kind: "project-downcast", dispatchCarrier: selected.base, projection: { kind: "closed", slot: "cast" } });
  assert.equal(builder.projectDowncast.get(narrowed) === undefined, true);
});

test("native cast correspondence includes all physical carriers and the complete route", () => {
  const selected = fixture();
  const fact = { sourceCarrier: rustOptionTargetType(selected.base), dispatchCarrier: selected.base,
    targetCarrier: selected.derived, projection: { kind: "closed", slot: "cast" } };
  assert.equal(rustProjectDowncastEquals(fact, { ...fact, projection: { ...fact.projection } }), true);
  for (const change of [
    { sourceCarrier: selected.base }, { dispatchCarrier: selected.derived }, { targetCarrier: selected.base },
    { projection: { kind: "checked", slot: "cast" } }, { projection: { kind: "closed", slot: "other" } },
    { projection: { kind: "structural", slot: "cast" } }, { projection: { kind: "generic" } },
    { projection: { ...fact.projection, unknown: true } },
  ]) assert.equal(rustProjectDowncastEquals(fact, { ...fact, ...change }), false, "changed full native proof");
});
