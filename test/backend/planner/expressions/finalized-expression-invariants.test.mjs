import assert from "node:assert/strict";
import test from "node:test";
import { BinaryExpression_Left, BinaryExpression_Right } from "@tsonic/target-api/source";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { createRustPlanningContext } from "../../../../dist/backend/planner/context.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { planElementAccess } from "../../../../dist/backend/planner/expressions/elements.js";
import { planPropertyAccess } from "../../../../dist/backend/planner/expressions/properties.js";
import { planOptionalChainExpression } from "../../../../dist/backend/planner/expressions/optional-chains.js";
import { planRustPromotedStorageWrite } from "../../../../dist/backend/planner/expressions/typed-locations.js";
import { planRustCallArguments } from "../../../../dist/backend/planner/expressions/input-shaping.js";
import { planExpression } from "../../../../dist/backend/planner/expressions/entry.js";
import { analyzeRustDirectStorage } from "../../../../dist/analysis/storage/direct-storage.js";
import { createRustDirectStorageProducer } from "../../../../dist/analysis/program/records/direct-storage.js";

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
    if (record !== undefined && predicate(record, node)) nodes.push(node);
    for (const child of program.source.ast.children(node)) visit(child);
  };
  for (const file of program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile)) visit(file);
  assert.equal(nodes.length, 1, family + ": one actual producer selection");
  return nodes[0];
}

function planContext(program, node, withNames = true) {
  const { ast } = program.source;
  return {
    input: createRustPlanningContext(program), sourceFile: ast.getSourceFile(node), nativeHeaderPlacement: ast.getSourceFile(node), nativeHeaderParent: undefined,
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
  const altered = { ...program, source: { ...program.source, ast: changed } };
  const producer = createRustDirectStorageProducer(() => {});
  const issues = analyzeRustDirectStorage(altered, [node], producer, { typedLocationPlan: { get: () => undefined } });
  assert.equal(issues.length, 0, "no effectful write is being admitted");
  assert.equal(producer.records.directStorage.get(node)?.kind, "unavailable", "a tuple without its concrete index has no native projection");
  const context = planContext({ ...altered, records: { ...program.records, ...producer.records } }, node);
  let failure;
  try {
    planElementAccess(node, context);
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.diagnostic?.code, "TSONIC_INTERNAL_PLANNER_INVARIANT");
  assert.equal(failure.diagnostic.source, "tsonic-rust");
  assert.equal(failure.diagnostic.category, "error");
  assert.equal(failure.diagnostic.message, "An admitted fixed projection requires its exact native receiver and source index.");
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
    planOptionalChainExpression(node, context, () => {
      innerCalls++;
      assert.fail("missing backend names cannot reach inner planning");
    });
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.diagnostic?.code, "TSONIC_INTERNAL_PLANNER_INVARIANT");
  assert.equal(failure.diagnostic.source, "tsonic-rust");
  assert.equal(failure.diagnostic.category, "error");
  assert.equal(failure.diagnostic.message, "An admitted optional chain requires its native name scope.");
  assert.equal(failure.diagnostic.sourceNode === node, true, "exact checked optional-chain identity");
  assert.equal(innerCalls, 0);
  assert.equal(context.diagnostics.length, 0, "no source rejection for missing backend state");
});

function assertInvariant(operation, context, message, node) {
  let failure;
  try {
    operation();
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.diagnostic?.code, "TSONIC_INTERNAL_PLANNER_INVARIANT");
  assert.equal(failure.diagnostic.source, "tsonic-rust");
  assert.equal(failure.diagnostic.category, "error");
  assert.equal(failure.diagnostic.message, message);
  assert.equal(failure.diagnostic.sourceNode === node, true, "the identical checked source subject");
  assert.equal(context.diagnostics.length, 0, "no appended source rejection");
}

