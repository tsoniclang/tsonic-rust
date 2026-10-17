import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

const cases = [
  ["owned-capture", `
async function keep(value: number, pending: Promise<void>): Promise<number> {
  const read = () => value;
  await pending;
  return read();
}
async function run(): Promise<boolean> {
  const stored = keep(7, Promise.resolve(undefined));
  return await stored === 7;
}`],
  ["forward-native-callback", `
export function forward<Value>(callback: () => Promise<Value>): Promise<Value> { return callback(); }
export async function invoke<Value>(callback: () => Promise<Value>): Promise<Value> {
  return await forward(callback);
}
async function read(): Promise<number> { return 7; }
async function run(): Promise<boolean> { return await invoke(read) === 7; }`],
  ["optional-native-callback", `
function fail(): never { throw new Error("absent"); }
async function read(): Promise<number> { return 7; }
export async function call(callback: (() => Promise<number>) | undefined): Promise<number> {
  return await (callback ?? fail())();
}
async function run(): Promise<boolean> {
  if (await call(read) !== 7) return false;
  try { await call(undefined); return false; } catch { return true; }
}`],
  ["generic-stored-completion", `
export async function source<Value>(callback: () => Promise<Value>): Promise<Value> { return await callback(); }
export function retain<Other>(callback: () => Promise<Other>): Promise<Other> { return source(callback); }
export async function consumer<Actual>(callback: () => Promise<Actual>): Promise<Actual> {
  return await retain(callback);
}
async function read(): Promise<number> { return 7; }
async function run(): Promise<boolean> { return await consumer(read) === 7; }`],
  ["recursive-owned-completion", `
async function left(value: number, count: number, pending: Promise<void>): Promise<number> {
  if (count > 0) return await right(value, count - 1, pending);
  await pending; return value;
}
async function right(value: number, count: number, pending: Promise<void>): Promise<number> {
  if (count > 0) return await left(value, count - 1, pending);
  await pending; return value;
}
async function run(): Promise<boolean> {
  const stored = left(7, 3, Promise.resolve(undefined));
  return await stored === 7;
}`],
  ["class-native-completion", `
class Work {
  completion: Promise<void> = Promise.resolve(undefined);
  async wait(): Promise<void> { await this.completion; }
}
async function run(): Promise<boolean> { const work = new Work(); await work.wait(); return true; }`],
  ["exact-int64-native-callback", `
import type { int64 } from "@tsonic/core/types.js";
async function read(value: int64): Promise<int64> { return value; }
export async function invoke(callback: (value: int64) => Promise<int64>, value: int64): Promise<int64> {
  return await callback(value);
}
async function run(): Promise<boolean> {
  const value: int64 = 9007199254740993n;
  const stored = invoke(read, value);
  return await stored === value;
}`],
  ["immediate-native-borrow", `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load, ref } from "@tsonic/rust/lang.js";
async function keep<Region extends Life>(value: Ref<int32, Region>, pending: Promise<void>): Promise<int32> {
  await pending;
  return load(value);
}
async function run(): Promise<boolean> {
  const value = 7 as int32;
  return await keep(ref(value), Promise.resolve(undefined)) === 7;
}`],
];

for (const [name, source] of cases) {
  test(`Rust native Promise retention preserves ${name}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: ["js"],
      target: { id: "rust", options: { outputType: "bin", crateName: "promise_result_retention" } },
      files: { "index.ts": `${source}
async function main(): Promise<void> { if (!await run()) throw new Error("native Promise retention"); }
await main();` },
    });
    assert.equal(result.diagnostics.length, 0,
      JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message }))));
    assert.equal(result.program !== undefined, true, "native-admitted Promise/callback values remain publishable");
    assert.equal(result.program.promiseResults instanceof Map, true, "one result-use owner publishes the decisions");
    assert.equal(validateGeneratedProject(`promise-retention-${name}`, result.artifacts, { run: true }).status, 0,
      "the complete generated native program builds, lints and executes");
  });
}

test("native discarded results retain both actual failing call sites", () => {
  const { result } = compileRust({ files: { "index.ts": `
async function leaf(): Promise<number> { return 1; }
export function reject(): void { leaf(); leaf(); }
` } });
  assert.equal(result.diagnostics.length, 2, "two independent source demands survive the same admission window");
  assert.equal(result.diagnostics.every(issue => issue.code === "TSONIC_NATIVE_ASYNC_RESULT_DISCARDED"), true,
    "native observation uses the same shared rule on both targets");
  assert.equal(result.diagnostics[0].sourceNode !== undefined && result.diagnostics[1].sourceNode !== undefined &&
    result.diagnostics[0].sourceNode !== result.diagnostics[1].sourceNode, true, "each demand retains its actual checked call");
  assert.equal(result.program === undefined && result.artifacts.length === 0, true, "a rejected program is never published");
});

test("actual formal native leases preserve both escaping diagnostics despite the rejected object facet", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load } from "@tsonic/rust/lang.js";
async function keep<Region extends Life>(value: Ref<int32, Region>, pending: Promise<void>): Promise<int32> {
  await pending;
  return load(value);
}
async function escaped<Region extends Life>(value: Ref<int32, Region>, pending: Promise<void>): Promise<void> {
  keep(value, pending);
  const stored = keep(value, pending);
  await stored;
}
export const marker = 0;
` } });
  const leases = result.diagnostics.filter(issue => issue.code === "TSONIC_BORROWED_ASYNC_RESULT_ESCAPES");
  assert.equal(leases.length, 2, "both independently proven formal leases survive the native requirement rejection");
  assert.equal(leases[0].sourceNode !== undefined && leases[1].sourceNode !== undefined &&
    leases[0].sourceNode !== leases[1].sourceNode, true, "each escaping call retains its exact source identity");
  assert.equal(result.diagnostics.some(issue => issue.code === "RUST_ASYNC_PROMISE_STORAGE_LIFETIME_NOT_PROVEN"), true,
    "the native object's independent storage refusal is retained, not replaced by a source-only decision");
  assert.equal(result.program === undefined && result.artifacts.length === 0, true, "neither rejected facet is published");
});
