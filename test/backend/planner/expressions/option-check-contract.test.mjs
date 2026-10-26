import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { assertNoTargetDiagnostics } from "../../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";

import { planBinaryExpression } from "../../../../dist/backend/planner/expressions/binary.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { analyzeRustBinaryEmission } from "../../../../dist/analysis/operations/binary-emission.js";
import { createRustBinaryEmissionProducer } from "../../../../dist/analysis/program/records/expression-binary.js";
import { analyzeRustOptionalChainEmission } from "../../../../dist/analysis/operations/optional-chains.js";
import { createRustOptionalChainEmissionProducer } from "../../../../dist/analysis/program/records/optional-chain-emission.js";
import { analyzeRustNullishCoalescing } from "../../../../dist/analysis/operations/nullish-coalescing.js";
import { createRustNullishCoalescingProducer } from "../../../../dist/analysis/program/records/nullish-coalescing.js";

test("option-check admission rejects missing, duplicate, unordered and impossible nullish depths", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
export function missing(values: (number | undefined)[]): boolean {
  return values[0] === undefined;
}
` } });
  const { ast } = program.source;
  const operations = [];
  const visit = node => {
    if (node === undefined) return;
    const fact = program.records.targetOperation.get(node);
    if (fact?.kind === "option-check") operations.push({ node, fact });
    for (const child of ast.children(node)) visit(child);
  };
  for (const sourceFile of program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile)) visit(sourceFile);
  assert.equal(operations.length, 1);
  const { node, fact } = operations[0];
  assert.deepEqual(fact.nullishDepths, [0]);
  assert.ok(Object.isFrozen(fact.nullishDepths));
  const context = records => ({
    input: { program: { ...program, records } }, diagnostics: [],
    sourceFile: ast.getSourceFile(node), nativeHeaderPlacement: ast.getSourceFile(node), nativeHeaderParent: undefined, usedAliases: new Set(),
    syntheticNames: createRustSyntheticNameState(ast, node, []),
    moduleName: "index", structuralShapesModuleName: "shapes",
    moduleNameByFileName: new Map(), externalCrateNameByFileName: new Map(),
    externalItemPathByIdentity: new Map(), externalStructuralShapeModuleByFileName: new Map(),
  });
  const valid = context(program.records);
  assert.ok(planBinaryExpression(node, valid));
  assertNoTargetDiagnostics(valid.diagnostics);
  for (const nullishDepths of [undefined, [], [-1], [0.5], [NaN], [Infinity], [2], [0, 0], [1, 0]]) {
    const records = createRustRecordFixture({
targetOperation: { get: (subject) => subject === node
    ? { ...fact, nullishDepths } : program.records.targetOperation.get(subject) }}, program.records);
    const producer = createRustBinaryEmissionProducer(() => {});
    const issues = analyzeRustBinaryEmission({ ...program, records }, [node], producer);
    assert.equal(issues.length, 1, "malformed producer depths reject exactly once before sealing");
    assert.equal(issues[0].code, "RUST_MISSING_TARGET_FACT");
    assert.equal(issues[0].source, "tsonic-rust");
    assert.equal(issues[0].category, "error");
    assert.equal(issues[0].message,
      "Option nullish depths must be ordered, unique and contained in the exact operand carrier. Node kind: KindBinaryExpression.");
    assert.equal(issues[0].sourceNode === node, true, "the exact option-check identity");
    assert.equal(producer.records.binaryEmission.get(node) === undefined, true, "no invalid depths reach the planner");
  }
});

test("optional-chain admission rejects missing, altered and impossible guard depths", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
export function read(values: (string | undefined)[]): void {
  const length = values[0]?.length;
}
` } });
  const { ast } = program.source;
  const operations = [];
  const visit = node => {
    if (node === undefined) return;
    const fact = program.records.optionalChain.get(node);
    if (fact !== undefined) operations.push({ node, fact });
    for (const child of ast.children(node)) visit(child);
  };
  for (const sourceFile of program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile)) visit(sourceFile);
  assert.equal(operations.length, 1);
  const { node, fact } = operations[0];
  assert.equal(fact.guardDepth, 1);
  for (const guardDepth of [undefined, 0, -1, 2, 3, 0.5, NaN, Infinity]) {
    const records = createRustRecordFixture({
optionalChain: { get: (subject) => subject === node
    ? { ...fact, guardDepth } : program.records.optionalChain.get(subject) }}, program.records);
    const producer = createRustOptionalChainEmissionProducer(() => {});
    const issues = analyzeRustOptionalChainEmission({ ...program, records }, [node], producer, []);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].code, "RUST_MISSING_TARGET_FACT");
    assert.ok(issues[0].evidence.includes("target.capability=rust.backend.optional-chain-contract"));
    assert.equal(issues[0].sourceNode === node, true, "the guard rejection retains its checked subject");
    assert.equal(producer.records.optionalChainEmission.get(node) === undefined, true,
      "invalid guards never reach inner operation planning");
  }
});

