import assert from "node:assert/strict";
import test from "node:test";
import { selectRustSourceCallResult } from "../../../dist/policy/types/resolution/call-results.js";
import { sourceCallSelectedMemberMatches } from "../../../dist/backend/planner/expressions/calls/arguments.js";

const base = { kind: "target-named", id: "fixture.Base" };
const child = { kind: "target-named", id: "fixture.Child" };
const unrelated = { kind: "target-named", id: "fixture.Other" };
const scalar = { kind: "source-primitive", name: "uint64" };
const baseDefinition = { sourceName: "Base" };
const childDefinition = { sourceName: "Child" };
const route = { kind: "closed", slot: "child_view" };
const projectTypes = {
  definitionForCarrier: carrier => carrier === base ? baseDefinition : carrier === child ? childDefinition : undefined,
  relationship: (carrier, definition) => carrier === child && definition === baseDefinition
    ? { kind: "related", targetType: base } : { kind: "unrelated" },
  downcastRoute: () => route,
};

test("source result selection retains exact native and checked nominal carriers", () => {
  const result = selectRustSourceCallResult(projectTypes, base, () => child);
  assert.equal(result.nativeType, base);
  assert.equal(result.selectedType, child);
  assert.deepEqual(result.projection, { sourceCarrier: base, dispatchCarrier: base, targetCarrier: child, projection: route });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.projection));
  for (const selected of [base, unrelated, undefined]) {
    assert.deepEqual(selectRustSourceCallResult(projectTypes, base, () => selected), { nativeType: base, selectedType: base });
  }
  assert.deepEqual(selectRustSourceCallResult(projectTypes, scalar, () => assert.fail("native scalar result must not be reinterpreted")),
    { nativeType: scalar, selectedType: scalar });
});

test("nominal result selection rejects missing routes and incompatible generic ancestry", () => {
  assert.equal(selectRustSourceCallResult({ ...projectTypes, downcastRoute: () => undefined, downcastRoutesFor: () => [] }, base, () => child), undefined);
  const result = selectRustSourceCallResult({ ...projectTypes, relationship: () => ({ kind: "related", targetType: unrelated }) }, base, () => child);
  assert.deepEqual(result, { nativeType: base, selectedType: base });
});

test("source-call validation rejects stale or forged result correspondence", () => {
  const projection = selectRustSourceCallResult(projectTypes, base, () => child).projection;
  const selected = { member: { id: "fixture.set", kind: "method", targetName: "set", parameters: [], returnType: base },
    sourceResultProjection: projection };
  const fact = { kind: "source-call", operationId: "fixture.set", target: { form: "method", name: "set", mutatesSelf: false },
    parameters: [], resultCarrier: child, resultProjection: projection };
  const matches = (candidate, signature = selected) => sourceCallSelectedMemberMatches(candidate, signature, base, carrier => carrier);
  assert.equal(matches(fact), true);
  for (const field of ["sourceCarrier", "dispatchCarrier", "targetCarrier"]) {
    assert.equal(matches({ ...fact, resultProjection: { ...projection, [field]: unrelated } }), false);
  }
  assert.equal(matches({ ...fact, resultProjection: { ...projection, projection: { ...route, slot: "unrelated" } } }), false);
  assert.equal(matches({ ...fact, resultProjection: undefined }), false);
  assert.equal(matches(fact, { ...selected, sourceResultProjection: undefined }), false);
  assert.equal(matches({ ...fact, resultCarrier: base }), false);
});
