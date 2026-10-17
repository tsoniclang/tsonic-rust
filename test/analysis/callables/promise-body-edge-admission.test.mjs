import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { analyzeRustCheckedContext } from "../../helpers/rust-session/analysis-context.mjs";
import { selectRustSourceCallResult } from "../../../dist/policy/types/resolution/call-results.js";
import { rustDirectPromiseBodyCallee } from "../../../dist/analysis/callables/promise-bodies.js";

function run(name, source) {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "promise_edge_admission" } },
    files: { "index.ts": `import type { int32 } from "@tsonic/core/types.js";\n${source}` },
  });
  assert.equal(result.diagnostics.length, 0,
    `${name}: ${JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message })))}`);
  assert.equal(validateGeneratedProject(name, result.artifacts, { run: true }).status, 0,
    `${name}: complete native compile, lint and execution proof`);
  return rustSourceText(result);
}

test("async object methods retain rejection and caught effects without inventing native edges", { timeout: 300_000 }, () => {
  run("promise-object-method-edges", `
async function fail(): Promise<void> { throw new Error("selected rejection"); }
const api = {
  async reject(): Promise<void> { await fail(); },
  async forward(): Promise<void> { await api.reject(); },
  async caught(): Promise<void> { try { await fail(); } catch {} },
  async plain(): Promise<void> {},
};
async function invoke(): Promise<void> { await api.forward(); }
async function main(): Promise<void> {
  let rejected = false;
  try { await invoke(); } catch { rejected = true; }
  if (!rejected) throw new Error("lost object-method rejection");
  await api.caught();
  await api.plain();
}
await main();`);
});

test("a union receiver awaits the selected branch's public Promise body", { timeout: 300_000 }, () => {
  run("promise-union-method-edges", `
class Left { async value(): Promise<int32> { return 1; } }
class Right { async value(): Promise<int32> { return 2; } }
function select(flag: boolean): Left | Right { return flag ? new Left() : new Right(); }
async function read(value: Left | Right): Promise<int32> { return await value.value(); }
async function main(): Promise<void> {
  if (await read(select(true)) !== 1 || await read(select(false)) !== 2) throw new Error("union branch");
}
await main();`);
});

test("an optional call on a known-present receiver has consistent completion and invocation", { timeout: 300_000 }, () => {
  const rust = run("promise-present-optional-edges", `
class Work { async value(): Promise<int32> { return 7; } }
async function read(value: Work): Promise<int32> { return await value?.value(); }
async function main(): Promise<void> { if (await read(new Work()) !== 7) throw new Error("present optional"); }
await main();`);
  assert.equal(rust.includes("JsPromise"), false, "a proven-present optional receiver keeps its allocation-free native body path");
});

test("an actually absent optional receiver preserves absence and its present branch", { timeout: 300_000 }, () => {
  run("promise-absent-optional-edges", `
class Work { async value(): Promise<int32> { return 7; } }
function select(flag: boolean): Work | undefined { return flag ? new Work() : undefined; }
async function read(value: Work | undefined): Promise<int32> { return (await value?.value()) ?? 0; }
async function main(): Promise<void> {
  if (await read(select(false)) !== 0 || await read(select(true)) !== 7) throw new Error("optional branch");
}
await main();`);
});

test("a flow-proven optional receiver also keeps its direct native body", { timeout: 300_000 }, () => {
  const rust = run("promise-narrowed-optional-edges", `
class Work { async value(): Promise<int32> { return 7; } }
function select(flag: boolean): Work | undefined { return flag ? new Work() : undefined; }
async function read(value: Work | undefined): Promise<int32> {
  if (value === undefined) return 0;
  return await value?.value();
}
async function main(): Promise<void> {
  if (await read(select(false)) !== 0 || await read(select(true)) !== 7) throw new Error("narrowed optional branch");
}
await main();`);
  assert.equal(rust.includes("JsPromise"), false, "source narrowing makes the receiver present before the native invocation");
});

test("the canonical JS Promise result is projection-free and the edge owner refuses a non-Promise result", () => {
  let context;
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
async function value(): Promise<int32> { return 7; }
export async function read(): Promise<int32> { return await value(); }` }, compileTarget(request) {
    context = analyzeRustCheckedContext(request);
    return { kind: "resolved", value: { artifacts: [] }, diagnostics: context.diagnostics };
  } });
  assert.equal(result.diagnostics.length, 0, "the exact source/Promise contracts are complete");
  const call = context.sourceStorage.nodes.find(node => context.records.targetOperation.get(node)?.kind === "source-call" &&
    context.records.targetOperation.get(node).asyncBody !== undefined);
  assert.equal(call !== undefined, true, "an actual selected native source edge");
  const operation = context.records.targetOperation.get(call);
  const carrier = operation.asyncBody.logicalResultCarrier;
  const projected = selectRustSourceCallResult(context.projectTypes, carrier,
    () => assert.fail("a canonical JsPromise cannot request a source result projection"), context.typeDefinitions);
  assert.equal(projected?.nativeType === carrier && projected.selectedType === carrier && projected.projection === undefined,
    true, "the existing result owner preserves the complete Promise wrapper, not a projected payload");
  assert.equal(rustDirectPromiseBodyCallee(context, call, carrier) === operation.asyncBody.declaration,
    true, "the same result contract admits the actual edge");
  assert.equal(rustDirectPromiseBodyCallee(context, call, operation.resultCarrier) === undefined, true,
    "the physical settled payload cannot masquerade as a logical JS Promise result");
});
