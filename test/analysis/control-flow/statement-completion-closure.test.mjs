import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, compileRust, artifactText, acmePlatformPackage, acmeTestingPackage, boolCarrier, unitCarrier } from "../../helpers/rust-session.mjs";
import { analyzeRustStatementCompletions, rustRuntimeSetSourceInputs } from "../../../dist/analysis/control-flow/statement-completion.js";
import { createRustProviderPackage } from "../../../dist/public/provider.js";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { rustNativeFixtureNodes } from "../../helpers/records.mjs";
import { createRustStatementCompletionProducer } from "../../../dist/analysis/program/records/operations/statement-completion.js";
import { createRustDirectStorageProducer } from "../../../dist/analysis/program/records/storage/direct-storage.js";

// Statement decisions are published as sealed record families; the queries below read those families.
const statementQueries = Object.freeze({ conditionFor: "statementCondition", controlTargetsFor: "statementControlTargets",
  exitFor: "controlExit", iterationFor: "iterationCompletion", setterFor: "runtimeSetter", assignmentFor: "assignmentCompletion",
  projectTypeTestReadsFor: "projectTypeTestReads" });

function statementIndex(records) {
  return Object.freeze({ admitted: node => records.statementAdmission.get(node) === true,
    ...Object.fromEntries(Object.entries(statementQueries).map(([name, family]) => [name, node => records[family].get(node)])) });
}

function checkedGuardNodes(program) {
  const nodes = [];
  const pending = [...program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile)];
  while (pending.length !== 0) {
    const node = pending.pop();
    nodes.push(node);
    program.source.ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
  }
  return nodes;
}

function diagnosticSourceLabel(diagnostic, source) {
  const node = diagnostic.sourceNode;
  if (node === undefined) return "";
  const declaredName = source.ast.is.IsIdentifier(node) ? node : source.ast.name(node);
  const name = declaredName !== undefined && source.ast.is.IsIdentifier(declaredName) ? source.ast.text(declaredName) : undefined;
  const parent = source.ast.parent(node);
  return ` at ${source.ast.kindName(node)}${name === undefined ? "" : ` ${name.slice(0, 192)}`}` +
    `${parent === undefined ? "" : ` parent=${source.ast.kindName(parent)}`}`;
}

