import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { assertRejectedAsyncSource } from "../../helpers/native-promise-lifetimes.mjs";

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
  ["bound-structural-method", `
function make<Value>(value: Value): { read(): Value } { return { read(): Value { return value; } }; }
async function keep<Actual>(api: { read(): Actual }, pending: Promise<void>): Promise<Actual> {
  await pending; return api.read();
}
async function run(): Promise<boolean> {
  const original = make(7); const alias = original;
  const stored = keep(alias, Promise.resolve(undefined));
  return await stored === 7;
}`],
  ["spread-structural-method", `
function make(value: number): { read(): number } { return { read(): number { return value; } }; }
async function keep(api: { read(): number }, pending: Promise<void>): Promise<number> {
  await pending; return api.read();
}
async function run(): Promise<boolean> {
  const original = make(7); const copied = { ...original };
  const stored = keep(copied, Promise.resolve(undefined));
  return await stored === 7;
}`],
  ["nested-structural-method", `
function make(value: number): { read(): number } { return { read(): number { return value; } }; }
async function keep(api: { inner: { read(): number } }, pending: Promise<void>): Promise<number> {
  await pending; return api.inner.read();
}
async function run(): Promise<boolean> {
  const stored = keep({ inner: make(7) }, Promise.resolve(undefined));
  return await stored === 7;
}`],
  ["array-structural-method", `
function make(value: number): { read(): number } { return { read(): number { return value; } }; }
async function keep(api: { read(): number }[], pending: Promise<void>): Promise<number> {
  await pending; return api[0].read();
}
async function run(): Promise<boolean> {
  const stored = keep([make(7)], Promise.resolve(undefined));
  return await stored === 7;
}`],
  ["tuple-structural-method", `
function make(value: number): { read(): number } { return { read(): number { return value; } }; }
async function keep(api: [{ read(): number }, number], pending: Promise<void>): Promise<number> {
  await pending; return api[0].read() + api[1];
}
async function run(): Promise<boolean> {
  const stored = keep([make(7), 3], Promise.resolve(undefined));
  return await stored === 10;
}`],
];

