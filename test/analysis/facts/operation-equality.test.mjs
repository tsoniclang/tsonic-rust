import assert from "node:assert/strict";
import test from "node:test";
import { rustOptionalChainFactKey, rustTargetOperationFactKey } from "../../../dist/analysis/facts/operations/keys.js";
import { createRustPlanBuilder } from "../../../dist/analysis/facts/plan-store.js";

const integer = { kind: "source-primitive", name: "int32" };
const text = { kind: "target-named", id: "rust.std.String" };
const first = Object.create(null);
const second = Object.create(null);
Object.defineProperty(first, "Parent", { get() { throw new Error("AST traversal is forbidden"); } });
Object.defineProperty(second, "Parent", { get() { throw new Error("AST traversal is forbidden"); } });
const sourceNodes = new Set([first, second]);

function copyMetadata(value, replace = undefined) {
  if (sourceNodes.has(value)) return replace?.(value) ?? value;
  if (Array.isArray(value)) return value.map(item => copyMetadata(item, replace));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyMetadata(item, replace)]));
  }
  return value;
}

const facts = [
  { kind: "template-string", substitutions: [{ expression: first, carrier: text }] },
  { kind: "switch", discriminantCarrier: text, clauses: [
    { clause: first, expression: second, carrier: text }, { clause: second },
  ] },
  { kind: "object-shape-projection", sourceValue: first, keyExpression: second, assignmentSource: first },
  { kind: "source-field", declaration: first, accessMode: "read", storageIndex: 0 },
  { kind: "source-method-property", declaration: first },
  { kind: "source-static-field", declaration: first, classReceiver: second },
  { kind: "source-accessor", read: { declaration: first, method: "read", resultCarrier: integer },
    write: { declaration: second, method: "write", valueCarrier: integer } },
  { kind: "source-union-field", variants: [
    { name: "Present", carrier: integer, field: { declaration: first } },
    { name: "Absent", carrier: text },
  ] },
  ...["function", "static-method", "constructor"].map(form =>
    ({ kind: "source-call", target: { form, classReceiver: first } })),
  { kind: "source-call", target: { form: "union-method", variants: [
    { declaration: first, carrier: integer }, { declaration: second, carrier: text },
  ] } },
  { kind: "provider-record-literal", fields: [{ property: first, expression: second, storageCarrier: integer }] },
  { kind: "record-literal", fields: [
    { implementationDeclaration: first, contractDeclarations: [first, second], carrier: integer },
  ], contributions: [
    { kind: "property", property: first, sourceName: "count", targetStorageIndex: 0 },
    { kind: "accessor", property: second, sourceName: "next", role: "get" },
    { kind: "structural-method", property: first, expression: second },
    { kind: "method", property: first, expression: second, contractDeclarations: [first, second] },
    { kind: "spread", property: first, expression: second, methods: [
      { contractDeclaration: first, sourceDeclaration: second, callableCarrier: integer },
    ] },
  ] },
  { kind: "record-index-literal", contributions: [
    { kind: "property", property: first, expression: second },
    { kind: "spread", property: second, expression: first },
  ] },
  { kind: "throw-op", error: { kind: "runtime", expression: first, carrier: integer } },
  ...["shared-reference", "mutable-reference", "load"].map(operation =>
    ({ kind: "reference-operation", operation, operandExpression: first })),
  { kind: "reference-operation", operation: "store", operandExpression: first, valueExpression: second,
    writeStrategy: { kind: "compound-assignment", operator: "+=", readExpression: first, rightExpression: second } },
  { kind: "native-pointer", pointerExpression: first, valueExpression: second, offsetExpression: first },
].map(fact => ({ ...fact, operationId: `test.${fact.kind}`, resultCarrier: integer }));

test("every node-bearing operation compares exact opaque identities and closed metadata separately", () => {
  for (const fact of facts) {
    const equivalent = copyMetadata(fact);
    assert.equal(rustTargetOperationFactKey.equals(fact, equivalent), true, fact.operationId);
    assert.equal(rustTargetOperationFactKey.equals(fact,
      copyMetadata(fact, node => node === first ? second : first)), false, fact.operationId);
    assert.equal(rustTargetOperationFactKey.equals(fact, { ...equivalent, operationId: "changed" }), false);
    assert.equal(rustTargetOperationFactKey.equals(fact, { ...equivalent, resultCarrier: text }), false);
    assert.equal(rustTargetOperationFactKey.equals(fact, { ...equivalent, extra: Number.NaN }), false);
    const cycle = {};
    cycle.self = cycle;
    assert.equal(rustTargetOperationFactKey.equals(fact, { ...equivalent, extra: cycle }), false);
  }
});

test("optional chain selection preserves exact opaque source identities", () => {
  const fact = {
    expression: first, guard: second, operationKind: "property",
    sourceGuardCarrier: { kind: "target-named", id: "rust.core.Option", typeArguments: [text] },
    selectedGuardCarrier: text, guardDepth: 1, innerResultCarrier: integer,
    resultCarrier: { kind: "target-named", id: "rust.core.Option", typeArguments: [integer] },
    lowering: "map",
  };
  const model = createRustPlanBuilder({ getFact: () => undefined });
  model.set(first, rustOptionalChainFactKey, fact);
  model.set(first, rustOptionalChainFactKey, copyMetadata(fact));
  for (const mutation of [
    { expression: second }, { guard: first }, { operationKind: "method" },
    { guardDepth: 2 }, { selectedGuardCarrier: integer },
    { innerResultCarrier: text }, { lowering: "and-then" },
  ]) {
    assert.throws(() => model.set(first, rustOptionalChainFactKey, { ...fact, ...mutation }),
      /Conflicting Rust semantic plan/u);
  }
});

test("repeated switch selection retains one contract and rejects every clause mutation", () => {
  const model = createRustPlanBuilder({ getFact: () => undefined });
  const subject = {};
  const fact = facts.find(item => item.kind === "switch");
  model.set(subject, rustTargetOperationFactKey, fact);
  model.set(subject, rustTargetOperationFactKey, copyMetadata(fact));
  const clauses = fact.clauses;
  for (const mutation of [
    { clauses: [...clauses].reverse() },
    { clauses: clauses.slice(1) },
    { clauses: [{ ...clauses[0], clause: second }, clauses[1]] },
    { clauses: [{ ...clauses[0], expression: first }, clauses[1]] },
    { clauses: [{ ...clauses[0], carrier: integer }, clauses[1]] },
    { clauses: [clauses[0], { ...clauses[1], expression: first, carrier: text }] },
    { discriminantCarrier: integer },
  ]) {
    assert.throws(() => model.set(subject, rustTargetOperationFactKey, { ...fact, ...mutation }),
      /Conflicting Rust semantic plan/u);
  }
  assert.equal(model.seal().get(subject, rustTargetOperationFactKey), fact);
  assert.throws(() => model.set(subject, rustTargetOperationFactKey, fact), /sealed/u);
});
