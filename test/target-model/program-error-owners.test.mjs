import assert from "node:assert/strict";
import test from "node:test";
import { rustProgramErrorTargetType } from "../../dist/target-model/types/carriers/js.js";
import { rustProgramErrorOwner } from "../../dist/target-model/types/carriers/program-errors.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../dist/target-model/types/equality.js";
import { mapRustTargetTypes, substituteRustTargetTypeParameters } from "../../dist/target-model/types/carriers/substitution.js";
import { rustTargetTypeChildren } from "../../dist/target-model/types/carriers/children.js";
import { closedMetadataKey, snapshotClosedMetadata } from "../../dist/target-model/metadata/closed-data.js";

test("program errors have one explicit logical or exact physical owner identity throughout target metadata", () => {
  const selections = [{ kind: "logical" }, { kind: "physical", domain: "runtime" },
    { kind: "physical", domain: "project", componentId: "left" },
    { kind: "physical", domain: "project", componentId: "right" }];
  const carriers = selections.map(rustProgramErrorTargetType);
  assert.equal(new Set(carriers.map(closedMetadataKey)).size, selections.length);
  for (const [index, carrier] of carriers.entries()) {
    assert.equal(isRustTargetTypeRef(carrier), true);
    assert.equal(Object.isFrozen(carrier) && Object.isFrozen(carrier.errorOwner), true);
    assert.deepEqual(rustProgramErrorOwner(carrier), selections[index]);
    const nested = { kind: "tuple", elements: [carrier] };
    assert.equal(rustTargetTypeRefEquals(mapRustTargetTypes(nested, part => part), nested), true);
    assert.equal(rustTargetTypeRefEquals(rustTargetTypeChildren(nested)[0], carrier), true);
    assert.equal(rustTargetTypeRefEquals(snapshotClosedMetadata(carrier), carrier), true);
    assert.equal(rustTargetTypeRefEquals(substituteRustTargetTypeParameters(
      { kind: "type-parameter", identity: "argument", name: "Argument" }, new Map([["argument", carrier]])), carrier), true);
    for (const [otherIndex, other] of carriers.entries()) assert.equal(rustTargetTypeRefEquals(carrier, other), index === otherIndex);
  }
});

test("ownerless legacy program errors, malformed phases and accessor metadata are not carrier evidence", () => {
  const logical = rustProgramErrorTargetType();
  assert.equal(isRustTargetTypeRef({ kind: "target-named", id: logical.id }), false);
  for (const owner of [undefined, {}, { kind: "physical" }, { kind: "physical", domain: "project" },
    { kind: "physical", domain: "project", componentId: "" }, { kind: "logical", componentId: "other" },
    { kind: "physical", domain: "runtime", componentId: "other" }]) {
    const carrier = { ...logical, errorOwner: owner };
    assert.equal(isRustTargetTypeRef(carrier), false);
    assert.equal(rustProgramErrorOwner(carrier) === undefined, true);
    if (owner !== undefined) assert.throws(() => rustProgramErrorTargetType(owner));
  }
  assert.equal(isRustTargetTypeRef({ kind: "target-named", id: "rust.core.Infallible", errorOwner: { kind: "logical" } }), false);
  assert.equal(isRustTargetTypeRef({ ...logical, genericArguments: [{ kind: "type", type: logical }] }), false);
  let reads = 0;
  const owner = {};
  Object.defineProperty(owner, "kind", { enumerable: true, get() { reads++; return "logical"; } });
  assert.equal(isRustTargetTypeRef({ ...logical, errorOwner: owner }), false);
  assert.equal(rustProgramErrorOwner({ ...logical, errorOwner: owner }) === undefined, true);
  assert.equal(reads, 0);
});