for (const surfaces of [[], ["js"]]) {
  const surface = surfaces[0] ?? "native";
  for (const selectedThen of [false, true]) {
    const condition = selectedThen ? 'typeof value === "number"' : "false";
    const selected = "{ return value + 1; }";
    const unselected = "{ interface Unused { value: number; } }";
    const text = `export function run(value: number): number {
      if (${condition}) ${selectedThen ? selected : unselected}
      else ${selectedThen ? unselected : selected}
      return value;
    }`;
    test(`finalized ${selectedThen ? "true" : "false"} guard publishes its exact excluded branch root (${surface})`, () => {
      const { result } = compileRust({ surfaces, files: { "index.ts": text } });
      assert.equal(result.diagnostics.length, 0,
        result.diagnostics.slice(0, 6).map(issue => `${issue.code}: ${issue.message}`).join("; "));
      assert.equal(result.program !== undefined && result.plan !== undefined, true,
        "the complete checked control flow reaches native publication and planning");
      assert.equal(result.artifacts.some(artifact => String(artifact.path).endsWith(".rs")), true,
        "the selected native branch emits source");
      const program = result.program;
      const ast = program.source.ast;
      const nodes = checkedGuardNodes(program);
      const guard = nodes.find(ast.is.IsIfStatement);
      const statement = ast.as.AsIfStatement(guard);
      const excludedBranch = selectedThen ? statement.ElseStatement : statement.ThenStatement;
      const selectedBranch = selectedThen ? statement.ThenStatement : statement.ElseStatement;
      assert.equal(program.records.nativeGuardResult.get(statement.Expression), selectedThen,
        "the existing native guard owner supplies the exact Boolean outcome");
      assert.equal(program.records.nativeUnreachable.get(excludedBranch), true,
        "the canonical unreachable owner publishes the actual unselected root");
      assert.equal(program.records.nativeUnreachable.get(selectedBranch) === true, false,
        "the real selected branch is not erased");
      const declaration = ast.statements(excludedBranch)[0];
      assert.equal(ast.is.IsInterfaceDeclaration(declaration), true,
        "the complete checked source preserves its excluded declaration");
      assert.equal(statementIndex(program.records).admitted(declaration), false,
        "no native completion is fabricated for an excluded descendant");
      const returned = ast.statements(selectedBranch)[0];
      assert.equal(statementIndex(program.records).admitted(returned), true,
        "the selected return retains its existing admission");
      validateGeneratedProject(`finalized-${selectedThen ? "true" : "false"}-guard-${surface}`, result.artifacts);
    });
  }

  for (const selectedThen of [false, true]) {
    test(`finalized ${selectedThen ? "true" : "false"} guard without else preserves exact branch admission (${surface})`, () => {
      const { result } = compileRust({ surfaces, files: { "index.ts": `
export function run(value: number): number {
  if (${selectedThen}) { value += 1; }
  return value;
}` } });
      assert.equal(result.diagnostics.length, 0,
        result.diagnostics.slice(0, 6).map(issue => `${issue.code}: ${issue.message}`).join("; "));
      assert.equal(result.program !== undefined && result.plan !== undefined && result.artifacts.length !== 0, true,
        "an absent else does not invent an unresolved branch or remove the native program");
      const program = result.program;
      const ast = program.source.ast;
      const guard = checkedGuardNodes(program).find(ast.is.IsIfStatement);
      const statement = ast.as.AsIfStatement(guard);
      assert.equal(statement?.ElseStatement === undefined && statement?.ThenStatement !== undefined, true,
        "the real checked source has exactly one authored then branch");
      assert.equal(program.records.nativeGuardResult.get(statement.Expression), selectedThen,
        "the canonical guard owner retains the real Boolean outcome");
      assert.equal(program.records.nativeUnreachable.get(statement.ThenStatement) === true, !selectedThen,
        "only the actual nonselected then root receives unreachable evidence");
      const assignment = ast.statements(statement.ThenStatement)[0];
      assert.equal(statementIndex(program.records).admitted(assignment), selectedThen,
        "the selected body alone receives native statement completion");
      validateGeneratedProject(`finalized-no-else-${selectedThen}-${surface}`, result.artifacts);
    });
  }

  test(`finalized guard retains selected call effects and resource disposal (${surface})`, () => {
    const text = `
class Resource { [Symbol.dispose](): void { throw new Error("cleanup"); } }
function step(value: number): number {
  if (value < 0) throw new Error("step");
  return value + 1;
}
export function run(value: number): number {
  if (true) { using resource = new Resource(); return step(value); }
  else { interface Unused { value: number; } }
  return value;
}`;
    const { result } = compileRust({ surfaces, files: { "index.ts": text } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 6).map(issue => `${issue.code}: ${issue.message}`).join("; "));
    assert.equal(result.program !== undefined && result.plan !== undefined, true,
      "selected effects and cleanup reach native program and plan publication");
    const program = result.program;
    const ast = program.source.ast;
    const nodes = checkedGuardNodes(program);
    const resource = nodes.find(node => ast.is.IsVariableDeclaration(node) && ast.variableDeclarationKind(node) === "using");
    const invocation = nodes.find(node => ast.is.IsCallExpression(node) && ast.text(ast.as.AsCallExpression(node).Expression) === "step");
    const callable = nodes.find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "run");
    assert.equal(resource !== undefined && invocation !== undefined && callable !== undefined, true,
      "the actual selected resource, effectful call and callable identities are retained");
    assert.equal(program.records.resourceManagement.get(resource)?.disposal.fallible, true,
      "the existing resource owner keeps the throwing disposal ABI");
    const resourceStatement = ast.parent(ast.parent(resource));
    assert.equal(ast.is.IsVariableStatement(resourceStatement), true,
      "the selected resource has its actual checked variable statement");
    assert.equal(statementIndex(program.records).admitted(resourceStatement), true,
      "resource lifecycle validation still admits the selected acquisition");
    assert.equal(program.records.sourceCallEffects.get(invocation)?.invocation, "fallible",
      "the real selected invocation retains its actual fallible ABI");
    assert.equal(program.records.errorEffects.get(callable)?.localErrors, true,
      "the selected call and cleanup are never rewritten as pure");
    validateGeneratedProject(`finalized-selected-effects-${surface}`, result.artifacts);
  });

  test(`unresolved guard never erases an unsupported native computed field (${surface})`, () => {
    const { result } = compileRust({ surfaces, files: { "index.ts": `
export function run(flag: boolean, key: string): number {
  if (flag) { const value = { [key]: 1 }; }
  return 1;
}` } });
    assert.equal(result.diagnostics.some(issue => issue.code === "RUST_COMPUTED_FIELD_NAME_NOT_PROVEN" &&
      issue.message === "The computed key is not a const singleton binding or an exact enum constant."), true,
    "an unresolved native branch keeps the existing precise checked-key admission rejection");
    assert.equal(result.program === undefined, true, "an unsupported native body publishes no program");
    assert.equal(result.plan === undefined, true, "an unsupported native body reaches no planner");
    assert.equal(result.artifacts.length, 0, "an unsupported native body emits no partial artifacts");
  });

  for (const condition of ["false", "true"]) {
    test(`finalized ${condition} guard preserves native computed-field admission (${surface})`, () => {
      const { result, source } = compileRust({ surfaces, files: { "index.ts": `
export function run(key: string): number {
  if (${condition}) { const value = { [key]: 1 }; }
  return 1;
}` } });
      if (condition === "true") {
        assert.equal(result.diagnostics.some(issue => issue.code === "RUST_COMPUTED_FIELD_NAME_NOT_PROVEN" &&
          issue.message === "The computed key is not a const singleton binding or an exact enum constant."), true,
        "a required runtime field retains its exact native refusal");
        assert.equal(result.program === undefined && result.plan === undefined && result.artifacts.length === 0, true,
          "a selected unsupported native field never reaches publication");
      } else {
        assert.equal(result.diagnostics.length, 0,
          `an actual unreachable field imposes no native key obligation: ${result.diagnostics.map(diagnostic =>
            `${diagnostic.code}: ${diagnostic.message}${diagnosticSourceLabel(diagnostic, source)}`).join("; ").slice(0, 2048)}`);
        assert.equal(result.program !== undefined && result.plan !== undefined && result.artifacts.length > 0, true,
          "the selected valid native path still publishes");
      }
    });
  }

  test(`supported debugger remains an effect-preserving native no-op (${surface})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
let calls = 0;
function run(flag: boolean): number { if (flag) { debugger; calls += 1; } return calls; }
if (run(false) !== 0 || run(true) !== 1 || run(false) !== 1) throw new Error("debugger effects");
` } });
    assert.equal(result.diagnostics.length, 0, "the admitted debugger requires no emulation or rejection");
    assert.equal(result.program !== undefined && result.plan !== undefined, true, "the supported body reaches native planning");
    validateGeneratedProject(`finalized-debugger-effects-${surface}`, result.artifacts, { run: true });
  });
}

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
  program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile).forEach(visit);
  return { program, nodes, ast: program.source.ast };
}

