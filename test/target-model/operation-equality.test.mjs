import { rustTargetOperationFactEquals } from "../../dist/target-model/records/operations/operation-equality.js";
import assert from "node:assert/strict";
import test from "node:test";
import { assertRustInheritedRecordConflict, assertRustInheritedRecordCorrespondence } from "../helpers/records.mjs";

import { createRustProgramRecordBuilder } from "../../dist/analysis/program/records/create.js";
import { rustSelectedTargetSignatureEquals } from "../../dist/target-model/types/selected-call-equality.js";

const integer = { kind: "source-primitive", name: "int32" };
const text = { kind: "target-named", id: "rust.std.String" };
const first = Object.create(null);
const second = Object.create(null);
Object.defineProperty(first, "Parent", { get() { throw new Error("AST traversal is forbidden"); } });
Object.defineProperty(second, "Parent", { get() { throw new Error("AST traversal is forbidden"); } });
const sourceNodes = new Set([first, second]);

test("selected callable identity includes the exact generic owner independently of its receiver", () => {
  const signature = {
    member: { id: "owner.read", sourceName: "read", targetName: "read", kind: "method", parameters: [{ name: "value", type: integer }], returnType: integer },
    nativeParameterDeclarations: [first],
    sourceSelectedOwnerCarrier: integer,
    sourceSelectedReceiverCarrier: text,
  };
  assert.equal(rustSelectedTargetSignatureEquals(signature, copyMetadata(signature)), true);
  assert.equal(rustSelectedTargetSignatureEquals(signature, { ...signature, sourceSelectedOwnerCarrier: text }), false);
  assert.equal(rustSelectedTargetSignatureEquals(signature, { ...signature, sourceSelectedOwnerCarrier: undefined }), false);
  assert.equal(rustSelectedTargetSignatureEquals(signature, { ...signature, nativeParameterDeclarations: [second] }), false,
    "a same-shape native parameter cannot replace the original checked node");
  assert.equal(rustSelectedTargetSignatureEquals(signature, { ...signature, nativeParameterDeclarations: [] }), false,
    "a proven native input cannot disappear from the physical signature");
});

test("selected callable equality includes complete result projection correspondence", () => {
  const member = { id: "union.read", sourceName: "read", targetName: "read", kind: "method", parameters: [], returnType: integer };
  const projections = [
    ...["builtin-error", "option-value", "option-reference", "closed-native"].map(kind => ({ kind })),
    { kind: "source-union", dispatchCarrier: text, variant: "First" },
    { kind: "runtime-union", dispatchCarrier: text, variant: "First", project: undefined },
    { kind: "project-downcast", dispatchCarrier: text, projection: { kind: "closed", slot: "payload" } },
    { kind: "program-error-variant", variant: "First" },
    { kind: "union-map", dispatchCarrier: text, arms: [] },
  ].map(projection => ({ ...projection, sourceCarrier: text, selectedCarrier: integer }));
  for (const projection of projections) {
    const signature = { member, nativeParameterDeclarations: [], sourceResultProjection: projection };
    assert.equal(rustSelectedTargetSignatureEquals(signature, copyMetadata(signature)), true, projection.kind);
    const changes = [undefined, { ...projection, extra: true }, { ...projection, sourceCarrier: integer }, { ...projection, selectedCarrier: text },
      { ...projection, kind: projection.kind === "closed-native" ? "option-value" : "closed-native" }];
    if ("dispatchCarrier" in projection) changes.push({ ...projection, dispatchCarrier: integer });
    if ("variant" in projection) changes.push({ ...projection, variant: "Second" });
    if ("projection" in projection) changes.push({ ...projection, projection: { ...projection.projection, slot: "other" } });
    if ("arms" in projection) changes.push({ ...projection, arms: [{ carrier: integer, source: [], target: [] }] });
    if (projection.kind === "source-union") changes.push({ ...projection, project: undefined });
    if (projection.kind === "runtime-union") {
      const { project: ignored, ...absent } = projection;
      changes.push(absent);
    }
    for (const [index, changed] of changes.entries()) {
      assert.equal(rustSelectedTargetSignatureEquals(signature, { ...signature, sourceResultProjection: changed }), false,
        `${projection.kind} changed dimension ${index}`);
      assert.equal(rustSelectedTargetSignatureEquals({ ...signature, sourceResultProjection: changed }, signature), false,
        `${projection.kind} reverse correspondence ${index}`);
    }
  }
});

