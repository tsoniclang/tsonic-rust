import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { createRustGenericCallableDispatchPlan, prepareRustGenericCallableDispatchRequests,
  selectRustGenericCallableInvocationStorage } from "../../../dist/analysis/callables/generics/generic-dispatch.js";



function fixture() {
  const source = Object.freeze({ fileName: "/project/index.ts" });
  const calledDeclaration = Object.freeze({});
  const transportedDeclaration = Object.freeze({});
  const bridgedDeclaration = Object.freeze({});
  const called = Object.freeze({ ownerFileName: source.fileName,
    members: [{ implementation: { declaration: calledDeclaration } }] });
  const transported = Object.freeze({ ownerFileName: source.fileName,
    members: [{ implementation: { declaration: transportedDeclaration } }] });
  const bridged = Object.freeze({ ownerFileName: source.fileName,
    members: [{ implementation: { declaration: bridgedDeclaration } }] });
  const published = Object.freeze({ ownerFileName: "/library/index.ts" });
  const carrier = Object.freeze({ kind: "target-named", id: "callable" });
  const callee = Object.freeze({ kind: "Identifier" });
  const invocation = Object.freeze({ Expression: callee });
  const operation = Object.freeze({ kind: "source-call", target: { form: "callable", carrier } });
  let storageReads = 0;
  const input = {
    ast: { getFileName: file => file.fileName,
      is: Object.fromEntries(["ExpressionStatement", "ReturnStatement", "ThrowStatement", "IfStatement",
        "WhileStatement", "DoStatement", "ForOfStatement", "ForInStatement", "PropertyAccessExpression",
        "ElementAccessExpression", "CallExpression"].map(kind =>
        [`Is${kind}`, node => kind === "CallExpression" && node === invocation])),
      as: { AsCallExpression: node => node },
    },
    records: createRustRecordFixture({targetOperation: { get: (node) => node === invocation ? operation
    : node === callee && false ? { carrier } : undefined },
runtimeCarrier: { get: (node) => node === invocation && false ? operation
    : node === callee ? { carrier } : undefined },
conversion: { get: () => undefined }}),
    generic: { definitionFor: selected => selected === carrier ? called : undefined,
      physical: { definitionFor: selected => selected === carrier ? called : undefined,
        definitions: () => [called, transported, bridged] } },
    structuralShapes: { field: () => undefined },
    nativeStorage: { invocationCallableFor(node) {
      storageReads++;
      assert.equal(node === invocation, true, "physical selection uses the exact selected invocation");
      return { kind: "resolved", carrier };
    } },
    nodes: [source, invocation],
    closedSourceFiles: new Set([source]),
    nativeGenericProducers: { bindings: [{ definition: bridged }] },
  };
  return { input, invocation, operation, carrier, called, transported, bridged, published,
    storageReads: () => storageReads };
}

test("generic dispatch retains direct calls, native bridges and published boundaries, not transport-only families", () => {
  const current = fixture();
  const invocations = prepareRustGenericCallableDispatchRequests(current.input);
  const plan = createRustGenericCallableDispatchPlan({ ...current.input, invocations });
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(plan.requiredFor(current.called), true);
  assert.equal(plan.requiredFor(current.bridged), true);
  assert.equal(plan.requiredFor(current.published), true);
  assert.equal(plan.requiredFor(current.transported), false);
  assert.equal(plan.usesDeclarationBody(current.called.members[0].implementation.declaration), true);
  assert.equal(plan.usesDeclarationBody(current.bridged.members[0].implementation.declaration), true);
  assert.equal(plan.usesDeclarationBody(current.transported.members[0].implementation.declaration), false);
  assert.equal(plan.usesDeclarationBody({}), false, "foreign declarations have no body-use proof");
  for (let count = 0; count < 128; count++) {
    assert.equal(plan.requiredFor(current.called), true);
    assert.equal(plan.requiredFor(current.transported), false);
  }
  assert.equal(current.storageReads(), 1, "the immutable demand plan never rescans at each emitted family");
  const published = createRustGenericCallableDispatchPlan({ ...current.input, closedSourceFiles: new Set(), invocations });
  assert.equal(published.requiredFor(current.transported), true, "a separately consumed library retains its callable API");
  assert.equal(published.usesDeclarationBody(current.transported.members[0].implementation.declaration), true);
});

test("generic invocation storage is exact and does not manufacture a family from absent evidence", () => {
  const current = fixture();
  const selected = selectRustGenericCallableInvocationStorage(current.invocation, current.input);
  assert.equal(selected?.definition === current.called && selected.carrier === current.carrier &&
    selected.operation === current.operation, true);
  for (const changed of [
    { ...current.input, records: createRustRecordFixture({}) },
    { ...current.input, ast: { ...current.input.ast, as: { AsCallExpression: () => undefined } } },
    { ...current.input, nativeStorage: { invocationCallableFor: () => ({ kind: "unresolved", reason: "missing exact storage" }) } },
    { ...current.input, generic: { ...current.input.generic, physical: { definitionFor: () => undefined } } },
  ]) assert.equal(selectRustGenericCallableInvocationStorage(current.invocation, changed) === undefined, true);
});

test("nongeneric source calls never request unrelated physical callable storage", () => {
  const current = fixture();
  const input = { ...current.input, generic: { ...current.input.generic, definitionFor: () => undefined },
    nativeStorage: { invocationCallableFor() { throw new Error("unrelated source call must not enter physical generic analysis"); } } };
  assert.equal(selectRustGenericCallableInvocationStorage(current.invocation, input) === undefined, true);
});