test("native writable projection identities retain their full checked receiver chain", () => {
  const { program, nodes, ast } = checked(`
export function inspect(holder: { nested: { value: number } }, replacement: { nested: { value: number } }, unrelated: number): number {
  const direct = holder.nested.value;
  const parenthesized = (holder.nested).value;
  holder.nested = replacement.nested;
  holder = replacement;
  unrelated = direct;
  return direct + parenthesized + holder.nested.value + unrelated;
}
`);
  const rebound = nodes.find(node => ast.is.IsBinaryExpression(node) &&
    ast.operatorKindName(node) === "KindEqualsToken" &&
    ast.is.IsIdentifier(ast.as.AsBinaryExpression(node).Left) &&
    ast.text(ast.as.AsBinaryExpression(node).Left) === "holder");
  assert.equal(rebound !== undefined, true, "the checked program retains its real root-binding replacement");
  const nestedRebound = nodes.find(node => ast.is.IsBinaryExpression(node) &&
    ast.operatorKindName(node) === "KindEqualsToken" &&
    ast.is.IsPropertyAccessExpression(ast.as.AsBinaryExpression(node).Left) &&
    ast.text(ast.name(ast.as.AsBinaryExpression(node).Left)) === "nested");
  const unrelatedWrite = nodes.find(node => ast.is.IsBinaryExpression(node) &&
    ast.operatorKindName(node) === "KindEqualsToken" &&
    ast.is.IsIdentifier(ast.as.AsBinaryExpression(node).Left) &&
    ast.text(ast.as.AsBinaryExpression(node).Left) === "unrelated");
  assert.equal(nestedRebound !== undefined && unrelatedWrite !== undefined, true,
    "the actual checked source contains both a selected-path replacement and an unrelated write");
  const selected = nodes.filter(node => ast.is.IsPropertyAccessExpression(node) &&
    ast.text(ast.name(node)) === "value");
  assert.equal(selected.length, 3, "direct, parenthesized and rebound paths retain the same checked nested field");
  for (const [index, node] of selected.entries()) {
    const identity = program.records.directStorageIdentity.get(node);
    assert.equal(identity?.resolved, true, `${index}: the existing native place owner resolves the actual receiver chain`);
    assert.equal(identity.invalidatedRoots.has(rebound), true,
      `${index}: replacing the root binding invalidates its selected nested writable path`);
    assert.equal(identity.invalidatedRoots.has(nestedRebound), true,
      `${index}: replacing an intermediate field invalidates the same selected writable path`);
    assert.equal(identity.invalidatedRoots.has(unrelatedWrite), false,
      `${index}: an unrelated lexical write never invalidates the selected receiver chain`);
  }
});