test("selected callable equality retains ordered union methods, opaque declarations and conversions", () => {
  const member = { id: "union.read", sourceName: "read", targetName: "read", kind: "method", parameters: [], returnType: integer };
  const variant = { name: "First", carrier: integer, declaration: first, targetName: "read",
    returnType: integer, resultConversion: { kind: "numeric-promotion", source: "int32", target: "number" } };
  const other = { ...variant, name: "Second", carrier: text, declaration: second, targetName: "read_other" };
  const signature = { member, nativeParameterDeclarations: [], sourceUnionMethods: { receiverCarrier: text, variants: [variant, other] } };
  assert.equal(rustSelectedTargetSignatureEquals(signature, copyMetadata(signature)), true);
  const variants = [
    [other, variant], [variant],
    ...[{ name: "Changed" }, { carrier: text }, { declaration: second }, { targetName: "changed" },
      { returnType: text }, { resultConversion: undefined },
      { resultConversion: { ...variant.resultConversion, target: "int64" } }]
      .map(change => [{ ...variant, ...change }, other]),
  ];
  const changes = [undefined, { ...signature.sourceUnionMethods, receiverCarrier: integer },
    ...variants.map(variants => ({ receiverCarrier: text, variants }))];
  for (const [index, sourceUnionMethods] of changes.entries()) {
    const changed = { ...signature, sourceUnionMethods };
    assert.equal(rustSelectedTargetSignatureEquals(signature, changed), false, `union method mutation ${index}`);
    assert.equal(rustSelectedTargetSignatureEquals(changed, signature), false, `reverse union method mutation ${index}`);
  }
});

test("selected-call admission rejects changed completion proof without replacing canonical evidence", () => {
  const builder = createRustProgramRecordBuilder();
  const subject = {};
  const signature = {
    member: { id: "union.read", sourceName: "read", targetName: "read", kind: "method", parameters: [], returnType: integer },
    nativeParameterDeclarations: [],
    sourceResultProjection: { kind: "closed-native", sourceCarrier: text, selectedCarrier: integer },
    sourceUnionMethods: { receiverCarrier: text, variants: [
      { name: "First", carrier: text, declaration: first, targetName: "read", returnType: integer, resultConversion: undefined },
    ] },
  };
  const request = { source: { call: subject } };
  const admit = selectedSignature => builder.selectedCalls.checked(request,
    { kind: "accept", value: { kind: "runtime", selectedSignature }, evidence: [] });
  admit(signature);
  assertRustInheritedRecordCorrespondence("selectedCall", subject, signature,
    candidate => candidate.selectedCalls.checked(request, { kind: "accept", value: { kind: "runtime", selectedSignature: copyMetadata(signature) }, evidence: [] }));
  for (const changed of [
    { ...signature, sourceResultProjection: { ...signature.sourceResultProjection, selectedCarrier: text } },
    { ...signature, sourceUnionMethods: { ...signature.sourceUnionMethods, variants: [] } },
  ]) {
    assertRustInheritedRecordConflict("selectedCall", subject, signature,
      candidate => candidate.selectedCalls.checked(request, { kind: "accept", value: { kind: "runtime", selectedSignature: changed }, evidence: [] }),
      /Conflicting Rust semantic plan 'tsonic.rust.selectedCall'/u);
    assert.equal(builder.selectedCall.get(subject) === signature, true);
  }
});

function copyMetadata(value, replace = undefined) {
  if (sourceNodes.has(value)) return replace?.(value) ?? value;
  if (Array.isArray(value)) return value.map(item => copyMetadata(item, replace));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyMetadata(item, replace)]));
  }
  return value;
}

const facts = [
  { kind: "closed-record-literal", fields: [{ property: first, expression: second, sourceName: "value" }] },
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
  { kind: "throw-op", error: { kind: "conversion", expression: first, conversion: {
    kind: "program-error", source: integer, target: text, route: { kind: "runtime", boundary: "target-runtime" },
  } } },
  { kind: "throw-op", error: { kind: "program", expression: second, carrier: text } },
  ...["shared-reference", "mutable-reference", "load"].map(operation =>
    ({ kind: "reference-operation", operation, operandExpression: first })),
  { kind: "reference-operation", operation: "store", operandExpression: first, valueExpression: second },
  { kind: "native-pointer", pointerExpression: first, valueExpression: second, offsetExpression: first },
].map(fact => ({ ...fact, operationId: `test.${fact.kind}`, resultCarrier: integer }));