test("coalescing admission rejects missing and inconsistent source Option depths", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
export function read(values: (string | undefined)[]): string {
  return values[0] ?? "missing";
}
` } });
  const { ast } = program.source;
  const operations = [];
  const visit = node => {
    const fact = program.records.targetOperation.get(node);
    if (fact?.kind === "option-coalesce") operations.push({ node, fact });
    for (const child of ast.children(node)) visit(child);
  };
  for (const sourceFile of program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile)) visit(sourceFile);
  assert.equal(operations.length, 1);
  const { node, fact } = operations[0];
  assert.equal(fact.leftOptionDepth, 1);
  assert.equal(fact.rightOptionDepth, 0);
  const context = records => ({
    input: { program: { ...program, records } }, diagnostics: [],
    sourceFile: ast.getSourceFile(node), nativeHeaderPlacement: ast.getSourceFile(node), nativeHeaderParent: undefined, usedAliases: new Set(),
    syntheticNames: createRustSyntheticNameState(ast, node, []),
    moduleName: "index", structuralShapesModuleName: "shapes",
    moduleNameByFileName: new Map(), externalCrateNameByFileName: new Map(),
    externalItemPathByIdentity: new Map(), externalStructuralShapeModuleByFileName: new Map(),
  });
  const valid = context(program.records);
  const planned = planBinaryExpression(node, valid);
  assert.equal(planned?.kind, "match");
  assert.deepEqual(planned?.arms.map(arm => arm.pattern.kind), ["tuple-variant", "path"]);
  assertNoTargetDiagnostics(valid.diagnostics);
  const mutations = [
    ...[undefined, 0, -1, 2, 3, 0.5, NaN, Infinity].map(leftOptionDepth => ({ leftOptionDepth })),
    ...[undefined, -1, 1, 0.5, NaN, Infinity].map(rightOptionDepth => ({ rightOptionDepth })),
    ...[undefined, "raw", "invalid"].map(rightValueForm => ({ rightValueForm })),
    ...[undefined, { kind: "source-primitive", name: "int32" }].map(leftValueCarrier => ({ leftValueCarrier })),
    { leftConversion: { kind: "numeric-promotion", source: "int32", target: "int64" } },
  ];
  for (const mutation of mutations) {
    const records = createRustRecordFixture({
targetOperation: { get: (subject) => subject === node
    ? { ...fact, ...mutation } : program.records.targetOperation.get(subject) }}, program.records);
    const producer = createRustNullishCoalescingProducer(() => {});
    const issues = analyzeRustNullishCoalescing({ ...program, records }, [node], producer);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].code, "RUST_MISSING_TARGET_FACT");
    assert.ok(issues[0].evidence.includes("target.capability=rust.backend.option-coalesce-depth"));
    assert.equal(issues[0].sourceNode === node, true, "the original coalescing expression owns its rejection");
    assert.equal(producer.records.nullishCoalescing.get(node) === undefined, true, "invalid coalescing never reaches rendering");
  }
});