function select(program, records = program.records) {
  const nativeNodes = rustNativeFixtureNodes(program);
  const native = new Set(nativeNodes);
  const countedLoops = new Map(nativeNodes.flatMap(node => {
    const loop = program.records.countedLoop.get(node);
    return loop === undefined ? [] : [[node, loop]];
  }));
  const selected = analyzeRustStatementCompletions({ source: program.source, sourceFiles: program.sourceFiles, records,
    isNativeNode: node => native.has(node),
    names: program.names, typeDefinitions: program.typeDefinitions, errorRegions: program.errorRegions,
    projectFlowReadSelections: program.projectFlowReadSelections,
    producer: createRustStatementCompletionProducer(() => undefined), required: [], countedLoops,
    safetyApplications: program.safetyApplications, components: program.sourcePackageComponents,
    ownership: program.ownership, projectTypes: program.projectTypes, projectFieldDispatch: program.projectFieldDispatch,
    structuralShapes: program.structuralShapes, frozenDataWrites: program.frozenDataWrites });
  return selected.kind === "resolved" ? { ...selected, plan: statementIndex(selected.plan) } : selected;
}

test("statement completion publishes exact source destinations for all labels and loop exits", () => {
  const { program, nodes, ast } = checked();
  const loop = nodes.find(ast.is.IsForStatement);
  const labels = nodes.filter(ast.is.IsLabeledStatement);
  const index = statementIndex(program.records);
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
  assert.equal(["statementAdmission", ...Object.values(statementQueries)].every(family => Object.isFrozen(program.records[family])), true,
    "the statement decision records are immutable");
  assert.equal(Object.isFrozen(targets), true, "source target aliases are immutable");
});

