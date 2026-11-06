import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles, formatDiagnostics } from "@tsonic/tsts";
import { createTargetSourceProgram, Node_Expression } from "@tsonic/target-api/source";
import { selectRustLexicalValuePlacement } from "../../../dist/analysis/callables/values/lexical-value-placement.js";
import { createRustRuntimeValueUsePlan } from "../../../dist/analysis/program/runtime-value-uses.js";
import { analyzeRustGenericAdoption, analyzeRustPromiseResultUses } from "../../../dist/analysis/callables/async/promise-results.js";
import { selectRustCheckedIteration } from "../../../dist/analysis/operations/iteration/selection.js";
import { selectRustPublishedCompletion } from "../../../dist/analysis/callables/async/source-completion.js";
import { createRustSourceProfileRegistry } from "../../../dist/analysis/project/source-profiles.js";
import { emptyRustLifetimeIndex } from "../../../dist/target-model/lifetimes/index.js";
import { createSourceDeclarationOwnershipBudget, defaultSourceDeclarationOwnershipLimits } from "@tsonic/target-api/analysis";
import { compileRust } from "../../helpers/rust-session.mjs";

function fixture(body) {
  const checked = createCompilerSessionFromFiles({ currentDirectory: "/src", files: {
    "/src/index.ts": `export function outer(flag: boolean) { let count = 0; ${body} }`,
  }, compilerOptions: { strict: true, module: "esnext", target: "es2022" } }).checkSource();
  assert.equal(formatDiagnostics(checked.diagnostics), "", "the placement control is real valid checked Source");
  const source = createTargetSourceProgram(checked);
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  const file = checked.getSourceFile("/src/index.ts");
  assert.equal(file !== undefined, true, "the exact source file is retained");
  visit(file);
  const declaration = nodes.find(node => source.ast.is.IsFunctionDeclaration(node) && source.ast.text(source.ast.name(node)) === "read");
  assert.equal(declaration !== undefined, true, "the identical native item declaration is present");
  const runtimeUses = createRustRuntimeValueUsePlan({ ast: source.ast, navigation: source.navigation,
    safetyApplications: { isCompileTimeApplicationReference: () => false } });
  const input = { source, declaration, nativeNodes: new Set(nodes), runtimeUses,
    records: { compileTimeSource: { get: () => undefined } }, maximumSteps: 4096, step: () => true };
  return { ...input, nodes, select: changes => selectRustLexicalValuePlacement({ ...input, ...changes }) };
}

test("Rust lexical placement uses the original single evaluated value reference", () => {
  const current = fixture("function read() { return count; } return flag ? read : null;");
  const selected = current.select();
  const references = current.runtimeUses.firstClassReferencesFor(current.declaration);
  assert.equal(selected.kind, "resolved");
  assert.equal(selected.inlineReference === references[0] && references.length === 1, true, "one exact conditional creation, not an eager copied callable");
});

test("Rust lexical placement shares repeated reads at their actual block statement", () => {
  for (const body of [
    "function read() { return count; } const first = read; const second = read; return flag ? first : second;",
    "function read() { return count; } while (flag) { return read; } return null;",
  ]) {
    const current = fixture(body);
    const selected = current.select();
    assert.equal(selected.kind, "resolved");
    assert.equal(selected.inlineReference === undefined, true, "a repeated native identity has one retained binding");
    assert.equal(current.source.ast.is.IsVariableStatement(selected.statement) || current.source.ast.is.IsWhileStatement(selected.statement), true,
      "the physical value is prepared at the first actual value demand, not the hoisted function declaration");
  }
});

test("Rust lexical placement follows admitted direct callers and refuses absent native caller evidence", () => {
  const current = fixture("function read() { return count; } function through() { return read; } if (flag) return null; return through();");
  const selected = current.select();
  assert.equal(selected.kind, "resolved");
  assert.equal(current.source.ast.is.IsReturnStatement(selected.statement), true, "the actual call demand follows the early exit");
  const through = current.nodes.find(node => current.source.ast.is.IsFunctionDeclaration(node) && current.source.ast.text(current.source.ast.name(node)) === "through");
  const missing = current.select({ nativeNodes: new Set(current.nodes.filter(node => node !== through)) });
  assert.equal(missing.kind, "unresolved", "an unmaterialized caller cannot authorize a creation");
  let failureCode;
  try { current.select({ step: () => false }); }
  catch (error) { failureCode = error.diagnostic?.code; }
  assert.equal(failureCode, "TSONIC_COMPILER_RESOURCE_LIMIT", "resource exhaustion is not a missing-value publication");
});

test("Rust async uses consume the canonical navigation disposition object", () => {
  const current = fixture("function read() { return count; } void read(); return read;");
  const call = current.nodes.find(node => current.source.ast.is.IsCallExpression(node));
  const selected = analyzeRustPromiseResultUses(current.source, current.nodes);
  assert.equal(selected.get(call) === current.source.navigation.expressionResultDisposition(call), true,
    "the finalized Host result-use fact is consumed without another analyzer");
});

