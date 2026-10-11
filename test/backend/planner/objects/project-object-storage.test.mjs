import assert from "node:assert/strict";
import test from "node:test";
import {
  enterRustProjectObjectMutableState, withRustProjectStoredField, readRustStructuralObjectField,
  writeRustProjectObjectField, readRustProjectPrivateField, writeRustProjectPrivateField,
  readRustProjectMethodOverride, writeRustProjectMethodOverride, readRustProjectObjectIndex,
  copyRustProjectObjectIndexStorage, writeRustProjectObjectIndex, mutateRustProjectObjectIndex,
  writeRustStructuralObjectField, mutateRustProjectObjectField, mutateRustStructuralObjectField,
} from "../../../../dist/backend/planner/objects/project-objects.js";
import { maxWritesInStatements } from "../../../../dist/backend/target-ast/inspection/source-dataflow.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";

test("object storage scopes borrow their handles while preserving actual writes to captured locals", () => {
  const owner = { kind: "path", path: "owner" };
  const value = { kind: "int-literal", text: "1" };
  const carrier = rustSourcePrimitiveTargetType("int32");
  const representation = { kind: "shared-mutable" };
  const expressions = [
    enterRustProjectObjectMutableState(owner, "state", value),
    withRustProjectStoredField(owner, "field", representation, field => field),
    readRustStructuralObjectField(owner, "field", carrier),
    writeRustProjectObjectField(owner, "field", "=", value, representation),
    readRustProjectPrivateField(owner, ["field"], "read", representation),
    writeRustProjectPrivateField(owner, ["field"], "write", value, representation),
    readRustProjectMethodOverride(owner, "field", representation),
    writeRustProjectMethodOverride(owner, "field", value, representation),
    readRustProjectObjectIndex(owner, "entries", value, carrier, representation),
    copyRustProjectObjectIndexStorage(owner, "entries", { kind: "path", path: "destination" }, representation),
    writeRustProjectObjectIndex(owner, "entries", value, value, representation),
    mutateRustProjectObjectIndex(owner, "entries", value, field => field, representation),
    writeRustStructuralObjectField(owner, "field", "=", value),
    mutateRustProjectObjectField(owner, "field", field => field, representation),
    mutateRustStructuralObjectField(owner, "field", field => field),
  ];
  for (const [index, expression] of expressions.entries()) {
    assert.equal(expression !== undefined, true, `selected builder ${index}`);
    assert.equal(expression.receiverMode, "ref", `exact runtime receiver contract ${index}`);
    assert.equal(maxWritesInStatements([{ kind: "expr", expr: expression }], "owner"), 0, `handle binding ${index}`);
  }
  const mutated = withRustProjectStoredField(owner, "field", representation, () => ({
    kind: "assignment", operator: "=", target: { kind: "path", path: "captured" }, value,
  }));
  assert.equal(maxWritesInStatements([{ kind: "expr", expr: mutated }], "captured"), 2);
  const unknown = { kind: "method-call", receiver: owner, method: "unclassified", args: [] };
  assert.equal(maxWritesInStatements([{ kind: "expr", expr: unknown }], "owner"), 2, "unknown receivers remain conservative");
  const direct = writeRustProjectObjectField(owner, "field", "=", value, { kind: "value" });
  assert.equal(maxWritesInStatements([{ kind: "expr", expr: direct }], "owner"), 1, "direct value storage still needs mutability");
});