test("admitted conditions and assignment identities are pure stable lookups", () => {
  const { program, nodes, ast } = checked();
  const index = statementIndex(program.records);
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

for (const surfaces of [[], ["js"]]) {
  test(`compound previous values distinguish consuming snapshots from proven native observations (${surfaces[0] ?? "native"})`, () => {
    const { program, nodes, ast } = checked(`
export function bigintValue(values: bigint[]): bigint {
  const result = values[0] += values[0];
  return result;
}
export function scalarValue(): number { let value = 1; return value += 2; }
export function observedString(value: string): string { const result = value += "!"; return result; }
function replace(value: { text: string }): string { value.text = "changed"; return "!"; }
export function snapshotString(value: { text: string }): string {
  const result = value.text += replace(value);
  return result;
}
`, { surfaces });
    const selected = new Map();
    for (const node of nodes) {
      const evaluation = program.records.assignmentEvaluation.get(node);
      if (evaluation?.kind !== "compound") continue;
      let owner = ast.parent(node);
      while (owner !== undefined && !ast.is.IsFunctionDeclaration(owner)) owner = ast.parent(owner);
      const name = owner === undefined ? undefined : ast.name(owner);
      if (name !== undefined) selected.set(ast.text(name), { node, evaluation,
        value: program.records.assignmentValue.get(node), read: program.records.readOwnership.get(evaluation.left) });
    }
    assert.equal(selected.size, 4, "all actual compound classes retain their one finalized previous-value selection");
    const bigint = selected.get("bigintValue");
    assert.equal(bigint.value.previous.kind, "clone", "a consuming BigInt operation snapshots its retained previous value");
    assert.equal(bigint.value.previous === bigint.read.snapshot, true, "the native snapshot is the existing ownership owner's exact record");
    const scalar = selected.get("scalarValue");
    assert.equal(scalar.value.previous.kind, "copy", "native Copy values do not acquire a clone or reference");
    const observed = selected.get("observedString");
    assert.equal(observed.read.borrowedAcross.has(observed.evaluation.right), true,
      "the existing source interval proves that the exact String RHS cannot invalidate the previous value");
    assert.equal(observed.value.previous.kind === "borrow" && !observed.value.previous.mutable, true,
      "String concatenation observes the previous value without an avoidable owned snapshot");
    const snapshot = selected.get("snapshotString");
    assert.equal(snapshot.read.borrowedAcross.has(snapshot.evaluation.right), false,
      "the real mutating RHS cannot retain a borrowed previous String");
    assert.equal(snapshot.value.previous === snapshot.read.snapshot && snapshot.value.previous.kind === "clone", true,
      "the actual effectful RHS preserves its existing snapshot before it runs");
  });
}

test("statement admission never visits a canonically erased callable subtree", () => {
  const { program, nodes, ast } = checked(`export function run(): number {
    function unused(key: string): number { const value = { [key]: 7 }; return 1; }
    return 42;
  }`);
  const nativeNodes = new Set(rustNativeFixtureNodes(program));
  const erased = nodes.filter(node => !nativeNodes.has(node));
  assert.equal(erased.length > 0, true, "the real source retains its unused checked callable and body");
  const records = Object.freeze(Object.fromEntries(Object.entries(program.records).map(([family, reader]) =>
    [family, Object.freeze({ get(node) {
      assert.equal(erased.includes(node), false, `${family}: no native record is read for an erased node`);
      return reader.get(node);
    } })])));
  const result = select(program, records);
  assert.equal(result.kind, "resolved", "the complete canonical native statement domain is admitted");
  for (const node of erased) {
    assert.equal(result.plan.admitted(node), false, ast.kindName(node) + ": no erased statement is published");
    for (const name of ["conditionFor", "controlTargetsFor", "exitFor", "iterationFor", "setterFor", "assignmentFor", "projectTypeTestReadsFor"])
      assert.equal(result.plan[name](node) === undefined, true, `${name}: no decision is invented for an erased node`);
  }
  const returned = nodes.find(node => nativeNodes.has(node) && ast.is.IsReturnStatement(node));
  assert.equal(returned !== undefined && result.plan.admitted(returned), true,
    "the real native return remains admitted, so this is not an empty-domain success");
});

test("loop guards use native Boolean carriers rather than if-only static folding", () => {
  const text = `export function run(value: number): void {
    while (typeof value === "number") { value += 1; if (value > 2) break; }
    do { value += 1; } while (typeof value !== "number");
    for (; typeof value === "number"; value++) { if (value > 2) break; }
  }`;
  const { program, nodes, ast } = checked(text);
  const loops = nodes.filter(node => ast.is.IsWhileStatement(node) || ast.is.IsDoStatement(node) || ast.is.IsForStatement(node));
  assert.equal(loops.length, 3, "while, do and for conditions are all checked");
  for (const loop of loops) assert.equal(statementIndex(program.records).conditionFor(loop) !== undefined, true,
    "each loop has its native Boolean condition even when a guard is statically known");
});

test("program-wide admission preserves chained and expression-position assignments", () => {
  const text = `function step(): number { return 2; }
    function take(value: number): number { return value; }
    export function run(): number {
      let first = 0, second = 0, value = 0;
      first = second = 3;
      if ((value = step()) !== 0) first += take(second = 4);
      return first + second + value;
    }`;
  const { program, nodes } = checked(text);
  const assignments = nodes.filter(node => statementIndex(program.records).assignmentFor(node) !== undefined);
  assert.equal(assignments.length >= 5, true, "nested, conditional and argument assignments retain their exact operation evidence");
  const { result } = compileRust({ surfaces: [], files: { "index.ts": text } });
  assert.equal(result.diagnostics.length, 0,
    result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join("\n").slice(0, 2048));
  assert.equal(result.artifacts.length > 0, true, "expression positions introduce no new source rejection");
});

test("for-in lowering correspondence is closed at statement admission", () => {
  const { program, nodes, ast } = checked("export function keys(values: number[]): void { for (const key in values) {} }");
  const loop = nodes.find(ast.is.IsForInStatement);
  const original = program.records.targetOperation.get(loop);
  const result = select(program, { ...program.records, targetOperation: { get: node => node === loop
    ? { ...original, lowering: { kind: "owned" } } : program.records.targetOperation.get(node) } });
  assert.equal(result.kind, "rejected", "an incompatible for-of protocol cannot reach for-in planning");
  assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_ITERATION_SELECTION_NOT_PROVEN" &&
    diagnostic.sourceNode === loop), true, "the negative keeps the exact source subject at admission");
  assert.equal(result.plan === undefined, true, "no invalid lowering is published");
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
  const assignment = nodes.find(node => statementIndex(program.records).assignmentFor(node) !== undefined);
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
  const completions = loops.map(node => statementIndex(program.records).iterationFor(node));
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

test("early native setter source inputs and final admission share every checked operand and ABI refusal", () => {
  const { program, nodes, ast } = checked(`
import { Store } from "@acme/platform";
export function update(): void {
  const store = new Store("seed");
  store.count = 1;
  (store.count) += 2;
  ++store.count;
  store.count--;
  store[0] = 3;
  ++store[0];
  (store[1])--;
}`, { packages: [acmePlatformPackage({ includeSetters: true })] });
  const setters = nodes.filter(node => (program.records.compoundWrite.get(node) ??
    program.records.targetOperation.get(node))?.kind === "runtime-set");
  assert.equal(setters.length, 7, "direct, compound, prefix, postfix, property, index and wrapper source cases remain");
  for (const [ordinal, node] of setters.entries()) {
    const operation = program.records.compoundWrite.get(node) ?? program.records.targetOperation.get(node);
    const early = rustRuntimeSetSourceInputs(ast, node, operation);
    const final = statementIndex(program.records).setterFor(node);
    const label = `native setter ${ordinal}`;
    assert.equal(early !== undefined && final !== undefined, true, `${label}: one exact early/final source projection`);
    assert.equal(early.receiver === final.receiver, true, `${label}: original receiver identity`);
    assert.equal(early.sourceArguments.length === final.sourceArguments.length &&
      early.sourceArguments.every((argument, index) => argument === final.sourceArguments[index]), true,
    `${label}: every original source argument and its order`);
    assert.equal(Object.isFrozen(early) && Object.isFrozen(early.sourceArguments), true, `${label}: immutable projection`);
    for (const [name, abi] of [
      ["kind", { ...operation.abi, operationKind: "method" }],
      ["arity", { ...operation.abi, sourceArguments: [] }],
      ["erased argument", { ...operation.abi, sourceArguments: operation.abi.sourceArguments.map(argument =>
        ({ ...argument, disposition: "erased" })) }],
      ["awaiting", { ...operation.abi, effects: { ...operation.abi.effects, awaiting: "infallible" } }],
      ["result", { ...operation.abi, result: { ...operation.abi.result, carrier: boolCarrier } }],
    ]) assert.equal(rustRuntimeSetSourceInputs(ast, node, { ...operation, abi }) === undefined, true,
      `${label}: existing ${name} refusal remains at the single source-input owner`);
  }
});

for (const surfaces of [[], ["js"]]) {
  const surface = surfaces[0] ?? "native";
  for (const collection of ["tuple", "fixed-array"]) {
  test(collection === "tuple"
    ? `selected native compound and unary setters preserve values, storage and exact evaluation (${surface})`
    : `dynamic fixed-array native update receivers retain exact non-Copy places (${surface})`, { timeout: 300_000 }, () => {
    const { result, source } = compileRust({ surfaces, packages: [acmePlatformPackage({ includeSetters: true }), acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin", crateName: `native_setter_updates_${surface}` } },
      files: { "index.ts": `
import type { FixedArray, int32 } from "@tsonic/core/types.js";
import { Store } from "@acme/platform";
import { check } from "@acme/testing";
let indexCalls: int32 = 0;
let receiverCalls: int32 = 0;
let placeCalls: int32 = 0;
function index(): int32 { indexCalls += 1; return 1; }
function placeIndex(): ${collection === "tuple" ? "1" : "int32"} { placeCalls += 1; return 1; }
function fresh(): Store { receiverCalls += 1; return new Store("seed"); }
class Holder {
  nested: Store;
  constructor(nested: Store) { this.nested = nested; }
}
export function main(): void {
  const store = new Store("seed");
  store.count = 1;
  (store.count) += 2;
  check(store.count === 3);
  const previous = store.count++;
  check(previous === 3 && store.count === 4);
  const next = ++store.count;
  check(next === 5 && store.count === 5);
  const previousIndex = store[0]++;
  check(previousIndex === 4 && store[0] === 5);
  const nextIndex = ++store[1];
  check(nextIndex === 7 && store[0] === 6);
  (store[1])--;
  check(store[0] === 5);
  store[index()] += 3;
  check(indexCalls === 1 && store[0] === 8);
  const temporaryNext = ++fresh()[index()];
  check(temporaryNext === 6 && receiverCalls === 1 && indexCalls === 2);
  const stores: ${collection === "tuple" ? "[Store, Store]" : "FixedArray<Store, 2>"} = [new Store("seed"), new Store("abc")] as ${collection === "tuple" ? "[Store, Store]" : "const"};
  stores[placeIndex()].count += stores[1].count;
  check(stores[0].count === 4 && stores[1].count === 6 && placeCalls === 1);
  const selectedPrevious = stores[placeIndex()].count++;
  check(selectedPrevious === 6 && stores[1].count === 7 && placeCalls === 2);
  stores[placeIndex()][index()] += stores[1][0];
  check(stores[0][0] === 4 && stores[1][0] === 6 && placeCalls === 3 && indexCalls === 3);
  const holders: ${collection === "tuple" ? "[Holder, Holder]" : "FixedArray<Holder, 2>"} = [new Holder(new Store("seed")), new Holder(new Store("abc"))] as ${collection === "tuple" ? "[Holder, Holder]" : "const"};
  holders[placeIndex()].nested.count += holders[1].nested.count;
  check(holders[0].nested.count === 4 && holders[1].nested.count === 6 && placeCalls === 4);
}
main();
` } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}${diagnosticSourceLabel(diagnostic, source)}`)
        .join("\n").slice(0, 2048));
    const program = result.program;
    const ast = program.source.ast;
    const nested = checkedGuardNodes(program).find(node => ast.is.IsPropertyAccessExpression(node) &&
      ast.text(ast.name(node)) === "nested" && ast.is.IsElementAccessExpression(ast.as.AsPropertyAccessExpression(node).Expression) &&
      ast.is.IsCallExpression(ast.as.AsElementAccessExpression(ast.as.AsPropertyAccessExpression(node).Expression).ArgumentExpression));
    assert.equal(nested !== undefined, true, "the complete native control keeps its actual effectful nested field receiver");
    const projection = program.records.updateProjection.get(nested);
    assert.equal(projection?.complete, true, "the native place owner completes the whole selected projection path");
    assert.equal(projection.arguments.length, 1, "the full native receiver path evaluates its one selected index once");
    assert.equal(projection.fieldOffsets.get(nested), 1, "a source-field consumer selects its empty suffix, not the inner receiver index twice");
    assert.equal(Object.isFrozen(projection) && Object.isFrozen(projection.arguments), true,
      "the one published native projection payload and argument inventory are immutable");
    let open = true;
    const producer = createRustDirectStorageProducer(() => assert.equal(open, true, "the native projection producer is open"));
    producer.projection(nested, projection);
    assert.throws(() => producer.projection(nested, projection),
      failure => failure?.diagnostic?.code === "TSONIC_INTERNAL_ANALYSIS_INVARIANT" && failure.diagnostic.sourceNode === nested,
      "the one native projection payload has exactly one writer for its actual source operand");
    open = false;
    assert.throws(() => producer.projection(nested, projection), /the native projection producer is open/u,
      "the native projection owner cannot publish after the seal");
    const generated = artifactText(result, "src/index.rs");
    assert.match(generated, /\.set_count\(/u, "the selected property setter is not replaced by a direct field write");
    assert.match(generated, /\.set\(/u, "the selected index setter is retained");
    assert.doesNotMatch(generated, /\.clone\(|Box::new|unsafe\s*\{/u,
      "native update locations do not add copies, boxing or unsafe address reconstruction");
    validateGeneratedProject(`native-setter-updates-${surface}`, result.artifacts, { run: true });
  });
  }

  test(`a native method index getter without a setter never becomes writable storage (${surface})`, () => {
    const { result } = compileRust({ surfaces, packages: [acmePlatformPackage()], files: { "index.ts": `
import { Store } from "@acme/platform";
export function update(): void { const store = new Store("seed"); ++store[0]; }
` } });
    assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_UNSUPPORTED_AST" &&
      diagnostic.message.startsWith("Increment/decrement requires a finalized writable Rust location.")), true,
    "a native method read supplies no fabricated index assignment address");
    assert.equal(result.program === undefined && result.plan === undefined && result.artifacts.length === 0, true,
      "missing native write evidence is rejected before publication or partial emission");
  });

  for (const member of ["count", "[0]"]) {
    test(`native ${member} update refuses actual receiver rebinding across its RHS (${surface})`, () => {
      const { result, source } = compileRust({ surfaces, packages: [acmePlatformPackage({ includeSetters: true })],
        files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { Store } from "@acme/platform";
function index(): 1 { return 1; }
export function update(): void {
  let stores: [Store, Store] = [new Store("seed"), new Store("abc")];
  const other: [Store, Store] = [new Store("next"), new Store("last")];
  stores[index()]${member === "count" ? ".count" : member} += (stores = other, 1 as int32);
}
` } });
      assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_UNSUPPORTED_AST" &&
        diagnostic.message.startsWith("Writable projection cannot preserve source evaluation order when a later expression rebinds its selected storage.")), true,
      `the native place owner rejects actual root rebinding: ${result.diagnostics.slice(0, 3).map(diagnostic =>
        `${diagnostic.code}: ${diagnostic.message}${diagnosticSourceLabel(diagnostic, source)}`).join("; ")}`);
      assert.equal(result.program === undefined && result.plan === undefined && result.artifacts.length === 0, true,
        "a rejected native storage interval cannot publish a program, plan or partial artifacts");
    });
  }
}

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
      { exportId: "Flag", memberId: "Flag.value", operationKind: "property",
        target: { form: "method", name: "is_empty" }, resultCarrier: boolCarrier },
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

