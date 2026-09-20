import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustOptionalChainFactKey, rustTargetOperationFactKey } from "../../../../dist/analysis/facts/keys.js";
import { planBinaryExpression } from "../../../../dist/backend/planner/expressions/binary.js";
import { planOptionalChainExpression } from "../../../../dist/backend/planner/expressions/special.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";

test("sealed option checks reject missing, duplicate, unordered and impossible nullish depths", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
export function missing(values: (number | undefined)[]): boolean {
  return values[0] === undefined;
}
` } });
  const { ast } = program.source;
  const operations = [];
  const visit = node => {
    if (node === undefined) return;
    const fact = program.facts.getFact(node, rustTargetOperationFactKey);
    if (fact?.kind === "option-check") operations.push({ node, fact });
    for (const child of ast.children(node)) visit(child);
  };
  for (const sourceFile of program.sourceFiles) visit(sourceFile);
  assert.equal(operations.length, 1);
  const { node, fact } = operations[0];
  assert.deepEqual(fact.nullishDepths, [0, 1]);
  assert.ok(Object.isFrozen(fact.nullishDepths));
  const context = facts => ({
    input: { program: { ...program, facts } }, diagnostics: [],
    sourceFile: ast.getSourceFile(node), usedAliases: new Set(),
    syntheticNames: createRustSyntheticNameState(ast, node, []),
    moduleName: "index", structuralShapesModuleName: "shapes",
    moduleNameByFileName: new Map(), externalCrateNameByFileName: new Map(),
    externalItemPathByIdentity: new Map(), externalStructuralShapeModuleByFileName: new Map(),
  });
  const valid = context(program.facts);
  assert.ok(planBinaryExpression(node, valid));
  assert.deepEqual(valid.diagnostics, []);
  for (const nullishDepths of [undefined, [], [-1], [0.5], [NaN], [Infinity], [2], [0, 0], [1, 0]]) {
    const selected = context({ ...program.facts, getFact: (subject, key) =>
      subject === node && key === rustTargetOperationFactKey
        ? { ...fact, nullishDepths } : program.facts.getFact(subject, key) });
    assert.equal(planBinaryExpression(node, selected), undefined);
    assert.equal(selected.diagnostics.length, 1);
    assert.equal(selected.diagnostics[0].code, "RUST_MISSING_TARGET_FACT");
    assert.ok(selected.diagnostics[0].evidence.includes("target.capability=rust.backend.option-check-depths"));
  }
});

test("sealed optional chains reject missing, altered and impossible guard depths", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
export function read(values: (string | undefined)[]): void {
  const length = values[0]?.length;
}
` } });
  const { ast } = program.source;
  const operations = [];
  const visit = node => {
    if (node === undefined) return;
    const fact = program.facts.getFact(node, rustOptionalChainFactKey);
    if (fact !== undefined) operations.push({ node, fact });
    for (const child of ast.children(node)) visit(child);
  };
  for (const sourceFile of program.sourceFiles) visit(sourceFile);
  assert.equal(operations.length, 1);
  const { node, fact } = operations[0];
  assert.equal(fact.guardDepth, 2);
  for (const guardDepth of [undefined, 0, -1, 1, 3, 0.5, NaN, Infinity]) {
    const facts = { ...program.facts, getFact: (subject, key) =>
      subject === node && key === rustOptionalChainFactKey
        ? { ...fact, guardDepth } : program.facts.getFact(subject, key) };
    const context = { input: { program: { ...program, facts } }, diagnostics: [],
      sourceFile: ast.getSourceFile(node) };
    const result = planOptionalChainExpression(node, context, "property", () => {
      assert.fail("invalid guard cannot reach inner operation planning");
    });
    assert.equal(result, undefined);
    assert.equal(context.diagnostics.length, 1);
    assert.equal(context.diagnostics[0].code, "RUST_MISSING_TARGET_FACT");
    assert.ok(context.diagnostics[0].evidence.includes("target.capability=rust.backend.optional-chain-contract"));
  }
});

test("sealed coalescing rejects missing and inconsistent source Option depths", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
export function read(values: (string | undefined)[]): string {
  return values[0] ?? "missing";
}
` } });
  const { ast } = program.source;
  const operations = [];
  const visit = node => {
    const fact = program.facts.getFact(node, rustTargetOperationFactKey);
    if (fact?.kind === "option-coalesce") operations.push({ node, fact });
    for (const child of ast.children(node)) visit(child);
  };
  for (const sourceFile of program.sourceFiles) visit(sourceFile);
  assert.equal(operations.length, 1);
  const { node, fact } = operations[0];
  assert.equal(fact.leftOptionDepth, 2);
  assert.equal(fact.rightOptionDepth, 0);
  const context = facts => ({
    input: { program: { ...program, facts } }, diagnostics: [],
    sourceFile: ast.getSourceFile(node), usedAliases: new Set(),
    syntheticNames: createRustSyntheticNameState(ast, node, []),
    moduleName: "index", structuralShapesModuleName: "shapes",
    moduleNameByFileName: new Map(), externalCrateNameByFileName: new Map(),
    externalItemPathByIdentity: new Map(), externalStructuralShapeModuleByFileName: new Map(),
  });
  const valid = context(program.facts);
  assert.ok(planBinaryExpression(node, valid));
  assert.deepEqual(valid.diagnostics, []);
  const mutations = [
    ...[undefined, 0, -1, 1, 3, 0.5, NaN, Infinity].map(leftOptionDepth => ({ leftOptionDepth })),
    ...[undefined, -1, 1, 0.5, NaN, Infinity].map(rightOptionDepth => ({ rightOptionDepth })),
    ...[undefined, "raw", "invalid"].map(rightValueForm => ({ rightValueForm })),
  ];
  for (const mutation of mutations) {
    const selected = context({ ...program.facts, getFact: (subject, key) =>
      subject === node && key === rustTargetOperationFactKey
        ? { ...fact, ...mutation } : program.facts.getFact(subject, key) });
    assert.equal(planBinaryExpression(node, selected), undefined);
    assert.equal(selected.diagnostics.length, 1);
    assert.equal(selected.diagnostics[0].code, "RUST_MISSING_TARGET_FACT");
    assert.ok(selected.diagnostics[0].evidence.includes("target.capability=rust.backend.option-coalesce-depth"));
  }
});
