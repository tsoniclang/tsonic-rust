import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { createRustAnalysisContext } from "../../../dist/analysis/program/context.js";
import { analyzeRustProgram } from "../../../dist/analysis/program/analyze.js";
import { analyzeRustRuntimeReferences, analyzeRustDispatchContextCatalog } from "../../../dist/analysis/project/index.js";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { recordFallibilityFacts } from "../../../dist/analysis/resources/fallibility.js";
import { rustErrorEffectsEqual } from "../../../dist/analysis/errors/error-effects.js";
import { createRustRecordFixture } from "../../helpers/records.mjs";




function fixture(text) {
  let program;
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": text }, compileTarget(request) {
    const references = analyzeRustRuntimeReferences(request.input.runtimeReferences, request.configuration.foundation);
    assert.equal(references.kind, "resolved");
    const dispatch = analyzeRustDispatchContextCatalog(request.providerSemantics.dispatchContexts, references.plan.activeCrates);
    assert.equal(dispatch.kind, "resolved");
    const context = createRustAnalysisContext(request.input, request.providerSemantics, request.jsEnabled,
      request.rootPublishesLibrary, dispatch.plan);
    analyzeRustProgram(context);
    program = { ...context, records: context.records.seal() };
    return { kind: "resolved", value: { artifacts: [] }, diagnostics: context.diagnostics };
  } });
  assert.deepEqual(result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`), []);
  const source = program.source;
  const ast = source.ast;
  const declarations = [];
  const visit = node => {
    if (ast.is.IsFunctionDeclaration(node)) declarations.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  const filtered = new Set(["errorEffects", "fallible",
    "sourceCallEffects", "sourceErrorEffects"]);
  const run = maximumWork => {
    const parent = createRustRecordFixture(Object.fromEntries([...filtered].map(family =>
      [family, { get: () => undefined }])), program.records);
    const records = createRustProgramRecordBuilder(program.typeDefinitions, parent);
    const diagnostics = [];
    const context = { ...program, source, ast, records, diagnostics };
    recordFallibilityFacts({ context, resolving: new Set(), rejectedExpressions: new WeakSet(),
      preparedCallbackCalls: new Map(), objectLiteralMethodExpressions: [], objectLiteralMethodSpreadExpressions: [] },
    program.sourceFiles, maximumWork);
    return { records, diagnostics };
  };
  return { program, declarations, run };
}

function assertEffectsUnchanged(current, result) {
  assert.deepEqual(result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`), []);
  for (const declaration of current.declarations) {
    const expected = current.program.records.errorEffects.get(declaration);
    const actual = result.records.errorEffects.get(declaration);
    assert.equal(actual !== undefined, true, "all exact declaration effects must be finalized");
    assert.equal(rustErrorEffectsEqual(actual, expected), true, "resource accounting cannot alter exact error effects");
  }
}

test("the same valid source fails a small finite budget and completes with adequate work", () => {
  const current = fixture(`
    export function invoke(callback: () => number): number { return callback(); }
    export function forward(left: () => number, right: () => number): number {
      return invoke(left) + invoke(right);
    }
  `);
  const limited = current.run(10);
  assert.deepEqual(limited.diagnostics.map(diagnostic => diagnostic.code), ["RUST_ERROR_EFFECTS_WORK_LIMIT"]);
  for (const declaration of current.declarations) assert.equal(limited.records.errorEffects.get(declaration) === undefined,
    true, "exhaustion must not publish an invented pure declaration");
  assertEffectsUnchanged(current, current.run(1_000_000));
});

test("work limits do not reinterpret missing, invalid or infinite selections as unbounded", () => {
  const current = fixture("export function pure(): number { return 1; }");
  for (const selection of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const result = current.run(selection);
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.code), ["RUST_ERROR_EFFECTS_WORK_INVALID"]);
  }
  assertEffectsUnchanged(current, current.run(undefined));
});

for (const [name, source] of [
  ["pure recursion", "export function recurse(depth: number): number { return depth <= 0 ? 0 : recurse(depth - 1); }"],
  ["native input recursion", `
    export function recurse(callback: () => number, depth: number): number {
      return depth <= 0 ? callback() : recurse(callback, depth - 1);
    }
  `],
  ["mutual recursion", `
    export function left(callback: () => number, depth: number): number {
      return depth <= 0 ? callback() : right(callback, depth - 1);
    }
    export function right(callback: () => number, depth: number): number {
      return depth <= 0 ? callback() : left(callback, depth - 1);
    }
  `],
  ["generic forwarding", `
    export function invoke<Value>(callback: () => Value): Value { return callback(); }
    export function forward(callback: () => number): number { return invoke(callback); }
  `],
  ["stable generic recursion", `
    export function recurse<Value>(callback: <Item>() => Item, depth: number): Value {
      return depth <= 0 ? callback<Value>() : recurse<Value>(callback, depth - 1);
    }
  `],
  ["catch suppression and finally", `
    export function invoke(left: () => number, right: () => number): number {
      try { return left(); } catch { return 0; } finally { right(); }
    }
  `],
  ["local throws and pure bodies", `
    export function pure(): number { return 1; }
    export function fail(): number { throw new Error("local"); }
    export function caught(): number { try { return fail(); } catch { return pure(); } }
  `],
]) test(`${name} preserves convergent exact effects under one aggregate budget`, () => {
  const current = fixture(source);
  assertEffectsUnchanged(current, current.run(1_000_000));
});

for (const type of ["Value[]", "[Value, Value]"]) test(`recursive ${type} growth exhausts work before unbounded normalization`, () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
    export function recurse<Value>(callback: <Item>() => Item, depth: number): Value {
      return depth <= 0 ? callback<Value>() : recurse<${type}>(callback, depth - 1)[0];
    }
  ` } });
  assert.equal(result.artifacts.length, 0);
  assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.code), ["RUST_ERROR_EFFECTS_WORK_LIMIT"]);
});