test("caught fallible native iteration uses the protected body without widening its callable error ABI", () => {
  const nativeSource = `
import { check } from "@acme/testing";
export function run(): number {
  let count = 0;
  try { for (const match of "aa".matchAll(/a/g)) { if (match.length > 0) count += 1; } } catch {}
  return count;
}
export function main(): void { check(run() === 2); }
main();
`;
  const packages = [acmeTestingPackage()];
  const { program, nodes, ast } = checked(nativeSource, { surfaces: ["js"], packages });
  const callable = nodes.find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "run");
  const iteration = nodes.find(ast.is.IsForOfStatement);
  assert.equal(program.records.targetOperation.get(iteration)?.lowering.kind, "fallible-owned",
    "the real native RegExp iteration retains its fallible protocol");
  assert.equal(program.errorRegions.get(callable)?.kind, "infallible", "the catch keeps the outward ABI infallible");
  assert.equal(statementIndex(program.records).iterationFor(iteration) !== undefined, true,
    "the actual protected iteration is admitted before publication");
  const { result } = compileRust({ surfaces: ["js"], packages,
    target: { id: "rust", options: { outputType: "bin", crateName: "r05_caught_fallible_iteration" } },
    files: { "index.ts": nativeSource } });
  assert.equal(result.diagnostics.length, 0,
    result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join("\n").slice(0, 2048));
  validateGeneratedProject("r05-caught-fallible-iteration", result.artifacts, { run: true });
});
