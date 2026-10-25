import assert from "node:assert/strict";
import test from "node:test";
import { BinaryExpression_Left, ElementAccessExpression_ArgumentExpression } from "@tsonic/target-api/source";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustNativeIndexStorageProjection, rustNativeStoragePathsDisjoint,
  rustNativeStorageProjections, rustNativeStorageRoot } from "../../../dist/analysis/storage/native-paths.js";

function expressions(program, select) {
  const found = [];
  const visit = node => {
    if (select(node)) found.push(node);
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  return found;
}

function storageInput(program) {
  return { ast: program.source.ast, records: program.records, navigation: program.sourceNavigation };
}

for (const readonly of [false, true]) {
  test(`native indexed String reads borrow exact stored values (readonly=${readonly})`, () => {
    const { program } = analyzeRust({ files: { "index.ts": `
export function compare(values: ${readonly ? "readonly " : ""}string[], index: number, expected: string): boolean {
  return values[index]! === expected;
}
` } });
    const comparisons = expressions(program, node => program.records.binaryEmission.get(node)?.operator === "==");
    assert.equal(comparisons.length, 1, "the actual checked function publishes one native comparison");
    const left = BinaryExpression_Left(program.source.ast, comparisons[0]);
    const ownership = program.records.readOwnership.get(left);
    assert.equal(ownership?.source.kind, "borrow", "the native element retains its real shared storage input");
    assert.equal(ownership?.value.kind, "borrow", "the comparison observes the element without a String clone");
    assert.equal(program.records.binaryEmission.get(comparisons[0]).leftShared, true,
      "the existing binary consumer receives the completed shared-read decision");
    const elements = expressions(program, node => program.source.ast.is.IsElementAccessExpression(node));
    assert.equal(elements.length, 1, "the source has one exact native element access");
    const input = storageInput(program);
    const root = rustNativeStorageRoot(elements[0], input);
    assert.equal(root !== undefined, true, "the checked native parameter owns the collection storage");
    const path = rustNativeStorageProjections(elements[0], root, input);
    assert.equal(path?.length, 1, "the native element contributes one storage projection");
    assert.equal(path?.[0], rustNativeIndexStorageProjection, "the canonical index projection carries no guessed disjointness");
  });
}

test("different dynamic index expressions never prove disjoint native elements", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
export function compare(values: readonly string[], left: number, right: number): boolean {
  return values[left]! === values[right]!;
}
` } });
  const elements = expressions(program, node => program.source.ast.is.IsElementAccessExpression(node));
  assert.equal(elements.length, 2, "both distinct checked index expressions remain in the actual source");
  const input = storageInput(program);
  const roots = elements.map(node => rustNativeStorageRoot(node, input));
  assert.equal(roots[0] !== undefined && roots[0] === roots[1], true, "both native places have the same checked collection owner");
  const paths = elements.map(node => rustNativeStorageProjections(node, roots[0], input));
  assert.equal(paths.every(path => path?.length === 1), true, "both index paths have exact native storage evidence");
  assert.equal(rustNativeStoragePathsDisjoint(paths[0], paths[1]), false,
    "distinct index AST identities do not prove different runtime indices");
  assert.equal(rustNativeStoragePathsDisjoint(paths[0], []), false,
    "an indexed value can never be disjoint from replacement of its whole collection");
});

test("native indexed comparisons snapshot before actual same-collection writes", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
function replace(values: string[], index: number): string { values[index] = "after"; return "before"; }
export function compare(values: string[], left: number, right: number): boolean {
  return values[left]! === replace(values, right);
}
` } });
  const comparisons = expressions(program, node => program.records.binaryEmission.get(node)?.operator === "==");
  assert.equal(comparisons.length, 1, "the actual mutating RHS belongs to the one native comparison");
  const left = BinaryExpression_Left(program.source.ast, comparisons[0]);
  assert.equal(program.records.readOwnership.get(left)?.value.kind, "clone",
    "an unknown relationship between the two dynamic indices requires the first-value snapshot");
  assert.equal(program.records.binaryEmission.get(comparisons[0]).leftShared, false,
    "a subsequent mutable borrow cannot coexist with a borrowed first element");
});

