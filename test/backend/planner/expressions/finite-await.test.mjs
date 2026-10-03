import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustTargetOperationFactKey } from "../../../../dist/analysis/facts/keys.js";
import { rustAwaitValueFactKey } from "../../../../dist/analysis/facts/await-values.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";
import { planRustAwaitExpression } from "../../../../dist/backend/planner/expressions/await.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";

function awaitProgram(source) {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": source } });
  const operations = [];
  const visit = node => {
    const operation = program.facts.getFact(node, rustTargetOperationFactKey);
    if (operation?.kind === "await-op") operations.push({ node, operation,
      fact: program.facts.getFact(node, rustAwaitValueFactKey) });
    for (const child of program.source.ast.children(node)) visit(child);
  };
  for (const sourceFile of program.sourceFiles) visit(sourceFile);
  assert.equal(operations.length, 1);
  return { program, ...operations[0] };
}

function contextFor(program, node, facts = program.facts) {
  const { ast } = program.source;
  return { input: { program: { ...program, facts } }, diagnostics: [],
    sourceFile: ast.getSourceFile(node), moduleName: "index", structuralShapesModuleName: "shapes",
    moduleNameByFileName: new Map([["/src/index.ts", "index"]]), externalCrateNameByFileName: new Map(),
    externalItemPathByIdentity: new Map(), externalStructuralShapeModuleByFileName: new Map(),
    usedAliases: new Set(), syntheticNames: createRustSyntheticNameState(ast, node, []),
    fallibleBoundary: { componentId: "test", errorDomain: "runtime",
      errorTypePath: "rt::TsonicError", errorTypeIdentity: "tsonic-rust-runtime:TsonicError" } };
}

test("finite await planner emits native branch selection and preserves one operand evaluation", () => {
  const { program, node, fact } = awaitProgram(`
import type { uint64 } from "@tsonic/core/types.js";
export async function read(value: uint64 | Promise<uint64>): Promise<uint64> { return await value; }
`);
  assert.equal(fact.selection.kind, "union");
  const selected = contextFor(program, node);
  const operand = { kind: "call", path: "next", args: [] };
  let evaluations = 0;
  const result = planRustAwaitExpression(node, selected, () => { evaluations += 1; return operand; });
  assert.deepEqual(selected.diagnostics, []);
  assert.equal(evaluations, 1);
  assert.equal(result.kind, "match");
  assert.equal(result.expression, operand);
  assert.equal(result.arms.length, 2);
  const deferred = result.arms.find(arm => arm.expression.kind === "try");
  const direct = result.arms.find(arm => arm.expression.kind === "path");
  assert.ok(direct);
  assert.equal(deferred.expression.expr.kind, "await");
  assert.equal(deferred.expression.expr.expr.kind, "method-call");
  assert.equal(deferred.expression.expr.expr.method, "into_result");
  assert.deepEqual(deferred.expression.resultErrorType, deferred.expression.operandErrorType);
  assert.doesNotMatch(JSON.stringify(result), /clone|Box|poll|dyn Future|Any|numeric-cast/u);
});

test("optional unit future planner retains effectful native await and one absence branch", () => {
  const { program, node, fact } = awaitProgram(`
export async function finish(value: Promise<void> | null | undefined): Promise<void> { await value; }
`);
  assert.equal(fact.selection.kind, "optional");
  const selected = contextFor(program, node);
  const result = planRustAwaitExpression(node, selected, () => ({ kind: "path", path: "value" }));
  assert.deepEqual(selected.diagnostics, []);
  assert.equal(result.kind, "match");
  assert.equal(result.arms[0].pattern.path, "Some");
  assert.equal(result.arms[0].expression.kind, "try");
  assert.equal(result.arms[0].expression.expr.kind, "await");
  assert.equal(result.arms[1].pattern.path, "None");
  assert.deepEqual(result.arms[1].expression, { kind: "tuple-literal", elements: [] });
  assert.doesNotMatch(JSON.stringify(result), /Undefined|Null|clone|Box|poll/u);
});

test("await planner rejects missing or mutated branch and effect contracts before operand planning", () => {
  const { program, node, fact } = awaitProgram(`
import type { uint64 } from "@tsonic/core/types.js";
export async function read(value: uint64 | Promise<uint64>): Promise<uint64> { return await value; }
`);
  const integer = rustSourcePrimitiveTargetType("int32");
  const mutations = [ undefined, { ...fact, resultCarrier: integer }, { ...fact, operandCarrier: integer },
    { ...fact, unexpected: true },
    { ...fact, selection: { ...fact.selection, alternatives: [] } },
    { ...fact, selection: { ...fact.selection, alternatives: [...fact.selection.alternatives].reverse() } },
    { ...fact, selection: { ...fact.selection, alternatives: fact.selection.alternatives.map(alternative =>
      alternative.selection.value.future === undefined ? alternative : { ...alternative,
        selection: { ...alternative.selection, value: { ...alternative.selection.value,
          future: { ...alternative.selection.value.future, errorBoundary: "none" } } } }) } },
  ];
  for (const mutation of mutations) {
    const facts = { ...program.facts, getFact: (subject, key) => subject === node && key === rustAwaitValueFactKey
      ? mutation : program.facts.getFact(subject, key) };
    const selected = contextFor(program, node, facts);
    assert.equal(planRustAwaitExpression(node, selected, () => {
      assert.fail("an invalid await contract must not reach operand planning");
    }), undefined);
    assert.equal(selected.diagnostics.length, 1);
    assert.equal(selected.diagnostics[0].code, "RUST_MISSING_TARGET_FACT");
    assert.ok(selected.diagnostics[0].evidence.includes("target.capability=rust.backend.await-value"));
  }
});
