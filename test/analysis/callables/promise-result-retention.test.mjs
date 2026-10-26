import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeRust, boolCarrier, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { assertRejectedAsyncSource } from "../../helpers/native-promise-lifetimes.mjs";
import { analyzeRustCheckedContext } from "../../helpers/rust-session-analysis-context.mjs";
import { analyzeRustPromiseResults, analyzeRustPromiseResultUses } from "../../../dist/analysis/callables/promise-results.js";
import { rustAwaitSelectionLeaves } from "../../../dist/target-model/types/await.js";
import { rustAwaitSelection } from "../../../dist/policy/operations/flow/await.js";
import { rustJsPromiseTargetType } from "../../../dist/target-model/types/carriers/promises.js";
import { rustCallableProtocol, rustStructuralMethodCallableCarrier } from "../../../dist/target-model/types/carriers/callables.js";
import { rustOptionElementCarrier } from "../../../dist/target-model/types/carriers/optional.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

for (const [name, expected] of [
  ["contradictory projected source carrier", /identical selected source carrier before projection/u],
  ["unresolved final generic read contract", /actual completed final contract/u],
]) {
  test(`native retention rejects ${name} before owning-origin fallback`, () => {
    let reachedRead = false;
    let originQueriesAfterRead = 0;
    let selected;
    const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
      async function hold<Value>(value: Value, completion: Promise<void>): Promise<Value> {
        await completion;
        return value;
      }
      await hold(7, Promise.resolve(undefined));
    ` }, compileTarget(request) {
      const context = analyzeRustCheckedContext(request);
      assert.equal(context.diagnostics.length, 0, `the original source has an actual checked native context: ${JSON.stringify(
        context.diagnostics.map(({ code, message }) => ({ code, message })))}`);
      const reference = context.nativeNodes.find(node => context.ast.is.IsIdentifier(node) &&
        context.ast.text(node) === "value" && context.ast.is.IsReturnStatement(context.ast.parent(node)));
      const call = context.nativeNodes.find(node => context.ast.is.IsCallExpression(node) &&
        context.source.semantics.forNode(node).operations.call(node)?.sourceArguments.some(argument =>
          context.ast.kindName(argument.expression) === "KindNumericLiteral"));
      assert.equal(reference !== undefined && call !== undefined, true, "exact original read and invocation identities");
      const carrier = context.records.runtimeCarrier.get(reference)?.carrier;
      assert.equal(carrier?.kind, "type-parameter", "the actual checked generic read has its selected native parameter");
      const readSubject = context.sourceStorage.subjectFor(reference);
      assert.equal(readSubject.kind, "resolved", "the checked reference has its canonical storage subject");
      const callRecord = context.records.runtimeCarrier.get(call);
      const completion = rustAwaitSelection(callRecord?.carrier, context.typeDefinitions);
      assert.equal(completion !== undefined, true, "the actual selected call has its native completion carrier");
      const leaves = rustAwaitSelectionLeaves(completion);
      assert.equal(leaves.length === 1 && leaves[0].future !== undefined, true, "one exact native completion, without guessed output");
      const facade = { ...callRecord, carrier: rustJsPromiseTargetType(leaves[0].future.outputCarrier) };
      const storage = { ...context.sourceStorage, storageProducersFor(value, bindings) {
        if (reachedRead && value === readSubject.subject) originQueriesAfterRead += 1;
        return context.sourceStorage.storageProducersFor(value, bindings);
      } };
      const records = { ...context.records, runtimeCarrier: { get(node) {
        return node === call ? facade : context.records.runtimeCarrier.get(node);
      } }, flowReadProjection: { get(node) {
        if (node === reference && name === "contradictory projected source carrier")
          return { sourceCarrier: boolCarrier, selectedCarrier: carrier };
        return context.records.flowReadProjection.get(node);
      } } };
      selected = analyzeRustPromiseResults({
        ast: context.ast, source: context.source, genericAdoption: [], storage, nodes: [call], records,
        readFor(node) {
          if (node !== reference) return undefined;
          reachedRead = true;
          return { kind: "selected", carrier, value: { kind: "move" } };
        },
        uses: analyzeRustPromiseResultUses(context.ast, [call]), definitions: context.typeDefinitions,
        nativeStorage: context.callableValues.nativeStorage, native: context.callableValues.native,
        promiseBodies: context.promiseBodies.plan, nativeCaptures: undefined, errorTypes: undefined,
        sourceTypes: { structuralObjectForCarrier() { assert.fail("an unresolved read cannot inspect structural captures"); } },
        sourceLifetimes: context.sourceLifetimes, requirements: { kind: "resolved", index: { contractFor: () => undefined } },
        nativeStorageValidated: true, families: context.typeFamilies, evidence: {}, jsEnabled: true,
      });
      return { kind: "resolved", value: { artifacts: [] }, diagnostics: selected.diagnostics };
    } });
    assert.equal(reachedRead, true, `the production native adapter inspected the exact checked reference: ${JSON.stringify(
      selected?.diagnostics.map(({ code, message }) => ({ code, message })))}`);
    assert.equal(originQueriesAfterRead, 0, "invalid or unresolved read evidence never invokes the owning-origin fallback");
    assert.equal(selected.diagnostics.some(diagnostic => diagnostic.code === "RUST_ASYNC_RESULT_USE_NOT_PROVEN" &&
      expected.test(diagnostic.message)), true, `the original native read refusal is preserved at its owner: ${JSON.stringify(
        selected.diagnostics.map(({ code, message }) => ({ code, message })))}`);
    assert.equal(result.artifacts.length, 0, "the refused source publishes no artifacts");
  });
}

const cases = [
  ["qualified-owned-field-read", `
import type { int64 } from "@tsonic/core/types.js";
class Counter {
  constructor(public total: int64) {}
  async read(pending: Promise<void>): Promise<int64> {
    await pending;
    return this.total;
  }
}
async function run(): Promise<boolean> {
  const value: int64 = 9007199254740993n;
  const owner = new Counter(value);
  const pending = owner.read(Promise.resolve(undefined));
  return await pending === value && owner.total === value;
}`],
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
  ["changed-layout-structural-method", `
function make(value: number): { read(): number } { return { read(): number { return value; } }; }
async function keep(api: { aaa: number; read(): number }, pending: Promise<void>): Promise<number> {
  await pending; return api.aaa + api.read();
}
async function run(): Promise<boolean> {
  const original = make(7); const copied = { aaa: 3, ...original };
  const stored = keep(copied, Promise.resolve(undefined));
  return await stored === 10;
}`],
  ["aliased-changed-layout-structural-method", `
function make<Value>(value: Value): { read(): Value } { return { read(): Value { return value; } }; }
async function keep(api: { aaa: number; read(): number }, pending: Promise<void>): Promise<number> {
  await pending; return api.aaa + api.read();
}
async function run(): Promise<boolean> {
  const original = make(7); const first = original; const alias = first;
  const copied = { aaa: 3, ...alias };
  const stored = keep(copied, Promise.resolve(undefined));
  return await stored === 10;
}`],
  ["repeated-changed-layout-structural-method", `
function make(value: number): { read(): number } { return { read(): number { return value; } }; }
async function keep(api: { aaa: number; bbb: number; read(): number }, pending: Promise<void>): Promise<number> {
  await pending; return api.aaa + api.bbb + api.read();
}
async function run(): Promise<boolean> {
  const original = make(7); const first = { aaa: 3, ...original }; const copied = { bbb: 5, ...first };
  const stored = keep(copied, Promise.resolve(undefined));
  return await stored === 15;
}`],
  ["multiple-changed-layout-structural-methods", `
function makeRead(value: number): { read(): number } { return { read(): number { return value; } }; }
function makeOther(value: number): { other(): number } { return { other(): number { return value; } }; }
async function keep(api: { aaa: number; read(): number; other(): number }, pending: Promise<void>): Promise<number> {
  await pending; return api.aaa + api.read() + api.other();
}
async function run(): Promise<boolean> {
  const original = makeRead(7); const other = makeOther(11); const copied = { aaa: 3, ...original, ...other };
  const stored = keep(copied, Promise.resolve(undefined));
  return await stored === 21;
}`],
  ["nested-generic-changed-layout-structural-method", `
function make<Value>(value: Value): { read(): Value } { return { read(): Value { return value; } }; }
function copy<Actual>(value: Actual) { const original = make(value); const alias = original; return { aaa: 3, ...alias }; }
async function keep(api: { inner: { aaa: number; read(): number } }, pending: Promise<void>): Promise<number> {
  await pending; return api.inner.aaa + api.inner.read();
}
async function run(): Promise<boolean> {
  const stored = keep({ inner: copy(7) }, Promise.resolve(undefined));
  return await stored === 10;
}`],
  ["immediate-borrowed-changed-layout-structural-method", `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load, ref } from "@tsonic/rust/lang.js";
function make<Region extends Life>(value: Ref<int32, Region>): { read(): int32 } {
  return { read(): int32 { return load(value); } };
}
async function keep(api: { aaa: number; read(): int32 }, pending: Promise<void>): Promise<int32> {
  await pending; return api.read();
}
async function run(): Promise<boolean> {
  const value = 7 as int32; const original = make(ref(value)); const copied = { aaa: 3, ...original };
  return await keep(copied, Promise.resolve(undefined)) === 7;
}`],
];

for (const [name, source] of cases.filter(([name]) => ["spread-structural-method", "nested-structural-method",
  "changed-layout-structural-method"].includes(name))) {
  test(`sealed native retention keeps captured source storage for ${name}`, () => {
    const { program } = analyzeRust({ surfaces: ["js"],
      target: { id: "rust", options: { outputType: "bin", crateName: "promise_result_retention" } },
      files: { "index.ts": `export {};\n${source}
async function main(): Promise<void> { if (!await run()) throw new Error("native Promise retention"); }
await main();` },
    });
    assert.equal(program.promiseResults instanceof Map, true, "the completed result-use owner publishes its decisions");
    const { ast } = program.source;
    const calls = [...program.promiseResults.keys()].filter(node => {
      const callee = ast.is.IsCallExpression(node) ? ast.as.AsCallExpression(node)?.Expression : undefined;
      return callee !== undefined && ast.is.IsIdentifier(callee) && ast.text(callee) === "keep";
    });
    assert.equal(calls.length, 1, "the exact native keep invocation has one source retention decision");
    assert.equal(program.promiseResults.get(calls[0])?.disposition.kind, "stored",
      "the actual stored native result retains its original use classification");
    for (const shape of program.structuralShapes.instances) for (const field of shape.fields) {
      if (field.methodPlan?.kind !== "stored") continue;
      const value = rustCallableProtocol(rustStructuralMethodCallableCarrier(field.carrier, field.presence));
      const selected = rustCallableProtocol(field.presence === "optional"
        ? rustOptionElementCarrier(field.methodPlan.carrier) : field.methodPlan.carrier);
      assert.equal(value !== undefined && selected !== undefined, true,
        `${name}/${shape.targetName}/${field.sourceName}: the selected native method has its exact field-value protocol`);
      const parameters = field.methodPlan.receiver === "included" ? selected.parameters.slice(1) : selected.parameters;
      assert.equal(parameters.length === value.parameters.length && parameters.every((parameter, index) =>
        rustTargetTypeRefEquals(parameter, value.parameters[index])), true,
      `${name}/${shape.targetName}/${field.sourceName}: only the selected included receiver is removed from the field-value signature`);
      assert.equal(rustTargetTypeRefEquals(value.result, selected.result) &&
        rustTargetTypeRefEquals(value.error, selected.error), true,
      `${name}/${shape.targetName}/${field.sourceName}: field accessors and stored methods share the exact native result/error channel`);
    }
  });
}

for (const [name, source] of cases) {
  test(`Rust native Promise retention preserves ${name}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: ["js"],
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

// RULINGS (2026-10-23): the native surface has no Promise.resolve, as at the checkpoint; a native-surface program using
// it is refused with one source diagnostic at the call and publishes nothing.
test("native surface refuses Promise.resolve at its call without a follow-on argument refusal", () => {
  const { result } = compileRust({ surfaces: [],
    target: { id: "rust", options: { outputType: "bin", crateName: "promise_result_retention" } },
    files: { "index.ts": `export {};
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
}
async function main(): Promise<void> { if (!await run()) throw new Error("native Promise retention"); }
await main();` },
  });
  assert.deepEqual(result.diagnostics.map(({ code }) => code), ["RUST_SELECTED_CALL_EVIDENCE_MISSING"]);
  assert.equal(result.diagnostics[0].sourceNode !== undefined, true, "the refusal names the Promise.resolve call");
  assert.equal(result.program === undefined && result.artifacts.length === 0, true, "a rejected program is never published");
});

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

test("forwarded formal native leases preserve both escaping diagnostics despite the rejected object facet", () => {
  const compilation = compileRust({ surfaces: ["js"], files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load } from "@tsonic/rust/lang.js";
async function keep<Region extends Life>(value: Ref<int32, Region>, pending: Promise<void>): Promise<int32> {
  await pending;
  return load(value);
}
async function forward<Region extends Life>(value: Ref<int32, Region>, pending: Promise<void>): Promise<int32> {
  return await keep(value, pending);
}
async function escaped<Region extends Life>(value: Ref<int32, Region>, pending: Promise<void>): Promise<void> {
  forward(value, pending);
  const stored = forward(value, pending);
  await stored;
}
export const marker = 0;
` } });
  assertRejectedAsyncSource(compilation, [0, 1].map(occurrence =>
    ({ code: "RUST_ASYNC_PROMISE_STORAGE_LIFETIME_NOT_PROVEN", kind: "KindCallExpression", text: "forward(value, pending)", occurrence })));
  for (const diagnostic of compilation.result.diagnostics)
    assert.equal(diagnostic.message, "A suspending JS Promise body cannot retain a borrowed value across a pending point; its task requires owned storage.",
      "each original outer call is refused with the complete measured native storage-lifetime reason");
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
  runCargo(directory, ["fmt"]);
  runCargo(directory, ["fmt", "--check"]);
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

test("changed-layout method transport cannot erase a real pending captured native lease", () => {
  const compilation = compileRust({ surfaces: ["js"], files: { "index.ts": `${borrowedHeader}
function make<Region extends Life>(value: Ref<int32, Region>): { read(): int32 } {
  return { read(): int32 { return load(value); } };
}
async function keep(api: { aaa: number; read(): int32 }, pending: Promise<void>): Promise<int32> {
  await pending; return api.read();
}
async function escaped<Region extends Life>(value: Ref<int32, Region>, pending: Promise<void>): Promise<void> {
  const original = make(value); const copied = { aaa: 3, ...original };
  keep(copied, pending);
  const stored = keep(copied, pending);
  await stored;
}
export const marker = 0;
` } });
  assertRejectedAsyncSource(compilation, [0, 1].flatMap(occurrence => [
    { code: "TSONIC_BORROWED_ASYNC_RESULT_ESCAPES", kind: "KindCallExpression", text: "keep(copied, pending)", occurrence },
    { code: "RUST_ASYNC_PROMISE_STORAGE_LIFETIME_NOT_PROVEN", kind: "KindCallExpression", text: "keep(copied, pending)", occurrence },
  ]));
});

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
