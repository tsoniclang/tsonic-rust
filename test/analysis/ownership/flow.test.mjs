import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { checkedSource } from "../../../../tsonic/test/fixtures/source-navigation.mjs";
import { analyzeRustOwnershipFlow } from "../../../dist/analysis/ownership/flow.js";
import { rustNativeArgumentBorrowsRead } from "../../../dist/analysis/ownership/uses.js";

let sequence = 0;
async function fixture(text, options = {}) {
  const source = createTargetSourceProgram(await checkedSource(`rust-ownership-flow-${sequence++}`, { "src/index.ts": text }));
  const storage = createSourceStorageQuery(source, source.sourceFiles);
  const selected = analyzeRustOwnershipFlow({ source, storage, capturesFor: () => undefined,
    isOnceCallable: () => false, canMoveStoredField: () => false, isOwnedOperationResult: () => false, ...options });
  return { source, storage, selected };
}

function references(source, storage, name) {
  return storage.nodes.filter(node => source.ast.is.IsIdentifier(node) && source.ast.text(node) === name &&
    source.navigation.sourceReferenceFor(node) !== undefined &&
    source.navigation.sourceReferenceFor(node)?.declaration !== source.ast.parent(node));
}

for (const [name, expression, input] of [
  ["direct", "value.item", "Slot"],
  ["parenthesized", "(((value))).item", "Slot"],
  ["asserted", "(value satisfies Slot).item", "Slot"],
  ["nested", "value.inner.item", "{ inner: Slot }"],
  ["constructed", "new Slot('new').item", "Slot"],
  ["produced", "produce().item", "Slot"],
]) {
  test(`stored-field movement is a reverse dependency fold for ${name} receivers`, async () => {
    const { source, storage } = await fixture(`
      class Slot { constructor(readonly item: string) {} }
      declare function produce(): Slot;
      function run(value: ${input}): string { return ${expression}; }
    `);
    const owner = storage.nodes.find(node => source.ast.is.IsFunctionDeclaration(node) && source.ast.text(source.ast.name(node)) === "run");
    const returned = source.ast.statements(source.ast.body(owner)).find(node => source.ast.is.IsReturnStatement(node));
    const field = source.ast.as.AsReturnStatement(returned)?.Expression;
    assert.equal(field !== undefined, true, "the checked return has its exact field expression");
    for (const eligible of [false, true]) {
      const selected = analyzeRustOwnershipFlow({ source, storage, capturesFor: () => undefined,
        isOnceCallable: () => false, canMoveStoredField: node => eligible && source.ast.is.IsPropertyAccessExpression(node),
        isOwnedOperationResult: () => false });
      assert.equal(selected.kind, "resolved");
      assert.equal(selected.flow.movingReads.has(field), eligible, "only the proven native field may transfer");
    }
  });
}

for (const [name, sourceText, expected] of [
  ["mutually exclusive returns", "function run(value: string, flag: boolean) { if (flag) return value; return value; }", [true, true]],
  ["sequential storage", "function run(value: string) { const first = value; const last = value; return [first,last]; }", [false, true]],
  ["loop-carried binding", "declare function observe(value: string): void; function run(value: string, flag: boolean) { while(flag) observe(value); return value; }", [false, true]],
  ["finally retained read", "declare function observe(value: string): void; function run(value: string) { try { return value; } finally { observe(value); } }", [false, true]],
  ["short-circuit read", "function run(value: string, flag: boolean) { return flag && value ? value : value; }", [false, true, true]],
]) {
  test(`ownership takes ${name} from canonical checked liveness`, async () => {
    const { source, storage, selected } = await fixture(sourceText);
    assert.equal(selected.kind, "resolved", name);
    const reads = references(source, storage, "value");
    assert.deepEqual(reads.map(read => selected.flow.movingReads.has(read)), expected, name);
  });
}

test("capture transfer is selected at the checked closure point, not at a later generated variable", async () => {
  const { source, storage } = await fixture("function run(value: string) { return () => value; }");
  const closure = storage.nodes.find(node => source.ast.is.IsArrowFunction(node));
  const reference = references(source, storage, "value")[0];
  const declaration = source.navigation.sourceReferenceFor(reference).declaration;
  for (const once of [false, true]) {
    const selected = analyzeRustOwnershipFlow({ source, storage,
      capturesFor: owner => owner === closure ? { receivers: [], receiverFields: [], captures: [
        { declaration, reference, carrier: { kind: "source-primitive", name: "int32" }, storage: "value" },
      ] } : undefined,
      isOnceCallable: owner => once && owner === closure, canMoveStoredField: () => false, isOwnedOperationResult: () => false });
    assert.equal(selected.kind, "resolved");
    assert.equal(selected.flow.captureTransfers.get(closure)?.has(declaration), true);
    assert.equal(selected.flow.movingReads.has(reference), once);
  }
});

