import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram, sourceEnclosingCallable } from "@tsonic/target-api/source";
import { createSourceStorageQuery } from "@tsonic/target-api/analysis";
import { checkedSource } from "../../../../tsonic/test/fixtures/source-navigation.mjs";
import { analyzeRustOwnershipFlow } from "../../../dist/analysis/ownership/flow.js";
import { analyzeRustReadUses, rustNativeArgumentBorrowsRead } from "../../../dist/analysis/ownership/uses.js";
import { analyzeRustNativeParticipation } from "../../../dist/analysis/callables/calls/participation.js";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { createRustLexicalFunctionEnvironmentPlan } from "../../../dist/analysis/callables/values/lexical-functions.js";
import { createRustRuntimeValueUsePlan } from "../../../dist/analysis/program/runtime-value-uses.js";
import { createRustSourceCallableQueries } from "../../../dist/analysis/callables/ownership/borrowed-returns.js";
import { rustStringTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { analyzeRust } from "../../helpers/rust-session.mjs";

let sequence = 0;
async function fixture(text, options = {}) {
  const source = createTargetSourceProgram(await checkedSource(`rust-ownership-flow-${sequence++}`, { "src/index.ts": text }));
  const storage = createSourceStorageQuery(source, source.sourceFiles);
  const selected = analyzeRustOwnershipFlow({ source, storage, nativeNodes: storage.nodes, uses: new Map(), sourceCallableFor: () => undefined, capturesFor: () => undefined,
    isOnceCallable: () => false, canMoveStoredField: () => false, isOwnedOperationResult: () => false, ...options });
  return { source, storage, selected };
}

function references(source, storage, name) {
  return storage.nodes.filter(node => source.ast.is.IsIdentifier(node) && source.ast.text(node) === name &&
    source.navigation.sourceReferenceFor(node) !== undefined &&
    source.navigation.sourceReferenceFor(node)?.declaration !== source.ast.parent(node));
}

for (const omittedUse of [false, true]) {
  test(`native operand ownership requires every use of the binding${omittedUse ? " with missing native evidence" : " with complete native evidence"}`, () => {
    const { source: checked, program } = analyzeRust({ files: { "index.ts": `
export function run(value: bigint, other: bigint): bigint {
  const before = ((value)) / other;
  return value % other + before;
}
` } });
    const source = createTargetSourceProgram(checked);
    const storage = createSourceStorageQuery(source, program.sourceFiles);
    const builder = createRustProgramRecordBuilder();
    for (const node of storage.nodes) {
      const operation = program.records.targetOperation.get(node);
      if (operation !== undefined) builder.targetOperations.source(node, operation);
    }
    const uses = analyzeRustReadUses(source.ast, storage.nodes, builder.readers, program.typeDefinitions,
      () => false, program.structuralShapes, () => false);
    const reads = references(source, storage, "value");
    const others = references(source, storage, "other");
    assert.equal(reads.length, 2, "both original reads of the same native value remain in checked liveness");
    assert.equal(others.length, 2, "both original reads of the independent native input remain");
    for (const reference of [...reads, ...others]) assert.equal(uses.get(reference)?.mode, "value",
      "transparent source wrappers retain the actual selected owned native operand demand");
    const admitted = new Map(uses);
    if (omittedUse) admitted.delete(reads[0]);
    const selected = analyzeRustOwnershipFlow({ source, storage, nativeNodes: storage.nodes, uses: admitted,
      sourceCallableFor: () => undefined, capturesFor: () => undefined, isOnceCallable: () => false,
      canMoveStoredField: () => false, isOwnedOperationResult: () => false });
    assert.equal(selected.kind, "resolved", "the same complete source graph closes without inventing a source-use role");
    assert.equal(source.navigation.declarationUseSummary(source.navigation.sourceReferenceFor(reads[0]).declaration)
      .hasUnclassifiedValueUse, true, "source arithmetic remains conservatively unclassified by the shared owner");
    assert.deepEqual(reads.map(reference => selected.flow.movingReads.has(reference)), [false, !omittedUse],
      "one missing native use prevents all movement of that binding, not just the missing occurrence");
    assert.deepEqual(others.map(reference => selected.flow.movingReads.has(reference)), [false, true],
      "complete native evidence still admits only the independent input's final read");
  });
}

async function nativeLexicalFixture(text, options = {}) {
  const source = createTargetSourceProgram(await checkedSource(`rust-native-call-place-${sequence++}`, { "src/index.ts": text }));
  const storage = createSourceStorageQuery(source, source.sourceFiles);
  const records = createRustProgramRecordBuilder().readers;
  const runtimeValueUses = createRustRuntimeValueUsePlan({ ast: source.ast, navigation: source.navigation,
    safetyApplications: { isCompileTimeApplicationReference: () => false } });
  const lexicalFunctions = createRustLexicalFunctionEnvironmentPlan(source, storage.nodes, records, runtimeValueUses,
    createRustSourceCallableQueries(storage, new Set(), () => undefined));
  const sourceCallableFor = invocation => {
    const semantics = source.semantics.forNode(invocation);
    const call = semantics.operations.call(invocation);
    return call === undefined ? undefined : semantics.declarations.signatureDeclaration(call.selectedSignature);
  };
  const capturesFor = declaration => {
    const selected = lexicalFunctions.forDeclaration(declaration);
    return selected?.kind !== "resolved" ? undefined : { receivers: [], receiverFields: [], captures: selected.captures.map(capture => ({
      declaration: capture.declaration, reference: capture.reference, carrier: rustStringTargetType(), storage: "value",
    })) };
  };
  const selected = analyzeRustOwnershipFlow({ source, storage, nativeNodes: storage.nodes, uses: new Map(), sourceCallableFor, capturesFor,
    lexicalFunctions, isOnceCallable: declaration => {
      const lexical = lexicalFunctions.forDeclaration(declaration);
      return lexical?.kind === "resolved" && lexical.singleInvocation;
    }, canMoveStoredField: () => false, isOwnedOperationResult: () => false, ...options });
  const closure = storage.nodes.find(node => source.ast.is.IsArrowFunction(node));
  assert.equal(closure !== undefined, true, "the original native lexical producer is a checked arrow");
  const lexical = lexicalFunctions.forDeclaration(closure);
  assert.equal(lexical?.kind, "resolved", "the actual canonical lexical environment is complete");
  assert.equal(lexical.valueObserved, false, "only actual direct native lexical calls receive hidden capture arguments");
  return { source, storage, selected, closure, lexical };
}

test("a mutable native capture keeps its initialized place until the actual call, not forever", async () => {
  const { source, storage, selected, closure, lexical } = await nativeLexicalFixture(`function run(initial: string, replacement: string) {
    let current = initial;
    const replace = () => { current = replacement; return initial; };
    const compared = current === replace();
    return current;
  }`);
  assert.equal(selected.kind, "resolved", "the actual hidden-place liveness closes");
  const capture = lexical.captures.find(value => source.ast.text(source.ast.name(value.declaration)) === "current");
  assert.equal(capture?.mutable, true, "the original assignment requires the native mutable capture parameter");
  const outerReads = references(source, storage, "current").filter(reference =>
    sourceEnclosingCallable(reference, source.ast) !== closure);
  assert.equal(outerReads.length, 2, "the original comparison and the later outer read both remain");
  assert.deepEqual(outerReads.map(reference => selected.flow.movingReads.has(reference)), [false, true],
    "the comparison snapshots before the call, but the final outer read may move after it");
  assert.equal(selected.flow.captureTransfers.get(closure)?.has(capture.declaration) === true, false,
    "a native mutable place is never consumed as an owned hidden argument");
});

for (const [name, body, transfer, finalMove] of [
  ["only invocation", "return read();", true, undefined],
  ["read before invocation", "const before = value; return read();", true, false],
  ["outer read after invocation", "read(); return value;", false, true],
  ["two actual invocations", "read(); return read();", false, undefined],
  ["two invocations then outer read", "read(); read(); return value;", false, true],
  ["finally observation", "try { return read(); } finally { observe(value); }", false, true],
  ["catch observation", "try { return read(); } catch { return value; }", false, true],
]) {
  test(`immutable native capture ownership follows ${name}`, async () => {
    const { source, storage, selected, closure, lexical } = await nativeLexicalFixture(`declare function observe(value: string): void;
      function run(value: string) { const read = () => value; ${body} }`);
    assert.equal(selected.kind, "resolved", "the original selected call and all control-flow edges remain checked");
    const capture = lexical.captures.find(value => source.ast.text(source.ast.name(value.declaration)) === "value");
    assert.equal(capture?.mutable, false, "the actual native hidden input is immutable");
    assert.equal(selected.flow.captureTransfers.get(closure)?.has(capture.declaration) === true, transfer,
      "an owned zero-copy capture transfers only at its actual final, single invocation");
    const outerReads = references(source, storage, "value").filter(reference =>
      sourceEnclosingCallable(reference, source.ast) !== closure);
    if (finalMove !== undefined) {
      assert.equal(outerReads.length > 0, true, "the independent original outer read is retained");
      assert.equal(selected.flow.movingReads.has(outerReads.at(-1)), finalMove,
        "native hidden use does not permanently forbid later outer ownership");
    }
  });
}

test("a native hidden capture cannot move across an overlapping explicit argument lease", async () => {
  for (const borrowed of [false, true]) {
    const { source, selected, closure, lexical } = await nativeLexicalFixture(`function run(value: string) {
      const read = (argument: string) => argument + value;
      return read(value);
    }`, { mayBorrowArgument: () => borrowed });
    assert.equal(selected.kind, "resolved", "the same original invocation and native borrow premise close");
    const capture = lexical.captures.find(value => source.ast.text(source.ast.name(value.declaration)) === "value");
    assert.equal(selected.flow.captureTransfers.get(closure)?.has(capture.declaration) === true, !borrowed,
      "the existing native argument-borrow proof governs the real hidden argument too");
  }
});

for (const later of [false, true]) {
  test(`native nested capture forwarding requires actual incoming ownership${later ? " with a later outer read" : ""}`, async () => {
    const { source, storage, selected, closure } = await nativeLexicalFixture(`function run(value: string) {
      function read(): string { return value; }
      const through = () => { const before = value; return read(); };
      ${later ? "through(); return value;" : "return through();"}
    }`);
    assert.equal(selected.kind, "resolved", "all actual selected native invocations share the source liveness solution");
    const binding = storage.nodes.find(node => source.ast.is.IsParameterDeclaration(node) &&
      source.ast.text(source.ast.name(node)) === "value");
    const read = storage.nodes.find(node => source.ast.is.IsFunctionDeclaration(node) &&
      source.ast.text(source.ast.name(node)) === "read");
    assert.equal(read !== undefined && binding !== undefined, true, "both the checked callee and capture binding remain original");
    assert.equal(selected.flow.captureTransfers.get(closure)?.has(binding) === true, !later,
      "the enclosing native hidden input is not assumed owned merely because it is called once");
    assert.equal(selected.flow.captureTransfers.get(read)?.has(binding) === true, !later,
      "the final nested call forwards only an actually owned incoming capture");
    const nestedRead = references(source, storage, "value").find(reference => sourceEnclosingCallable(reference, source.ast) === read);
    assert.equal(nestedRead !== undefined, true, "the original borrowed-or-owned callee read is covered");
    assert.equal(selected.flow.movingReads.has(nestedRead), !later,
      "a borrowed native hidden parameter is never moved out of");
  });
}

test("ownership creates graphs only for the canonical required native body domain", async () => {
  for (const required of [false, true]) {
    const { source, storage } = await fixture(`export function run(): number {
      function unused(): number {
        ${Array.from({ length: 32 }, (_, index) => `const value${index} = ${index};`).join("\n")}
        return value31;
      }
      return ${required ? "unused()" : "42"};
    }`);
    const builder = createRustProgramRecordBuilder();
    const participation = analyzeRustNativeParticipation({ ast: source.ast, storage,
      navigation: source.navigation, producer: builder.nativeParticipations, requiredRecords: [] });
    assert.equal(participation.kind, "resolved", "checked native participation closes before graph admission");
    const selected = analyzeRustOwnershipFlow({ source, storage, nativeNodes: participation.nodes, uses: new Map(), sourceCallableFor: () => undefined,
      capturesFor: () => undefined, isOnceCallable: () => false, canMoveStoredField: () => false,
      isOwnedOperationResult: () => false, limits: { maximumPoints: 8 } });
    assert.equal(selected.kind, required ? "rejected" : "resolved", "only a required body consumes its CFG budget");
    if (required) assert.equal(selected.diagnostics[0]?.code, "RUST_OWNERSHIP_FLOW_UNRESOLVED",
      "required native graph failures retain the exact owner diagnostic");
    assert.equal(storage.nodes.length > participation.nodes.length, !required,
      "the complete checked source domain remains distinct from physical demand");
  }
});

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
      const selected = analyzeRustOwnershipFlow({ source, storage, nativeNodes: storage.nodes, uses: new Map(), sourceCallableFor: () => undefined, capturesFor: () => undefined,
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
    const selected = analyzeRustOwnershipFlow({ source, storage, nativeNodes: storage.nodes, uses: new Map(), sourceCallableFor: () => undefined,
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
  const selected = analyzeRustOwnershipFlow({ source, storage, nativeNodes: storage.nodes, uses: new Map(), sourceCallableFor: () => undefined,
    capturesFor: owner => owner === closure ? { receivers: [], receiverFields: [], captures: [
      { declaration, reference, carrier: { kind: "source-primitive", name: "int32" }, storage: "value" },
    ] } : undefined,
    isOnceCallable: () => false, canMoveStoredField: () => false, isOwnedOperationResult: () => false });
  assert.equal(selected.kind, "resolved");
  assert.equal(selected.flow.captureTransfers.get(closure)?.has(declaration) === true, false);
});

test("capture transfers retain overlapping selected native operands and receivers", async () => {
  for (const receiver of [false, true]) {
    const text = receiver
      ? "declare class Owner { visit(callback: () => Owner): void; } function run(value: Owner) { ((value)).visit(() => value); }"
      : "declare function visit(value: string, callback: () => string): void; function run(value: string) { visit(((value)), () => value); }";
    const { source, storage } = await fixture(text);
    const { ast } = source;
    const closure = storage.nodes.find(node => ast.is.IsArrowFunction(node));
    const reference = references(source, storage, "value").find(node => sourceEnclosingCallable(node, ast) === closure);
    assert.equal(reference !== undefined, true, "the original checked closure captures the same outer native binding");
    const declaration = source.navigation.sourceReferenceFor(reference).declaration;
    const earlier = references(source, storage, "value").find(node => sourceEnclosingCallable(node, ast) !== closure);
    assert.equal(earlier !== undefined, true, "the exact earlier native operand or receiver remains an independent source read");
    for (const mode of ["shared", "mutable", "value"]) {
      const selected = analyzeRustOwnershipFlow({ source, storage, nativeNodes: storage.nodes,
        uses: new Map([[earlier, { mode, later: [closure], laterStart: 0, stableAcrossEffects: false }]]),
        sourceCallableFor: () => undefined,
        capturesFor: owner => owner !== closure ? undefined : { receivers: [], receiverFields: [], captures: [
          { declaration, reference, carrier: rustStringTargetType(), storage: "value" },
        ] },
        isOnceCallable: () => false, canMoveStoredField: () => false, isOwnedOperationResult: () => false });
      assert.equal(selected.kind, "resolved", "the existing checked source graph and selected native use close once");
      assert.equal(selected.flow.captureTransfers.get(closure)?.has(declaration) === true, mode === "value",
        `${receiver ? "receiver" : "argument"}/${mode}: only a genuinely owned earlier input permits the final capture transfer`);
    }
  }
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
    const selected = analyzeRustOwnershipFlow({ source, storage, nativeNodes: storage.nodes, uses: new Map(), sourceCallableFor: () => undefined, capturesFor: () => undefined,
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
    const selected = analyzeRustOwnershipFlow({ source, storage, nativeNodes: storage.nodes, uses: new Map(), sourceCallableFor: () => undefined, capturesFor: () => undefined,
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
  assert.throws(() => analyzeRustOwnershipFlow({ source: first.source, storage: second.storage, nativeNodes: first.storage.nodes, uses: new Map(), sourceCallableFor: () => undefined,
    capturesFor: () => undefined, isOnceCallable: () => false, canMoveStoredField: () => false,
    isOwnedOperationResult: () => false }), /identical checked source program/u);
});

for (const [name, body, expected] of [
  ["single await", "await pending;", [true]],
  ["sequential awaits", "await pending; await pending;", [false, true]],
  ["exclusive awaits", "if (flag) { await pending; return; } await pending;", [true, true]],
  ["later read", "await pending; observe(pending);", [false, true]],
  ["finally read", "try { await pending; } finally { observe(pending); }", [false, true]],
  ["loop-carried await", "while (flag) { await pending; } await pending;", [false, true]],
  ["captured owner", "const later = () => pending; await pending; return later;", [false, false]],
  ["other unclassified read", "await pending; return pending + 'used';", [false, false]],
]) {
  test(`owned await movement retains the whole ${name} source contract`, async () => {
    const { source, storage, selected } = await fixture(`declare function observe(value: Promise<string>): void;
      async function run(pending: Promise<string>, flag: boolean) { ${body} }`);
    assert.equal(selected.kind, "resolved", name);
    const reads = references(source, storage, "pending");
    assert.equal(reads.length, expected.length, `${name}: all original source occurrences`);
    for (const [index, read] of reads.entries()) assert.equal(selected.flow.movingReads.has(read), expected[index],
      `${name}: occurrence ${index} is governed by the same complete checked liveness`);
  });
}

test("an owned await last-use still cannot overlap an earlier argument's actual native lease", async () => {
  const { source, storage } = await fixture(`declare function inspect(first: Promise<string>, second: string): void;
    async function run(pending: Promise<string>): Promise<void> { inspect(pending, await pending); }`);
  const reads = references(source, storage, "pending");
  assert.equal(reads.length, 2, "the exact overlapping invocation has two source reads");
  for (const borrowed of [false, true]) {
    const selected = analyzeRustOwnershipFlow({ source, storage, nativeNodes: storage.nodes, uses: new Map(), sourceCallableFor: () => undefined,
      capturesFor: () => undefined, isOnceCallable: () => false, canMoveStoredField: () => false,
      isOwnedOperationResult: () => false, mayBorrowArgument: argument => borrowed && argument === reads[0] });
    assert.equal(selected.kind, "resolved", "the same graph and actual native borrowing premise close");
    assert.equal(selected.flow.movingReads.has(reads[0]), false, "the earlier argument is not a last-use transfer");
    assert.equal(selected.flow.movingReads.has(reads[1]), !borrowed, "only the actual nonoverlapping awaited last use moves");
  }
});
