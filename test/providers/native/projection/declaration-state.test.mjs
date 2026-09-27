import assert from "node:assert/strict";
import test from "node:test";
import { refineNativeExportDeclaration } from "../../../../dist/providers/native/projection/declaration-state.js";

test("native declaration completion preserves exact headers and never regresses completed members", () => {
  const header = { id: "example::Value", name: "Value", kind: "class", members: [] };
  const complete = { ...header, members: [{ id: "example::Value::read", name: "read", kind: "method",
    signatures: [{ id: "read::signature", parameters: [], returnType: { kind: "number" } }] }] };
  assert.equal(refineNativeExportDeclaration(undefined, header, false, false), header);
  assert.equal(refineNativeExportDeclaration(header, complete, false, true), complete);
  assert.equal(refineNativeExportDeclaration(complete, header, true, false), complete);
  assert.equal(refineNativeExportDeclaration(complete, structuredClone(complete), true, true), complete);
  assert.throws(() => refineNativeExportDeclaration(header, complete, false, false), /incomplete.*contains members/u);
  for (const mutation of [{ ...complete, name: "Different" }, { ...complete, kind: "interface" },
    { ...complete, members: [] }, { ...complete, members: [{ ...complete.members[0], name: "wrong" }] }]) {
    assert.throws(() => refineNativeExportDeclaration(complete, mutation, true, true), /conflicting projections/u);
  }
});
