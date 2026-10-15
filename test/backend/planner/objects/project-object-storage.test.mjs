import assert from "node:assert/strict";
import test from "node:test";
import {
  enterRustProjectObjectMutableState, withRustProjectStoredField, readRustStructuralObjectField,
  writeRustProjectObjectField, readRustProjectPrivateField, writeRustProjectPrivateField,
  readRustProjectMethodOverride, writeRustProjectMethodOverride, readRustProjectObjectIndex,
  copyRustProjectObjectIndexStorage, writeRustProjectObjectIndex, mutateRustProjectObjectIndex,
  writeRustStructuralObjectField, mutateRustProjectObjectField, mutateRustStructuralObjectField, createRustProjectObject,
} from "../../../../dist/backend/planner/objects/project-objects.js";
import { printRustExpr } from "../../../../dist/print/source/expressions/core.js";
import { resolvedTargetStage, runTargetCompilationStages } from "@tsonic/target-api/artifacts";
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

test("project object construction selects its exact runtime owner for every legal representation", () => {
  const fields = [{ name: "count", value: { kind: "int-literal", text: "1" } }];
  const context = { kind: "path", path: "context" };
  const identity = { kind: "path", path: "identity" };
  const state = "CounterState { count: 1 }";
  const constructions = owner => [
    `Counter { state: ${owner}::new(${state}) }`,
    `Counter { state: ${owner}::with_context(${state}, context) }`,
    `Counter { state: ${owner}::with_context_and_identity(${state}, (), identity) }`,
    `Counter { state: ${owner}::with_context_and_identity(${state}, context, identity) }`,
  ];
  for (const [kind, expected] of [
    ["value", Array(4).fill("Counter { count: 1 }")],
    ["shared-immutable", constructions("rt::ObjectRef")],
    ["shared-mutable", constructions("rt::ObjectHandle")],
    ["closed-hierarchy", constructions("rt::ObjectHandle")],
    ["open-hierarchy", constructions("rt::ObjectHandle")],
  ]) {
    const printed = [[], [context], [undefined, identity], [context, identity]].map(extra =>
      printRustExpr(createRustProjectObject("Counter", "CounterState", fields, { kind }, ...extra)));
    assert.deepEqual(printed, expected, kind);
  }
});

test("an unclassified project object representation fails through the shared planning invariant", () => {
  let compiled;
  try {
    compiled = runTargetCompilationStages({
      analyze: () => resolvedTargetStage({}),
      plan: () => resolvedTargetStage(createRustProjectObject("Counter", "CounterState", [], { kind: "unclassified" })),
      materialize: () => ({ artifacts: [] }),
    });
  } catch {
    compiled = undefined;
  }
  assert.equal(compiled !== undefined, true, "malformed planner data is classified by the shared planning boundary");
  assert.equal(compiled.kind, "rejected");
  assert.equal(compiled.diagnostics.length, 1);
  const diagnostic = compiled.diagnostics[0];
  assert.equal(diagnostic.code, "TSONIC_INTERNAL_PLANNER_INVARIANT");
  assert.equal(diagnostic.category, "error");
  assert.equal(diagnostic.source, "tsonic-rust");
  assert.equal(diagnostic.message, "Polymorphic project objects require their dedicated construction planner.");
  assert.equal(diagnostic.sourceNode === undefined, true, "construction data carries no source node");
  assert.equal(Object.isFrozen(diagnostic), true);
});
