import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustAnalysisProgram } from "../../../dist/analysis/program/target-program.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { Node_Expression } from "@tsonic/target-api/source";

function analyze(text) {
  let program;
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": text }, compileTarget(request) {
    const analyzed = analyzeRustAnalysisProgram(request);
    if (analyzed.kind === "rejected") return analyzed;
    program = analyzed.value;
    return { kind: "resolved", value: { artifacts: [] }, diagnostics: analyzed.diagnostics };
  } });
  assert.equal(result.diagnostics.length, 0, JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message }))));
  assert.equal(program !== undefined, true, "the complete analysis program is admitted");
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.sourceFiles) visit(file);
  const calls = nodes.filter(node => program.records.targetOperation.get(node)?.kind === "source-call");
  const arrow = nodes.find(node => program.source.ast.is.IsArrowFunction(node) &&
    program.source.ast.hasModifierKind(node, "async"));
  assert.equal(arrow !== undefined, true, "the authored async arrow is present");
  return { program, calls, arrow };
}

test("an immutable module async arrow has one native body for its direct awaits", () => {
  const current = analyze(`
const increment = async (value: number): Promise<number> => value + 1;
async function outer(): Promise<number> {
  return await increment(1) + await increment(2);
}
export const marker = 0;`);
  const body = current.program.promiseBodies.declarations.get(current.arrow);
  assert.equal(body !== undefined, true, "the exact module-native callable owns its native body");
  assert.match(body.name, /^increment_native\d*$/u);
  assert.equal(current.program.promiseBodies.objects.has(current.arrow), false,
    "direct calls require no Promise object");
  const selected = current.calls.filter(node => current.program.records.targetOperation.get(node).asyncBody?.declaration === current.arrow);
  assert.equal(selected.length, 2, "both calls retain the same original arrow identity");
  const asynchronous = current.program.records.asyncFunction.get(current.arrow);
  assert.equal(asynchronous?.kind === "js-promise" && asynchronous.lowering.kind === "settled", true,
    "the settled body retains its existing no-suspension classification");
  assert.equal(selected.every(node => rustTargetTypeRefEquals(current.program.records.targetOperation.get(node).resultCarrier,
    asynchronous.outputCarrier)), true, "both calls use the exact settled native body payload without a Promise allocation");
});

test("an exported module async arrow keeps its object facet as well as its internal native body", () => {
  const current = analyze(`
export const increment = async (value: number): Promise<number> => value + 1;
async function outer(): Promise<number> { return await increment(1); }
export const marker = 0;`);
  assert.equal(current.program.promiseBodies.declarations.has(current.arrow), true, "the internal native body remains selected");
  assert.equal(current.program.promiseBodies.objects.has(current.arrow), true, "an exported value retains its original Promise ABI");
  assert.equal(current.calls.some(node => current.program.records.targetOperation.get(node).asyncBody?.declaration === current.arrow), true,
    "an internal immediate await still uses the native body");
});

test("a mutable module async arrow never receives a direct native body selection", () => {
  const current = analyze(`
let increment = async (value: number): Promise<number> => value + 1;
async function outer(): Promise<number> { return await increment(1); }
export const marker = 0;`);
  assert.equal(current.program.promiseBodies.declarations.has(current.arrow), false,
    "mutable callable storage is not a module-native function");
  assert.equal(current.program.promiseBodies.objects.has(current.arrow), true, "the original callable retains its object completion");
  assert.equal(current.calls.some(node => current.program.records.targetOperation.get(node).asyncBody?.declaration === current.arrow), false,
    "a mutable reference cannot become a direct body edge");
});

test("a stored result of a module async arrow keeps an actual Promise object demand", () => {
  const current = analyze(`
const increment = async (value: number): Promise<number> => value + 1;
async function outer(): Promise<number> {
  const pending = increment(1);
  const between = 2;
  return await pending + between;
}
export const marker = 0;`);
  assert.equal(current.program.promiseBodies.declarations.has(current.arrow), true, "the native implementation is still named");
  assert.equal(current.program.promiseBodies.objects.has(current.arrow), true, "the non-immediate storage demands the object facet");
  const call = current.calls.find(node => current.program.source.ast.text(Node_Expression(current.program.source.ast, node)) === "increment");
  assert.equal(call !== undefined && current.program.records.targetOperation.get(call).asyncBody === undefined, true,
    "intervening evaluation is not silently reordered through a direct body edge");
});