test("every node-bearing operation compares exact opaque identities and closed metadata separately", () => {
  for (const fact of facts) {
    const equivalent = copyMetadata(fact);
    assert.equal(rustTargetOperationFactEquals(fact, equivalent), true, fact.operationId);
    assert.equal(rustTargetOperationFactEquals(fact,
      copyMetadata(fact, node => node === first ? second : first)), false, fact.operationId);
    assert.equal(rustTargetOperationFactEquals(fact, { ...equivalent, operationId: "changed" }), false);
    assert.equal(rustTargetOperationFactEquals(fact, { ...equivalent, resultCarrier: text }), false);
    assert.equal(rustTargetOperationFactEquals(fact, { ...equivalent, extra: Number.NaN }), false);
    const cycle = {};
    cycle.self = cycle;
    assert.equal(rustTargetOperationFactEquals(fact, { ...equivalent, extra: cycle }), false);
  }
});

test("runtime throw equality retains the independently selected native error boundary", () => {
  const fact = facts.find(item => item.kind === "throw-op");
  assert.equal(rustTargetOperationFactEquals(fact,
    { ...fact, error: { ...fact.error, conversion: { ...fact.error.conversion, route: { kind: "runtime", boundary: "provider-native" } } } }), false);
  assert.equal(rustTargetOperationFactEquals(fact,
    { ...fact, error: { ...fact.error, conversion: { ...fact.error.conversion, route: undefined } } }), false);
});

test("optional chain selection preserves exact opaque source identities", () => {
  const contract = {
    sourceGuardCarrier: { kind: "target-named", id: "rust.core.Option", typeArguments: [text] },
    selectedGuardCarrier: text, guardDepth: 1, innerResultCarrier: integer,
    resultCarrier: { kind: "target-named", id: "rust.core.Option", typeArguments: [integer] },
    lowering: "map",
  };
  const fact = { expression: first, guard: second, operationKind: "property", ...contract };
  const model = createRustProgramRecordBuilder();
  model.optionalChains.guard(first, second, "property", contract);
  assert.deepEqual(model.optionalChain.get(first), fact);
  assert.throws(() => model.optionalChains.guard(first, second, "property", copyMetadata(contract)),
    /Duplicate Rust semantic plan/u);
  assertRustInheritedRecordCorrespondence("optionalChain", first, fact,
    candidate => candidate.optionalChains.guard(first, second, "property", copyMetadata(contract)));
  assertRustInheritedRecordConflict("optionalChain", first, { ...fact, expression: second },
    candidate => candidate.optionalChains.guard(first, second, "property", contract), /Conflicting Rust semantic plan/u);
  for (const [guard, operationKind, mutation] of [
    [first, "property", {}], [second, "method", {}],
    [second, "property", { guardDepth: 2 }], [second, "property", { selectedGuardCarrier: integer }],
    [second, "property", { innerResultCarrier: text }], [second, "property", { lowering: "and-then" }],
  ]) {
    assertRustInheritedRecordConflict("optionalChain", first, fact,
      candidate => candidate.optionalChains.guard(first, guard, operationKind, { ...contract, ...mutation }),
      /Conflicting Rust semantic plan/u);
  }
});

test("repeated switch selection retains one contract and rejects every clause mutation", () => {
  const model = createRustProgramRecordBuilder();
  const subject = {};
  const fact = facts.find(item => item.kind === "switch");
  model.targetOperations.source(subject, fact);
  assertRustInheritedRecordCorrespondence("targetOperation", subject, fact,
    candidate => candidate.targetOperations.source(subject, copyMetadata(fact)));
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
    assertRustInheritedRecordConflict("targetOperation", subject, fact, candidate => candidate.targetOperations.source(subject, { ...fact, ...mutation }),
      /Conflicting Rust semantic plan/u);
  }
  assert.equal(model.seal([]).targetOperation.get(subject), fact);
  assert.throws(() => model.targetOperations.source(subject, fact), /sealed/u);
});