test("a pure native index contract does not erase its actual index-expression effects", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
function mutateIndex(values: string[]): number { values[1] = "tail"; return 1; }
export function compare(values: string[]): boolean { return values[mutateIndex(values)]! === "tail"; }
` } });
  const elements = expressions(program, node => program.source.ast.is.IsElementAccessExpression(node) &&
    program.source.ast.is.IsCallExpression(ElementAccessExpression_ArgumentExpression(program.source.ast, node)));
  assert.equal(elements.length, 1, "the source contains the one genuine effectful index expression");
  const operation = program.records.targetOperation.get(elements[0]);
  assert.equal(operation?.kind, "provider-operation", "native indexing retains its exact selected provider fact");
  assert.equal(operation.abi.effects.evaluation, "pure", "the native index operation itself is pure");
  const index = ElementAccessExpression_ArgumentExpression(program.source.ast, elements[0]);
  const effects = program.sourceNavigation.expressionEffects(index);
  assert.equal(effects.invokes || effects.mutates, true,
    "the actual source invocation remains effectful independently of the native index ABI");
});

test("String-consuming RHS calls retain their actual first-value snapshots", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
function consume(value: string): string { let output = value; output += "!"; return output; }
export function compare(value: string): boolean { return value === consume(value); }
` } });
  const ownedParameters = expressions(program, node => program.source.ast.is.IsParameterDeclaration(node) &&
    program.source.ast.is.IsFunctionDeclaration(program.source.ast.parent(node)) &&
    program.source.ast.text(program.source.ast.name(program.source.ast.parent(node))) === "consume");
  assert.equal(ownedParameters.length, 1, "the actual mutating native callee has one exact source parameter");
  assert.equal(program.records.sourceParameterAbi.get(ownedParameters[0])?.mode, "value",
    "the snapshot inverse proves a genuinely owned native argument, not an inferred borrowed-return identity");
  const comparisons = expressions(program, node => program.records.binaryEmission.get(node)?.operator === "==");
  assert.equal(comparisons.length, 1, "the exact owned String consumer remains in the checked program");
  const left = BinaryExpression_Left(program.source.ast, comparisons[0]);
  assert.equal(program.records.readOwnership.get(left)?.value.kind, "clone",
    "observing a String before its consuming RHS still requires the original value");
  assert.equal(program.records.binaryEmission.get(comparisons[0]).leftShared, false,
    "native indexed borrowing never overrides an unrelated owned-call interval");
});

test("replacing a native inner array remains an effectful index computation", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
function replaceArray(values: string[][], calls: number[]): number {
  calls[0] = calls[0]! + 1;
  values[0] = ["after", "tail"];
  return 0;
}
export function compare(values: string[][], calls: number[]): boolean {
  return values[0]![replaceArray(values, calls)]! === "before";
}
` } });
  const elements = expressions(program, node => program.source.ast.is.IsElementAccessExpression(node) &&
    program.source.ast.is.IsCallExpression(ElementAccessExpression_ArgumentExpression(program.source.ast, node)));
  assert.equal(elements.length, 1, "the real native array replacement occurs in one selected index expression");
  const operation = program.records.targetOperation.get(elements[0]);
  assert.equal(operation?.kind, "provider-operation", "the outer native element retains its actual index contract");
  assert.equal(operation.abi.effects.evaluation, "pure", "purity belongs to indexing, not the preceding replacement");
  const index = ElementAccessExpression_ArgumentExpression(program.source.ast, elements[0]);
  const effects = program.sourceNavigation.expressionEffects(index);
  assert.equal(effects.invokes || effects.mutates, true,
    "the selected index expression cannot erase replacement of its receiver's owned array");
});

test("missing, non-place, observable and unsafe index facts never manufacture native storage", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
export function compare(values: readonly string[], expected: string): boolean { return values[0]! === expected; }
` } });
  const elements = expressions(program, node => program.source.ast.is.IsElementAccessExpression(node));
  assert.equal(elements.length, 1, "the inverse starts from one genuinely admitted native index");
  const element = elements[0];
  const input = storageInput(program);
  const root = rustNativeStorageRoot(element, input);
  const operation = program.records.targetOperation.get(element);
  assert.equal(operation?.kind, "provider-operation", "the original fact is the selected native provider index");
  const changes = [
    ["missing", undefined],
    ["owned getter", { ...operation, abi: { ...operation.abi, target: { form: "receiver-method", name: "get" } } }],
    ["observable", { ...operation, abi: { ...operation.abi, effects: { ...operation.abi.effects, evaluation: "observable" } } }],
    ["unsafe", { ...operation, abi: { ...operation.abi, effects: { ...operation.abi.effects, safety: "requires-unsafe" } } }],
  ];
  for (const [label, selected] of changes) {
    const records = { ...program.records, targetOperation: {
      get: node => node === element ? selected : program.records.targetOperation.get(node),
    } };
    assert.equal(rustNativeStorageProjections(element, root, { ...input, records }), undefined,
      `${label}: a missing exact native place guarantee never becomes a successful path`);
  }
});