for (const [name, source] of cases) {
  test(`Rust native Promise retention preserves ${name}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: name === "immediate-native-borrow" ? [] : ["js"],
      target: { id: "rust", options: { outputType: "bin", crateName: "promise_result_retention" } },
      files: { "index.ts": `export {};\n${source}
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
  const compilation = compileRust({ surfaces: ["js"], files: { "index.ts": `
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
  assertRejectedAsyncSource(compilation, [0, 1].flatMap(occurrence => [
    { code: "TSONIC_BORROWED_ASYNC_RESULT_ESCAPES", kind: "KindCallExpression", text: "keep(value, pending)", occurrence },
    { code: "RUST_ASYNC_PROMISE_STORAGE_LIFETIME_NOT_PROVEN", kind: "KindCallExpression", text: "keep(value, pending)", occurrence },
  ]));
});

test("a settled JS Promise preserves its exact native borrowed payload inside its owner", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "lib" } }, files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load, ref } from "@tsonic/rust/lang.js";
export async function view<Region extends Life>(value: Ref<int32, Region>): Promise<Ref<int32, Region>> { return value; }
export async function run(): Promise<int32> {
  const value = 17 as int32;
  const borrowed = await view(ref(value));
  return load(borrowed);
}
` } });
  assert.equal(result.diagnostics.length, 0, "a settled borrowed payload is representable, not a pending static factory");
  const output = result.artifacts.find(artifact => artifact.path === "src/index.rs")?.text;
  assert.equal(typeof output, "string", "native scoped view code is emitted");
  assert.equal(/-> js_abi::JsPromise<&'[A-Za-z_][A-Za-z_0-9]* i32>/u.test(output), true,
    "the Promise stores the actual native reference, not an owned copy or fictitious Promise lifetime");
  assert.equal(/\.clone\(|from_\w+_factory/u.test(output), false,
    "the exact settled view needs neither cloning nor a pending owner");
  const directory = writeGeneratedProject("promise-settled-native-view", result.artifacts);
  appendFileSync(join(directory, "src/index.rs"), `
#[cfg(test)]
mod scoped_native_view {
    use super::*;
    use tsonic_rust_runtime as rt;

    #[test]
    fn settled_reference_and_immediate_source_await_keep_identity() {
        let value = 17;
        let pending = view(&value);
        let borrowed = rt::block_on(pending.into_result()).unwrap();
        assert!(core::ptr::eq(borrowed, &value));
        assert_eq!(*borrowed, 17);
        assert_eq!(rt::block_on(run().into_result()).unwrap(), 17);
    }
}
`);
  runCargo(directory, ["generate-lockfile", "--offline"]);
  runCargo(directory, ["fmt", "--all"]);
  runCargo(directory, ["fmt", "--all", "--check"]);
  runCargo(directory, ["check", "--all-targets", "--locked", "--offline"]);
  runCargo(directory, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(directory, ["test", "--locked", "--offline", "--", "--test-threads=1"]);
});

const borrowedHeader = `import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load } from "@tsonic/rust/lang.js";`;
const pendingRead = `async function read<Region extends Life>(value: Ref<int32, Region>, pending: Promise<void>): Promise<int32> {
  await pending;
  return load(value);
}`;

for (const [name, source, calls] of [
  ["discarded", `${pendingRead}
export function escape<Region extends Life>(value: Ref<int32, Region>, previous: Promise<void>): void {
  read(value, previous);
}`, ["read(value, previous)"]],
  ["returned", `${pendingRead}
export function escape<Region extends Life>(value: Ref<int32, Region>, previous: Promise<void>): Promise<int32> {
  return read(value, previous);
}`, ["read(value, previous)"]],
  ["adopted-and-stored", `${pendingRead}
async function adopt<Region extends Life>(value: Ref<int32, Region>, previous: Promise<void>): Promise<int32> {
  return read(value, previous);
}
export function escape<Region extends Life>(value: Ref<int32, Region>, previous: Promise<void>): () => Promise<int32> {
  const pending = adopt(value, previous);
  return async () => await pending;
}`, ["read(value, previous)", "adopt(value, previous)"]],
]) {
  test(`a ${name} JS pending result cannot extend its actual native input lease`, () => {
    const compilation = compileRust({ surfaces: ["js"], files: { "index.ts": `${borrowedHeader}\n${source}` } });
    assertRejectedAsyncSource(compilation, calls.flatMap(text => [
      { code: "TSONIC_BORROWED_ASYNC_RESULT_ESCAPES", kind: "KindCallExpression", text },
      { code: "RUST_ASYNC_PROMISE_STORAGE_LIFETIME_NOT_PROVEN", kind: "KindCallExpression", text },
    ]));
  });
}

const exposedPendingRead = `export ${pendingRead}`;
const immediatePendingRead = `export async function immediate<Region extends Life>(value: Ref<int32, Region>, previous: Promise<void>): Promise<int32> {
  return await read(value, previous);
}`;
const prefixPendingRead = `export async function read<Region extends Life>(value: Ref<int32, Region>, pending: Promise<void>): Promise<int32> {
  const copied = load(value);
  await pending;
  return copied;
}`;
const borrowedPayloadClosure = "async (): Promise<Ref<int32, Region>> => await pending";

for (const [name, source, failures] of [
  ["immediate-await-public-factory", `${exposedPendingRead}\n${immediatePendingRead}`, [
    { kind: "KindFunctionDeclaration", text: exposedPendingRead },
    { kind: "KindFunctionDeclaration", text: immediatePendingRead },
  ]],
  ["prefix-read-before-pending", prefixPendingRead, [
    { kind: "KindFunctionDeclaration", text: prefixPendingRead },
  ]],
  ["settled-borrowed-payload-in-escaping-closure", `
async function view<Region extends Life>(value: Ref<int32, Region>): Promise<Ref<int32, Region>> { return value; }
export function escape<Region extends Life>(value: Ref<int32, Region>): () => Promise<Ref<int32, Region>> {
  const pending = view(value);
  return ${borrowedPayloadClosure};
}`, [ { kind: "KindArrowFunction", text: borrowedPayloadClosure } ]],
]) {
  test(`JS ${name} is refused at its exact native factory boundary before publication`, () => {
    const compilation = compileRust({ surfaces: ["js"], files: { "index.ts": `${borrowedHeader}\n${source}` } });
    assertRejectedAsyncSource(compilation, failures.map(failure => ({ ...failure,
      code: "RUST_ASYNC_PROMISE_STORAGE_LIFETIME_NOT_PROVEN" })));
    assert.equal(compilation.result.diagnostics.every(issue =>
      issue.message === "A suspending JS Promise body cannot retain a borrowed value across a pending point; its task requires owned storage."),
    true, "the existing native factory refusal owns every source rejection, not a rustc failure");
  });
}
