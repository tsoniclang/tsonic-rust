import assert from "node:assert/strict";
import test from "node:test";
import { rustRawLocationRoot, planRustSourceLocationStorage } from "../../../../dist/backend/planner/expressions/typed-locations.js";
import { planRustProjectedObjectLocation } from "../../../../dist/backend/planner/expressions/object-field-locations.js";
import { writeRustProjectDispatchedField } from "../../../../dist/backend/planner/objects/project-objects.js";
import { rustTargetOperationFactKey } from "../../../../dist/analysis/facts/keys.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";

test("dispatched field writes borrow their physical receiver instead of consuming or cloning it", () => {
  const owner = { kind: "path", path: "owner" };
  for (const receiver of [owner, { kind: "reference", expr: owner }]) {
    for (const operator of ["=", "+="]) {
      const value = { kind: "int-literal", value: "7" };
      const write = writeRustProjectDispatchedField(receiver, "selected_owner", "read", "write", operator, value);
      const binding = write.body.statements[0];
      assert.equal(binding.name, "selected_owner");
      assert.equal(binding.init.kind, "reference");
      assert.equal(binding.init.expr === owner, true, "repeatable native field operations retain the same owner");
      assert.equal(write.body.statements.length, 2, "one receiver selection and one write expression");
    }
  }
});

test("prepared physical addresses transfer one existing handle without reconstructing or recloning a local", () => {
  const expression = {};
  const value = { kind: "method-call", receiver: { kind: "path", path: "frame.seed" }, method: "clone", args: [] };
  let queries = 0;
  const context = { valueFieldLocations: new Map([[expression, { address: (member, selected) => {
    assert.equal(selected === context, true, "query receives the current consuming context");
    assert.equal(member, undefined);
    queries += 1;
    return { kind: "infallible", value };
  } }]]) };
  for (const cloneRoot of [false, true]) assert.equal(rustRawLocationRoot(expression, context, cloneRoot) === value, true,
    "prepared owner already supplies one owned physical handle");
  assert.equal(queries, 2);
});

test("prepared field addresses retain their exact member and current failure domain without infallible erasure", () => {
  const expression = {};
  const value = { kind: "path", path: "native_field_pointer" };
  const context = { input: { program: { facts: { getFact: (node, key) =>
    node === expression && key === rustTargetOperationFactKey ? { kind: "source-field", operationId: "exact-member" } : undefined } } },
    valueFieldLocations: new Map([[expression, { address: (member, selected) => {
      assert.equal(selected === context, true, "query must not retain its preparation context");
      return member === "exact-member" ? { kind: "fallible", value } : undefined;
    } }]]) };
  assert.equal(rustRawLocationRoot(expression, context), undefined, "fallible field pointers are not raw infallible roots");
  assert.equal(planRustSourceLocationStorage(expression, expression, context, () => {
    assert.fail("prepared field address must not reconstruct a source receiver");
  }) === value, true, "selected fallible pointer passes through without another adapter");
});

test("native projected addresses clone one auto-borrowed owner and select each physical callback once", () => {
  const context = { fallibleBoundary: { errorTypePath: "ExactError", errorTypeIdentity: "exact-error" },
    syntheticNames: createRustSyntheticNameState({ kindName: () => "KindBlock", forEachChild: () => {} }, {}, []),
    usedAliases: new Set() };
  const owner = { kind: "path", path: "owner" };
  let reads = 0;
  let writes = 0;
  const address = planRustProjectedObjectLocation({ kind: "reference", expr: owner }, "exact-member", context,
    reader => { reads += 1; return { kind: "field", receiver: reader, name: "seed" }; },
    (writer, value) => { writes += 1; return { kind: "assignment", operator: "=",
      target: { kind: "field", receiver: writer, name: "seed" }, value }; });
  assert.equal(reads, 1);
  assert.equal(writes, 1);
  assert.equal(address.kind, "block");
  const initialization = address.body.statements[0].init;
  assert.equal(initialization.kind, "method-call");
  assert.equal(initialization.method, "clone");
  assert.equal(initialization.receiver === owner, true, "native method auto-borrow avoids (&owner).clone()");
  const readCallback = address.body.statements.at(-1).expr.args[2];
  assert.equal(readCallback.body.genericArguments[1].type.path, "ExactError",
    "even a discarded native address retains its exact error domain");
  assert.equal(readCallback.body.genericArguments[1].type.identity, "exact-error");
  assert.equal(context.usedAliases.has("rt"), true);
});
