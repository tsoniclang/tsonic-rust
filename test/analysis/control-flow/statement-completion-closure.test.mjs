import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, compileRust, artifactText, acmePlatformPackage, acmeTestingPackage, boolCarrier, unitCarrier } from "../../helpers/rust-session.mjs";
import { analyzeRustStatementCompletions } from "../../../dist/analysis/control-flow/statement-completion.js";
import { createRustProviderPackage } from "../../../dist/public/provider.js";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

const source = `
export function run(flag: boolean): number {
  let total = 0;
  outer: inner: for (let index = 0; index < 3; index++) {
    if (flag) continue outer;
    switch (index) { case 1: break; default: total += index; }
    if (total > 2) break outer;
  }
  do { total += 1; } while (total < 0);
  while (flag) { break; }
  return total;
}
`;

function checked(text = source, options = {}) {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": text }, ...options });
  const nodes = [];
  const visit = node => { nodes.push(node); program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  program.sourceFiles.forEach(visit);
  return { program, nodes, ast: program.source.ast };
}

function select(program, records = program.records) {
  return analyzeRustStatementCompletions({ source: program.source, sourceFiles: program.sourceFiles, records,
    names: program.names, typeDefinitions: program.typeDefinitions, errorRegions: program.errorRegions,
    projectFlowReadSelections: program.projectFlowReadSelections });
}

test("statement completion publishes exact source destinations for all labels and loop exits", () => {
  const { program, nodes, ast } = checked();
  const loop = nodes.find(ast.is.IsForStatement);
  const labels = nodes.filter(ast.is.IsLabeledStatement);
  const index = program.statementCompletions;
  assert.equal(loop !== undefined, true, "checked for statement exists");
  const targets = index.controlTargetsFor(loop);
  assert.equal(targets?.includes(loop), true, "loop has its exact own target");
  for (const label of labels) assert.equal(targets.includes(label), true, "every authored outer label names the same loop");
  const continuation = nodes.find(ast.is.IsContinueStatement);
  assert.equal(index.exitFor(continuation)?.target === loop, true, "outer-label continue is resolved to its actual loop");
  for (const exit of nodes.filter(node => ast.is.IsBreakStatement(node) || ast.is.IsContinueStatement(node))) {
    const selected = index.exitFor(exit);
    assert.equal(selected !== undefined && Object.isFrozen(selected), true, "every exit has one immutable admitted target");
    assert.equal(index.admitted(exit), true, "every retained exit is admitted");
  }
  assert.equal(Object.isFrozen(index), true, "the statement decision index is immutable");
  assert.equal(Object.isFrozen(targets), true, "source target aliases are immutable");
});

test("admitted conditions and assignment identities are pure stable lookups", () => {
  const { program, nodes, ast } = checked();
  const index = program.statementCompletions;
  for (const node of nodes.filter(node => ast.is.IsIfStatement(node) || ast.is.IsForStatement(node) ||
    ast.is.IsWhileStatement(node) || ast.is.IsDoStatement(node))) {
    const selected = index.conditionFor(node);
    assert.equal(selected !== undefined, true, "each explicit condition is selected before planning");
    assert.equal(index.conditionFor(node) === selected, true, "condition lookup retains source identity");
  }
  const assignments = nodes.filter(node => index.assignmentFor(node) !== undefined);
  assert.equal(assignments.length > 0, true, "the checked compound assignments are admitted");
  for (const node of assignments) assert.equal(index.assignmentFor(node) === program.records.targetOperation.get(node), true,
    "the sole admission retains the finalized operation identity");
  const foreign = Object.freeze({ foreign: true });
  for (const name of ["conditionFor", "controlTargetsFor", "exitFor", "iterationFor", "setterFor", "assignmentFor", "projectTypeTestReadsFor"])
    assert.equal(index[name](foreign) === undefined, true, `${name}: foreign nodes have no invented decision`);
  assert.equal(index.admitted(foreign), false, "foreign statements are not admitted");
});

test("native-valid nested outer-label continue no longer depends on a label spelling stack", () => {
  const { result } = compileRust({ surfaces: [], files: { "index.ts": source } });
  assert.equal(result.diagnostics.length, 0,
    result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join("\n").slice(0, 2048));
  const generated = artifactText(result, "src/index.rs");
  assert.match(generated, /continue 'loop(?:_\d+)?/u, "continue targets the native loop");
  assert.doesNotMatch(generated, /continue 'label/u, "a labelled block is never mistaken for the continue destination");
  const nativeSource = `
import { check } from "@acme/testing";
function run(flag: boolean): number {
  let total = 0;
  outer: inner: for (let index = 0; index < 3; index++) {
    if (flag) continue outer;
    total += index;
    if (total > 2) break outer;
  }
  return total;
}
export function main(): void { check(run(true) === 0); check(run(false) === 3); }
main();
`;
  const native = compileRust({ surfaces: [], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "r05_native_label_destinations" } },
    files: { "index.ts": nativeSource } }).result;
  assert.equal(native.diagnostics.length, 0,
    native.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join("\n").slice(0, 2048));
  validateGeneratedProject("r05-nested-outer-label-continue", native.artifacts, { run: true });
});

test("conflicting finalized operator identity is rejected at the analysis owner", () => {
  const { program, nodes } = checked();
  const assignment = nodes.find(node => program.statementCompletions.assignmentFor(node) !== undefined);
  const records = { ...program.records, selectedOperation: { get: node => node === assignment
    ? { ...program.records.selectedOperation.get(node), operationId: "foreign.operation" }
    : program.records.selectedOperation.get(node) } };
  const result = select(program, records);
  assert.equal(result.kind, "rejected", "conflicting checked selection cannot be published");
  assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_ASSIGNMENT_SELECTION_NOT_PROVEN" && diagnostic.sourceNode === assignment), true,
    "rejection retains the exact source operator subject");
});

