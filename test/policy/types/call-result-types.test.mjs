import assert from "node:assert/strict";
import test from "node:test";
import { selectRustSourceCallResult } from "../../../dist/policy/types/resolution/call-results.js";
import { sourceCallSelectedMemberMatches } from "../../../dist/backend/planner/expressions/calls/arguments.js";
import { rustJsValueTargetType, rustSourcePrimitiveTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

const base = { kind: "target-named", id: "fixture.Base" };
const child = { kind: "target-named", id: "fixture.Child" };
const unrelated = { kind: "target-named", id: "fixture.Other" };
const scalar = { kind: "source-primitive", name: "uint64" };
const baseDefinition = { sourceName: "Base" };
const childDefinition = { sourceName: "Child" };
const route = { kind: "closed", slot: "child_view" };
const projectTypes = {
  definitionForCarrier: carrier => rustTargetTypeRefEquals(carrier, base) ? baseDefinition : rustTargetTypeRefEquals(carrier, child) ? childDefinition : undefined,
  relationship: (carrier, definition) => rustTargetTypeRefEquals(carrier, child) && definition === baseDefinition
    ? { kind: "related", targetType: base } : { kind: "unrelated" },
  downcastRoute: () => route,
};

test("source result selection retains exact native and checked nominal carriers", () => {
  const result = selectRustSourceCallResult(projectTypes, base, () => child);
  assert.equal(result.nativeType, base);
  assert.equal(result.selectedType, child);
  assert.deepEqual(result.projection, { kind: "project-downcast", sourceCarrier: base, dispatchCarrier: base, selectedCarrier: child, projection: route });
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
  const matches = (candidate, signature = selected) => sourceCallSelectedMemberMatches(candidate, signature, base, carrier => carrier, projectTypes);
  assert.equal(matches(fact), true);
  for (const field of ["sourceCarrier", "dispatchCarrier", "selectedCarrier"]) {
    assert.equal(matches({ ...fact, resultProjection: { ...projection, [field]: unrelated } }), false);
  }
  assert.equal(matches({ ...fact, resultProjection: { ...projection, projection: { ...route, slot: "unrelated" } } }), false);
  assert.equal(matches({ ...fact, resultProjection: undefined }), false);
  assert.equal(matches(fact, { ...selected, sourceResultProjection: undefined }), false);
  assert.equal(matches({ ...fact, resultCarrier: base }), false);
  assert.equal(matches({ ...fact, resultProjection: { ...projection, extra: true } }), false);
  assert.equal(matches(fact, { ...selected, sourceResultProjection: { ...projection, projection: { ...route, slot: "unrelated" } } }), false);
  assert.equal(sourceCallSelectedMemberMatches(fact, selected, base, carrier => carrier, undefined), false);
});

test("broad implementation storage uses the canonical exact native payload projection", () => {
  const native = rustJsValueTargetType();
  for (const selectedType of [rustSourcePrimitiveTargetType("float64"), rustStringTargetType(), scalar]) {
    const result = selectRustSourceCallResult(projectTypes, native, () => selectedType);
    assert.equal(result.nativeType, native);
    assert.equal(result.selectedType, selectedType);
    assert.equal(result.projection.kind, "runtime-union");
    const signature = { member: { id: "fixture.read", kind: "method", targetName: "read", parameters: [], returnType: native },
      sourceResultProjection: result.projection };
    const fact = { kind: "source-call", operationId: "fixture.read", target: { form: "method", name: "read", mutatesSelf: false },
      parameters: [], resultCarrier: selectedType, resultProjection: result.projection };
    const matches = candidate => sourceCallSelectedMemberMatches(candidate, signature, native, carrier => carrier, projectTypes);
    assert.equal(matches(fact), true);
    assert.equal(matches({ ...fact, resultProjection: { ...result.projection, variant: "Other" } }), false);
    assert.equal(matches({ ...fact, resultProjection: { ...result.projection, selectedCarrier: unrelated } }), false);
    assert.equal(matches({ ...fact, resultProjection: { ...result.projection, extra: true } }), false);
    assert.equal(matches({ ...fact, resultProjection: undefined }), false);
  }
  assert.deepEqual(selectRustSourceCallResult(projectTypes, native, () => native), { nativeType: native, selectedType: native });
  assert.equal(selectRustSourceCallResult(projectTypes, native, () => undefined), undefined);
  assert.equal(selectRustSourceCallResult(projectTypes, native, () => unrelated), undefined);
});