test("capture transfer does not cross a finally observation", async () => {
  const { source, storage } = await fixture("declare function observe(value: string): void; function run(value: string) { try { return () => value; } finally { observe(value); } }");
  const closure = storage.nodes.find(node => source.ast.is.IsArrowFunction(node));
  const reference = references(source, storage, "value")[0];
  const declaration = source.navigation.sourceReferenceFor(reference).declaration;
  const selected = analyzeRustOwnershipFlow({ source, storage,
    capturesFor: owner => owner === closure ? { receivers: [], receiverFields: [], captures: [
      { declaration, reference, carrier: { kind: "source-primitive", name: "int32" }, storage: "value" },
    ] } : undefined,
    isOnceCallable: () => false, canMoveStoredField: () => false, isOwnedOperationResult: () => false });
  assert.equal(selected.kind, "resolved");
  assert.equal(selected.flow.captureTransfers.get(closure)?.has(declaration) === true, false);
});

test("ownership never converts a missing or exhausted source-flow proof into a move", async () => {
  const { selected } = await fixture("function run(value: string) { return value; }", { limits: { maximumPoints: 1 } });
  assert.equal(selected.kind, "rejected");
  assert.equal(selected.diagnostics.length, 1);
  assert.equal(selected.diagnostics[0].code, "RUST_OWNERSHIP_FLOW_UNRESOLVED");
  assert.equal(selected.diagnostics[0].sourceNode !== undefined, true);
});

test("a native argument lease prevents a later last-use move only inside the same actual invocation", async () => {
  const { source, storage } = await fixture("declare function inspect(first: string, second: string): string; function run(value: string) { return inspect(value, value); }");
  const reads = references(source, storage, "value");
  assert.equal(reads.length, 2);
  for (const borrowed of [false, true]) {
    const selected = analyzeRustOwnershipFlow({ source, storage, capturesFor: () => undefined,
      isOnceCallable: () => false, canMoveStoredField: () => false, isOwnedOperationResult: () => false,
      mayBorrowArgument: argument => borrowed && argument === reads[0] });
    assert.equal(selected.kind, "resolved");
    assert.deepEqual(reads.map(reference => selected.flow.movingReads.has(reference)), [false, !borrowed]);
  }
});

test("a completed native receiver borrow does not manufacture a source lease for a later independent move", async () => {
  const { source, storage, selected } = await fixture("declare function inspect(value: string): void; function run(value: string) { inspect(value); return value; }",
    { mayBorrowArgument: () => true });
  assert.equal(selected.kind, "resolved");
  assert.deepEqual(references(source, storage, "value").map(reference => selected.flow.movingReads.has(reference)), [false, true]);
});

for (const [argument, retained] of [["value", true], ["produce(value)", false], ["flag ? value : ''", false],
  ["reference(value)", true]]) {
  test(`native argument ownership distinguishes an actual source lease from ${argument}`, async () => {
    const { source, storage } = await fixture(`
      declare function inspect(first: string, second: string): string;
      declare function produce(value: string): string;
      declare function reference(value: string): string;
      function run(value: string, flag: boolean) { return inspect(${argument}, value); }
    `);
    const outer = storage.nodes.find(node => source.ast.is.IsCallExpression(node) &&
      source.ast.text(source.ast.as.AsCallExpression(node)?.Expression) === "inspect");
    const first = source.ast.arguments(outer)[0];
    const reads = references(source, storage, "value");
    const targetOperation = new Map([[outer, { kind: "source-call" }]]);
    const runtimeCarrier = new Map();
    if (argument === "reference(value)") {
      targetOperation.set(first, { kind: "reference-operation", operation: "shared-reference",
        operandExpression: source.ast.arguments(first)[0] });
      runtimeCarrier.set(first, { carrier: { kind: "reference" } });
    }
    const records = { targetOperation, runtimeCarrier,
      argumentPassing: new Map([[first, { mode: "borrow-shared" }]]) };
    const selected = analyzeRustOwnershipFlow({ source, storage, capturesFor: () => undefined,
      isOnceCallable: () => false, canMoveStoredField: () => false, isOwnedOperationResult: () => false,
      mayBorrowArgument: (actual, reference) => rustNativeArgumentBorrowsRead(actual, reference, source.ast, records) });
    assert.equal(selected.kind, "resolved");
    assert.deepEqual(reads.map(reference => selected.flow.movingReads.has(reference)), [false, !retained]);
    assert.equal(rustNativeArgumentBorrowsRead(reads.at(-1), reads.at(-1), source.ast, records), false,
      "an absent native borrowing contract is not a lease");
  });
}

test("foreign checked storage cannot manufacture an ownership proof", async () => {
  const first = await fixture("function run(value: string) { return value; }");
  const second = await fixture("function run(value: string) { return value; }");
  assert.throws(() => analyzeRustOwnershipFlow({ source: first.source, storage: second.storage,
    capturesFor: () => undefined, isOnceCallable: () => false, canMoveStoredField: () => false,
    isOwnedOperationResult: () => false }), /identical checked source program/u);
});