test("a finalized dispatched property requires only its backend name state", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
class Counter {
  value: int32;
  constructor(value: int32) { this.value = value; }
  label(): string { return "base"; }
}
class SteppedCounter extends Counter {
  constructor(value: int32) { super(value); }
  label(): string { return "derived"; }
}
export function read(counter: Counter): int32 { return counter.value; }
export function create(): Counter { return new SteppedCounter(1); }
` } });
  const node = selectedNode(program, "targetOperation", fact => fact.kind === "source-field" &&
    fact.dispatch !== undefined && fact.accessMode === "read");
  const selected = program.records.targetOperation.get(node);
  assert.equal(program.projectFieldDispatch.planFor(selected.declaration) !== undefined, true,
    "the real polymorphic owner published its dispatch plan");
  const accepted = planContext(program, node);
  assert.equal(planPropertyAccess(node, accepted) !== undefined, true);
  assert.equal(accepted.diagnostics.length, 0);
  const missingNames = planContext(program, node, false);
  assertInvariant(() => planPropertyAccess(node, missingNames), missingNames,
    "An admitted field dispatch requires its native hygienic scope.", node);
});

test("a finalized promoted compound write requires only its backend name state", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
import { addressof, loadptr, storeptr } from "@tsonic/core/lang.js";
import type { int32, Pointer } from "@tsonic/core/types.js";
function increment(pointer: Pointer<int32>): void { storeptr(pointer, loadptr(pointer) + 1); }
export function update(): int32 {
  let local: int32 = 1;
  const alias = addressof(local);
  local += 1;
  increment(alias);
  return local;
}
` } });
  const { ast } = program.source;
  const node = selectedNode(program, "targetOperation", (_fact, candidate) =>
    ast.is.IsBinaryExpression(candidate) && ast.is.IsIdentifier(BinaryExpression_Left(ast, candidate)) &&
    ast.text(BinaryExpression_Left(ast, candidate)) === "local");
  const left = BinaryExpression_Left(ast, node);
  const right = BinaryExpression_Right(ast, node);
  const declaration = program.records.sourceBinding.get(left)?.sourceDeclaration;
  assert.equal(declaration !== undefined && program.records.bindingStorage.get(declaration) !== undefined, true,
    "the real checked location producer promoted the exact binding");
  const accepted = planContext(program, node);
  const value = planExpression(right, accepted);
  assert.equal(value !== undefined, true);
  const write = planRustPromotedStorageWrite(left, "+=", value, accepted, planExpression);
  assert.equal(write.handled, true);
  assert.equal(write.statement !== undefined, true);
  assert.equal(accepted.diagnostics.length, 0);
  const missingNames = planContext(program, node, false);
  assertInvariant(() => planRustPromotedStorageWrite(left, "+=", value, missingNames, planExpression), missingNames,
    "Promoted-location compound assignment requires a finalized hygienic-name scope.", left);
});

let callFixture;
function checkedCalls() {
  callFixture ??= analyzeRust({ surfaces: ["js"], files: { "index.ts": `
function consume(...values: (number | undefined)[]): void {}
export function calls(values: (number | undefined)[]): void {
  consume();
  consume(undefined);
  consume(...values);
}
` } }).program;
  return callFixture;
}

test("actual source argument lists preserve empty, undefined and spread nodes", () => {
  const program = checkedCalls();
  const { ast } = program.source;
  for (const [label, predicate, expectedCount] of [
    ["empty", node => ast.arguments(node).length === 0, 0],
    ["undefined", node => ast.arguments(node).length === 1 && ast.is.IsIdentifier(ast.arguments(node)[0]) &&
      ast.text(ast.arguments(node)[0]) === "undefined", 1],
    ["spread", node => ast.arguments(node).length === 1 && ast.kindName(ast.arguments(node)[0]) === "KindSpreadElement", 1],
  ]) {
    const node = selectedNode(program, "targetOperation", (fact, candidate) => fact.kind === "source-call" && predicate(candidate));
    const expected = ast.arguments(node);
    const seen = [];
    const context = planContext(program, node);
    const planned = planRustCallArguments(node, context, argument => {
      seen.push(argument);
      return { kind: "path", path: `argument_${seen.length}` };
    });
    assert.equal(planned?.length, expectedCount, label);
    assert.equal(seen.length, expectedCount, label);
    assert.equal(seen.every((argument, index) => argument === expected[index]), true, label + ": exact source order and identity");
    assert.equal(context.diagnostics.length, 0, label);
  }
});

test("a checked source call cannot contain an undefined actual AST argument", () => {
  const program = checkedCalls();
  const { ast } = program.source;
  const node = selectedNode(program, "targetOperation", (fact, candidate) => fact.kind === "source-call" &&
    ast.arguments(candidate).length === 1 && ast.is.IsIdentifier(ast.arguments(candidate)[0]) &&
    ast.text(ast.arguments(candidate)[0]) === "undefined");
  const changed = { ...program, source: { ...program.source, ast: { ...ast,
    arguments: subject => subject === node ? [undefined] : ast.arguments(subject),
  } } };
  const context = planContext(changed, node);
  let rendered = 0;
  assertInvariant(() => planRustCallArguments(node, context, () => { rendered++; }), context,
    "Call expression contains an undefined argument slot.", node);
  assert.equal(rendered, 0, "an absent checked source slot cannot reach argument rendering");
});

test("an ordinary argument rendering failure remains an ordinary absent plan", () => {
  const program = checkedCalls();
  const { ast } = program.source;
  const node = selectedNode(program, "targetOperation", (fact, candidate) => fact.kind === "source-call" &&
    ast.arguments(candidate).length === 1 && ast.is.IsIdentifier(ast.arguments(candidate)[0]) &&
    ast.text(ast.arguments(candidate)[0]) === "undefined");
  const context = planContext(program, node);
  let rendered = 0;
  assert.equal(planRustCallArguments(node, context, () => { rendered++; }) === undefined, true);
  assert.equal(rendered, 1);
  assert.equal(context.diagnostics.length, 0);
});