test("Rust statement iteration rejects the distinct checked spread inventory without choosing a mechanism", () => {
  const current = fixture("function read() { return count; } const values = [count]; return [...values];");
  const spread = current.nodes.find(node => current.source.ast.is.IsSpreadElement(node));
  const source = current.source.semantics.forNode(spread).operations.iteration(spread);
  assert.equal(source?.subject.node === spread && source.subject.kind === "spread" && source.iterationKind === undefined, true,
    "the same checked spread carries an element fact, not a statement mechanism");
  const selected = selectRustCheckedIteration({ source, statement: spread, expression: Node_Expression(current.source.ast, spread) },
    { extensionId: "test.rust.checked-iteration" }, {});
  assert.equal(selected.kind, "reject");
  assert.equal(selected.diagnostic.extensionCode, "RUST_ITERATION_MECHANISM_UNSUPPORTED");
  assert.equal(selected.diagnostic.nodeOrSpan === spread, true, "the exact wrong subject is rejected before native carrier selection");
});

for (const surfaces of [[], ["js"]]) test(`Rust early completion uses published alias inventory on ${surfaces[0] ?? "native"}`, () => {
  let completed = false;
  const { result } = compileRust({ surfaces, files: { "index.ts": `
type Pending<Value> = Promise<Value>;
declare function pending(): Pending<number>;
export function run(): void { const value = pending(); void value; }` }, compileTarget(request) {
    const source = request.input.source;
    const nodes = [];
    const visit = node => {
      nodes.push(node);
      source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    source.sourceFiles.filter(file => !file.IsDeclarationFile).forEach(visit);
    const call = nodes.find(node => source.ast.is.IsCallExpression(node));
    assert.equal(call !== undefined, true, "the same real call precedes Native body lowering");
    const context = { source, sourceProfiles: createRustSourceProfileRegistry(source, request.jsEnabled),
      providerSemantics: request.providerSemantics, jsEnabled: request.jsEnabled };
    const budget = () => createSourceDeclarationOwnershipBudget(call, defaultSourceDeclarationOwnershipLimits);
    const selected = selectRustPublishedCompletion(call, context, budget());
    assert.equal(selected.kind, "resolved");
    assert.equal(selected.nativeFuture === !request.jsEnabled && selected.jsPromise === request.jsEnabled, true,
      "the exact profile owns one completion family through the published instantiated alias");
    const missing = selectRustPublishedCompletion(call, { ...context,
      source: { ...source, effectiveTypes: { get: () => undefined } } }, budget());
    assert.equal(missing.kind, "unresolved", "missing publication never reopens the checked formal type");
    const outcome = source.effectiveTypes.get(call);
    const declaration = nodes.find(node => source.ast.is.IsTypeAliasDeclaration(node));
    assert.equal(declaration !== undefined && outcome !== undefined && outcome.kind !== "refused", true);
    const cut = selectRustPublishedCompletion(call, { ...context, source: { ...source,
      effectiveTypes: { get: () => ({ ...outcome, type: { kind: "declared", declaration,
        typeArguments: [], cut: "recursion" } }) } } }, budget());
    assert.equal(cut.kind, "unresolved", "a recursion cut cannot manufacture completion from a raw alias body");
    const exhausted = selectRustPublishedCompletion(call, context,
      createSourceDeclarationOwnershipBudget(call, { ...defaultSourceDeclarationOwnershipLimits, maximumSteps: 0 }));
    assert.equal(exhausted.kind === "unresolved" && exhausted.cause.kind === "resource-limit", true,
      "the completion work shares the canonical typed budget");
    completed = true;
    return { kind: "resolved", value: { artifacts: [] }, diagnostics: [] };
  } });
  assert.equal(result.diagnostics.length, 0, JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message }))));
  assert.equal(completed, true, "the real Source composition reaches the Native preparation boundary");
});

test("Rust generic await admission precedes Native body lowering", () => {
  let selected;
  const { result } = compileRust({ files: { "index.ts": `
export async function adopt<Value>(value: Value): Promise<Value> { return await value; }` }, compileTarget(request) {
    const source = request.input.source;
    const nodes = [];
    const visit = node => {
      nodes.push(node);
      source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    source.sourceFiles.filter(file => !file.IsDeclarationFile).forEach(visit);
    selected = analyzeRustGenericAdoption({ source, nodes, projectRoot: request.input.paths.projectRoot,
      sourceProfiles: createRustSourceProfileRegistry(source, request.jsEnabled),
      providerSemantics: request.providerSemantics, jsEnabled: request.jsEnabled, sourceLifetimes: emptyRustLifetimeIndex });
    const awaited = nodes.find(node => source.ast.is.IsAwaitExpression(node));
    assert.equal(selected.length === 1 && selected[0].code === "TSONIC_GENERIC_ASYNC_ADOPTION_UNSUPPORTED" &&
      selected[0].sourceNode === awaited, true, "the original precise adoption refusal owns the identical await node");
    return { kind: "resolved", value: { artifacts: [] }, diagnostics: [] };
  } });
  assert.equal(result.diagnostics.length, 0, JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message }))));
  assert.equal(selected !== undefined, true);
});
