import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { createRustPlanningContext } from "../../../../dist/backend/planner/context.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { planElementAccess } from "../../../../dist/backend/planner/expressions/elements.js";
import { planPropertyAccess } from "../../../../dist/backend/planner/expressions/properties.js";
import { planOptionalChainExpression } from "../../../../dist/backend/planner/expressions/special.js";

let fixture;
function checkedProgram() {
  fixture ??= analyzeRust({ surfaces: ["js"], files: { "index.ts": `
export function first(value: [number, string]): number { return value[0]; }
export function length(values: (string | undefined)[]): void {
  const size = values[0]?.length;
}
` } }).program;
  return fixture;
}

function selectedNode(program, family, predicate) {
  const nodes = [];
  const visit = node => {
    const record = program.records[family].get(node);
    if (record !== undefined && predicate(record)) nodes.push(node);
    for (const child of program.source.ast.children(node)) visit(child);
  };
  for (const file of program.sourceFiles) visit(file);
  assert.equal(nodes.length, 1, family + ": one actual producer selection");
  return nodes[0];
}

function planContext(program, node, withNames = true) {
  const { ast } = program.source;
  return {
    input: createRustPlanningContext(program), sourceFile: ast.getSourceFile(node),
    diagnostics: [], usedAliases: new Set(),
    ...(withNames ? { syntheticNames: createRustSyntheticNameState(ast, node, []) } : {}),
    moduleName: "index", structuralShapesModuleName: "shapes",
    moduleNameByFileName: new Map(), externalCrateNameByFileName: new Map(),
    externalItemPathByIdentity: new Map(), externalStructuralShapeModuleByFileName: new Map(),
  };
}

test("a checked tuple index plans with its exact concrete source argument", () => {
  const program = checkedProgram();
  const node = selectedNode(program, "targetOperation", fact => fact.kind === "tuple-index");
  const context = planContext(program, node);
  const fact = program.records.targetOperation.get(node);
  assert.equal(fact.index, 0);
  assert.equal(program.source.ast.as.AsElementAccessExpression(node).ArgumentExpression !== undefined, true);
  assert.equal(planElementAccess(node, context) !== undefined, true);
  assert.equal(context.diagnostics.length, 0);
});

test("a finalized tuple selection cannot lose its checked concrete index", () => {
  const program = checkedProgram();
  const node = selectedNode(program, "targetOperation", fact => fact.kind === "tuple-index");
  const { ast } = program.source;
  const changed = { ...ast, as: { ...ast.as, AsElementAccessExpression: subject => {
    const selected = ast.as.AsElementAccessExpression(subject);
    return subject === node ? { ...selected, ArgumentExpression: undefined } : selected;
  } } };
  const context = planContext({ ...program, source: { ...program.source, ast: changed } }, node);
  let failure;
  try {
    planElementAccess(node, context);
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.diagnostic?.code, "TSONIC_INTERNAL_PLANNER_INVARIANT");
  assert.equal(failure.diagnostic.source, "tsonic-rust");
  assert.equal(failure.diagnostic.category, "error");
  assert.equal(failure.diagnostic.message, "Tuple element fact has no concrete source index expression.");
  assert.equal(failure.diagnostic.sourceNode === node, true, "exact checked element identity");
  assert.equal(context.diagnostics.length, 0, "no source rejection for corrupted checked syntax");
});

test("a checked optional chain plans with its compilation-owned synthetic names", () => {
  const program = checkedProgram();
  const node = selectedNode(program, "optionalChain", () => true);
  const context = planContext(program, node);
  assert.equal(planPropertyAccess(node, context) !== undefined, true);
  assert.equal(context.diagnostics.length, 0);
});

test("an admitted optional chain requires backend names before its inner operation", () => {
  const program = checkedProgram();
  const node = selectedNode(program, "optionalChain", () => true);
  const context = planContext(program, node, false);
  let innerCalls = 0;
  let failure;
  try {
    planOptionalChainExpression(node, context, "property", () => {
      innerCalls++;
      assert.fail("missing backend names cannot reach inner planning");
    });
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.diagnostic?.code, "TSONIC_INTERNAL_PLANNER_INVARIANT");
  assert.equal(failure.diagnostic.source, "tsonic-rust");
  assert.equal(failure.diagnostic.category, "error");
  assert.equal(failure.diagnostic.message, "Optional-chain lowering requires the compilation-owned synthetic-name state.");
  assert.equal(failure.diagnostic.sourceNode === node, true, "exact checked optional-chain identity");
  assert.equal(innerCalls, 0);
  assert.equal(context.diagnostics.length, 0, "no source rejection for missing backend state");
});
