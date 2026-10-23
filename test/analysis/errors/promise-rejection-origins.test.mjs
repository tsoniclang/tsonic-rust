import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustCheckedContext } from "../../helpers/rust-session-analysis-context.mjs";
import { rustJsValueTargetType } from "../../../dist/target-model/types/carriers/js.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

function analyze(text) {
  let context;
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": text }, compileTarget(request) {
    context = analyzeRustCheckedContext(request);
    return { kind: "resolved", value: { artifacts: [] }, diagnostics: context.diagnostics };
  } });
  assert.equal(context !== undefined, true, "the real Rust analysis context consumes the checked source profile");
  return { context, result };
}

const model = `
import type { int32 } from "@tsonic/core/types.js";
class Failure extends Error { constructor(readonly code: int32) { super("failure"); } }
const original = new Failure(7);
`;

function originalOrigin(context, node) {
  const selected = context.sourceStorage.subjectFor(node);
  assert.equal(selected.kind === "resolved", true, "the catch or rejection parameter has an owned storage subject");
  const origins = context.sourceStorage.closedOriginsFor(selected.subject);
  assert.equal(origins.kind === "complete", true, origins.reason ?? "the rejection channel is closed");
  const original = context.sourceStorage.nodes.find(candidate => context.ast.is.IsNewExpression(candidate) &&
    context.ast.text(candidate) === "new Failure(7)");
  assert.equal(original !== undefined, true, "the original project-error allocation is present");
  assert.equal(origins.origins.some(origin => origin.subject.node === original), true,
    "the original allocation, not a reconstructed nominal error, reaches the handler");
}

for (const [name, operand, statement] of [
  ["direct", "new Promise<number>((resolve, reject) => { reject(original); })", ""],
  ["stored captured reject", "pending", `const pending = new Promise<number>((resolve, reject) => {
    function fail(): void { reject(original); }
    fail();
  });`],
  ["source async throw", "fail()", "async function fail(): Promise<number> { throw original; }"],
]) {
  test(`Rust consumes the shared ${name} rejection origin without changing its error carrier`, () => {
    const { context, result } = analyze(`${model}
${statement}
export async function read(): Promise<number> {
  try { return await ${operand}; }
  catch (reason) { return reason instanceof Failure && reason === original ? reason.code : 0; }
}`);
    assert.equal(result.diagnostics.length, 0,
      JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message }))));
    const caught = context.sourceStorage.nodes.find(node => context.ast.is.IsVariableDeclaration(node) &&
      context.ast.text(context.ast.name(node)) === "reason");
    assert.equal(caught !== undefined, true, "the checked catch variable is present");
    originalOrigin(context, caught);
    const awaited = context.sourceStorage.nodes.find(node => context.ast.is.IsAwaitExpression(node));
    const effects = context.records.errorEffects.get(awaited);
    assert.equal(effects?.nativeErrors.some(error => rustTargetTypeRefEquals(error.errorType, rustJsValueTargetType())), true,
      "origin precision does not invent a per-producer JS Promise rejection ABI");
  });
}

for (const reaction of ["catch(reason => reason)", "then(value => value, reason => reason)"]) {
  test(`Rust forwards receiver-rejection provenance to Promise.${reaction.split("(")[0]}`, () => {
    const { context, result } = analyze(`${model}
const pending = new Promise<number>((resolve, reject) => { reject(original); });
export const recovered = pending.${reaction};`);
    assert.equal(result.diagnostics.length, 0,
      JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message }))));
    const parameter = context.sourceStorage.nodes.find(node => context.ast.is.IsParameterDeclaration(node) &&
      context.ast.text(context.ast.name(node)) === "reason");
    assert.equal(parameter !== undefined, true, "the exact checked rejection callback parameter is present");
    originalOrigin(context, parameter);
  });
}

test("Rust never fabricates closed rejection origins when the executor reject escapes", () => {
  const { context } = analyze(`${model}
declare function external(reject: (reason?: unknown) => void): void;
export async function read(): Promise<number> {
  try { return await new Promise<number>((resolve, reject) => { external(reject); }); }
  catch (reason) { return 0; }
}`);
  const caught = context.sourceStorage.nodes.find(node => context.ast.is.IsVariableDeclaration(node) &&
    context.ast.text(context.ast.name(node)) === "reason");
  const selected = context.sourceStorage.subjectFor(caught);
  assert.equal(selected.kind === "resolved", true, "the original catch subject is still owned");
  const origins = context.sourceStorage.closedOriginsFor(selected.subject);
  assert.equal(origins.kind, "unresolved", "an escaping native rejection callback is not an empty safe origin set");
  assert.match(origins.reason, /rejection.*(escap|nonescap)/u,
    "the refusal preserves the rejection owner's specific missing proof");
});
