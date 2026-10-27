import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { sourcePackageGraphFixture } from "../../../../tsonic/test/fixtures/source-package-graph.mjs";
import { createSourceStorageBudget, defaultSourceStorageLimits } from "@tsonic/target-api/analysis";
import { analyzeRustCheckedContext } from "../../helpers/rust-session-analysis-context.mjs";
import { selectRustPromiseBodyRecursion } from "../../../dist/analysis/callables/async/promise-recursion.js";

const header = `import type { int32 } from "@tsonic/core/types.js";`;

function compile(text, extra = {}) {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "promise_recursion" } },
    files: { "index.ts": `${header}\n${text}` }, ...extra,
  });
  assert.equal(result.diagnostics.length, 0,
    `recursive Promise control: ${JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message })))}`);
  return result;
}

test("native body layout exhausts its canonical work and row budgets without publishing a partial cut", () => {
  let context;
  compile(`
async function recursive(count: int32, pending: Promise<void>): Promise<int32> {
  if (count <= 0) { await pending; return 0; }
  return await recursive(count - 1, pending);
}
export { recursive };`, { compileTarget(request) {
    context = analyzeRustCheckedContext(request);
    return { kind: "resolved", value: { artifacts: [] }, diagnostics: context.diagnostics };
  } });
  for (const [name, limits] of [
    ["work", { maximumSteps: 1 }],
    ["rows", { maximumTransportRows: 1 }],
  ]) {
    const budget = createSourceStorageBudget({ ...defaultSourceStorageLimits, ...limits });
    const selected = selectRustPromiseBodyRecursion(context, budget);
    assert.equal(selected.kind, "unresolved", `${name}: failure stays before publication`);
    assert.equal(selected.reason === budget.failure(), true, `${name}: the actual canonical budget owns the refusal`);
    assert.equal(Object.hasOwn(selected, "invocations"), false, `${name}: no partial feedback set escapes`);
  }
});

test("a closed lexical await cycle executes with no future, object or heap indirection", { timeout: 300_000 }, () => {
  const result = compile(`
async function main(): Promise<void> {
  async function left(count: int32): Promise<int32> { return count <= 0 ? 0 : 1 + await right(count - 1); }
  async function right(count: int32): Promise<int32> { return count <= 0 ? 0 : 1 + await left(count - 1); }
  if (await left(4) !== 4) throw new Error("closed lexical recursion");
}
await main();`);
  const rust = rustSourceText(result);
  assert.equal(rust.includes("Box::pin") || rust.includes("from_fallible_factory") || rust.includes("from_infallible_factory"), false,
    "settled lexical recursion allocates neither future indirection nor Promise tasks");
  assert.equal(validateGeneratedProject("promise-recursion-settled", result.artifacts, { run: true }).status, 0,
    "the actual closed lexical cycle computes its result");
});

test("a suspending self edge is pinned once while acyclic native calls stay unboxed", { timeout: 300_000 }, () => {
  const result = compile(`
async function leaf(value: int32, pending: Promise<void>): Promise<int32> { await pending; return value; }
async function recursive(count: int32, pending: Promise<void>): Promise<int32> {
  if (count <= 0) return await leaf(0, pending);
  return 1 + await recursive(count - 1, pending);
}
async function main(): Promise<void> {
  if (await recursive(3, Promise.resolve(undefined)) !== 3) throw new Error("suspending self recursion");
  if (await leaf(7, Promise.resolve(undefined)) !== 7) throw new Error("acyclic native result");
}
await main();`);
  const rust = rustSourceText(result);
  assert.equal(validateGeneratedProject("promise-recursion-self", result.artifacts, { run: true }).status, 0,
    "the recursive future and unboxed native controls compile and execute");
  assert.equal((rust.match(/Box::pin\(/gu) ?? []).length, 1, "only the single actual recursive future-layout edge is boxed");
});

test("every back-edge call site in a suspending cycle has indirection", { timeout: 300_000 }, () => {
  const result = compile(`
async function left(count: int32, pending: Promise<void>): Promise<int32> {
  if (count <= 0) { await pending; return 0; }
  return 1 + await right(count - 1, pending);
}
async function right(count: int32, pending: Promise<void>): Promise<int32> {
  if (count <= 0) { await pending; return 0; }
  if (count === 1) return 1 + await left(0, pending);
  return 1 + await left(count - 1, pending);
}
async function main(): Promise<void> {
  if (await left(4, Promise.resolve(undefined)) !== 4) throw new Error("mutual recursion");
}
await main();`);
  const rust = rustSourceText(result);
  assert.equal(validateGeneratedProject("promise-recursion-mutual", result.artifacts, { run: true }).status, 0,
    "both recursive layouts are finite and compute the native result");
  assert.equal((rust.match(/Box::pin\(/gu) ?? []).length, 2, "both source call sites on the selected DFS back edge are pinned");
});

test("a settled cross-component callee retains its public Promise and its caller's native await", { timeout: 300_000 }, () => {
  const files = {
    "index.ts": `${header}
import { read } from "@acme/read";
async function main(): Promise<void> { if (await read(7) !== 7) throw new Error("public object result"); }
await main();`,
    "node_modules/@acme/read/package.json": JSON.stringify({ name: "@acme/read", version: "1.0.0", type: "module", exports: { ".": "./index.ts" } }),
    "node_modules/@acme/read/index.ts": `${header}
export async function read(value: int32): Promise<int32> { return value; }`,
  };
  const result = compile("", { files,
    sourcePackages: sourcePackageGraphFixture(["index.ts"], { "@acme/read": { files: ["index.ts"], dependencies: [] } }),
  });
  const rust = rustSourceText(result);
  assert.equal(/async fn main_native/u.test(rust), true, "the cross-component object call cannot make its native caller settled");
  assert.equal(validateGeneratedProject("promise-component-completion", result.artifacts, { run: true }).status, 0,
    "the public object ABI and native caller compile and execute together");
});