test("non-Boolean native conditions are rejected before planning without truthiness emulation", () => {
  const actual = compileRust({ surfaces: [], files: { "index.ts": "export function run(value: number): void { if (value) {} }" } }).result;
  assert.equal(actual.diagnostics.some(diagnostic => diagnostic.code === "RUST_CONDITION_NOT_BOOLEAN"), true,
    "native Boolean admission owns the refusal");
  assert.equal(actual.artifacts.length, 0, "refusal cannot emit partial target artifacts");
});

test("for-of declarations, identifier assignments and patterns have one admitted binding owner", () => {
  const bindingSource = `
export function run(values: number[]): number {
  let selected = 0;
  for (selected of values) {}
  for (let value of values) { value += 1; selected = value; }
  const pairs: [number, number][] = [[1, 2]];
  for (const [left, right] of pairs) { selected += left + right; }
  return selected;
}`;
  const { program, nodes, ast } = checked(bindingSource);
  const loops = nodes.filter(ast.is.IsForOfStatement);
  assert.equal(loops.length, 3, "the three native-valid binding forms are checked");
  const completions = loops.map(node => program.statementCompletions.iterationFor(node));
  assert.equal(completions[0]?.binding.kind, "assignment", "existing binding is assigned, never shadowed");
  assert.equal(completions[1]?.binding.kind, "declaration", "a mutable lexical binding is declared");
  assert.equal(completions[1]?.binding.mutable, true, "mutability comes from the existing mutation owner");
  assert.equal(completions[2]?.binding.kind, "pattern", "binding patterns retain their existing owner");
  for (const completion of completions) assert.equal(Object.isFrozen(completion), true, "iteration completion is immutable data");
  const { result } = compileRust({ surfaces: [], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "r05_native_iteration_bindings" } },
    files: { "index.ts": `import { check } from "@acme/testing";
${bindingSource}
export function main(): void { check(run([1, 2]) === 6); }
main();` } });
  assert.equal(result.diagnostics.length, 0,
    result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join("\n").slice(0, 2048));
  validateGeneratedProject("r05-native-iteration-bindings", result.artifacts, { run: true });
});

test("finalized native field setters use the one ABI renderer for direct, compound and update writes", () => {
  const definition = acmePlatformPackage({ includeSetters: true }).createTargetContributions()[0].definition;
  const provider = createRustProviderPackage({ ...definition, operations: definition.operations.map(operation =>
    operation.operationKind === "property-set" ? { ...operation, target: { form: "field", name: "count" } } : operation) });
  const source = `
import { Store } from "@acme/platform";
import { check } from "@acme/testing";
export function main(): void {
  const store = new Store("seed");
  store.count = 7;
  check(store.count === 7);
  store.count += 2;
  check(store.count === 9);
  store.count++;
  check(store.count === 10);
  store[0] = 3;
  check(store[0] === 3);
}
main();
`;
  const { result } = compileRust({ surfaces: [], packages: [provider, acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "r05_native_field_setter" } },
    files: { "index.ts": source } });
  assert.equal(result.diagnostics.length, 0,
    result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join("\n").slice(0, 2048));
  const generated = artifactText(result, "src/index.rs");
  assert.match(generated, /\.count = /u, "selected direct storage assignment is emitted");
  assert.doesNotMatch(generated, /\.set_count\(/u, "the renderer does not substitute another provider operation");
  validateGeneratedProject("r05-native-field-setter", result.artifacts, { run: true });
});

test("the canonical setter renderer preserves receiver and value effects for a selected native macro", () => {
  const carrier = { kind: "target-named", id: "r05.Flag" };
  const provider = createRustProviderPackage({ id: "r05-flag", displayName: "Native flag", version: "1.0.0",
    modules: [{ moduleSpecifier: "@r05/flag", providerModuleId: "r05.flag", exports: [
      { id: "Flag", name: "Flag", kind: "interface", members: [{ id: "Flag.value", name: "value", kind: "property", type: { kind: "boolean" } }] },
      { id: "open", name: "open", kind: "function", signatures: [{ id: "open()", parameters: [],
        returnType: { kind: "provider-ref", moduleSpecifier: "@r05/flag", exportName: "Flag" } }] },
    ] }], types: [{ exportId: "Flag", targetCarrier: carrier }], carrierPaths: { "r05.Flag": "String" }, crates: [],
    operations: [
      { exportId: "open", operationKind: "method", target: { form: "call", path: "String::new" }, resultCarrier: carrier },
      { exportId: "Flag", memberId: "Flag.value", operationKind: "property-set",
        target: { form: "expression-macro", path: "core::assert", delimiter: "parentheses" },
        parameterCarriers: [boolCarrier], resultCarrier: unitCarrier },
    ] });
  const nativeSource = `
import type { int32 } from "@tsonic/core/types.js";
import { open, type Flag } from "@r05/flag";
import { check } from "@acme/testing";
let order: int32 = 0;
function receiver(): Flag { order = order * 10 + 1; return open(); }
function value(): boolean { order = order * 10 + 2; return true; }
export function main(): void { receiver().value = value(); check(order === 12); }
main();
`;
  const { result } = compileRust({ surfaces: [], packages: [provider, acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "r05_native_macro_setter" } },
    files: { "index.ts": nativeSource } });
  assert.equal(result.diagnostics.length, 0,
    result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join("\n").slice(0, 2048));
  assert.match(artifactText(result, "src/index.rs"), /core::assert!\(/u, "the actual selected native macro is rendered");
  validateGeneratedProject("r05-native-macro-setter", result.artifacts, { run: true });
});
