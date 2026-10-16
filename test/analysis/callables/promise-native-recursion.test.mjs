import assert from "node:assert/strict";
import test from "node:test";
import { createSourceStorageBudget, defaultSourceStorageLimits } from "@tsonic/target-api/analysis";
import { compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { analyzeRustCheckedContext } from "../../helpers/rust-session/analysis-context.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { selectRustPromiseBodyRecursion } from "../../../dist/analysis/callables/promise-recursion.js";
import { rustDirectPromiseBodyCallee } from "../../../dist/analysis/callables/promise-bodies.js";
import { rustAwaitSelection } from "../../../dist/target-model/types/await.js";

const header = `import type { int32 } from "@tsonic/core/types.js";`;
const recursive = `${header}
async function count(value: int32, pending: Promise<void>): Promise<int32> {
  if (value > 0) return await count(value - 1, pending);
  await pending;
  return 1;
}
export const marker = 0;`;

function checked(source = recursive) {
  let context;
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": source }, compileTarget(request) {
    context = analyzeRustCheckedContext(request);
    return { kind: "resolved", value: { artifacts: [] }, diagnostics: context.diagnostics };
  } });
  assert.equal(result.diagnostics.length, 0, "the native layout control has checked source evidence");
  const call = context.sourceStorage.nodes.find(node =>
    context.records.targetOperation.get(node)?.kind === "source-call" &&
    context.records.targetOperation.get(node).asyncBody?.maySuspend === true);
  assert.equal(call !== undefined, true, "the checked source contains its actual suspending native edge");
  return { context, call, operation: context.records.targetOperation.get(call) };
}

function invariant(run, node, message) {
  assert.throws(run, error => error instanceof Error &&
    error.diagnostic?.code === "TSONIC_INTERNAL_ANALYSIS_INVARIANT" &&
    error.diagnostic.sourceNode === node && error.message.includes(message),
  "a contradictory compiler-owned physical layout is not a source rejection");
}

test("native recursion closes only its physical back edge and reports budget exhaustion without a partial layout", () => {
  const { context, call, operation } = checked();
  const budget = createSourceStorageBudget(defaultSourceStorageLimits);
  const selected = selectRustPromiseBodyRecursion(context, budget);
  assert.equal(selected.kind, "resolved", "the finite source layout is closed");
  const sets = selected.invocations.get(operation.asyncBody.declaration);
  assert.equal(sets?.size === 1 && [...sets.values()][0].has(call), true,
    "the exact physical recursive call, not its declaration or an unrelated invocation, is pinned");
  const exhausted = selectRustPromiseBodyRecursion(context,
    createSourceStorageBudget({ ...defaultSourceStorageLimits, maximumSteps: 1 }));
  assert.equal(exhausted.kind === "unresolved" && exhausted.reason.includes("budget") &&
    exhausted.invocations === undefined, true, "an exhausted budget publishes neither bottom nor a partial body layout");
});

test("missing specialized names and missing or competing physical bodies are analysis invariants", () => {
  const { context, call, operation } = checked();
  const declaration = operation.asyncBody.declaration;
  const specialized = variants => ({ ...context, sourceCallableSpecializations: {
    ...context.sourceCallableSpecializations,
    requiresSpecialization: candidate => candidate === declaration,
    variantsForCallable: candidate => candidate === declaration ? variants : [],
  } });
  const variant = { sourceTypeParameterIdentities: [], targetTypeArguments: [], nativeBodyName: "count_variant_native" };
  invariant(() => selectRustPromiseBodyRecursion(specialized([{ ...variant, nativeBodyName: undefined }]),
    createSourceStorageBudget(defaultSourceStorageLimits)), declaration, "physical name");
  invariant(() => selectRustPromiseBodyRecursion(specialized([]),
    createSourceStorageBudget(defaultSourceStorageLimits)), call, "selected physical specialization");
  invariant(() => selectRustPromiseBodyRecursion(specialized([variant, { ...variant, nativeBodyName: "count_other_native" }]),
    createSourceStorageBudget(defaultSourceStorageLimits)), call, "competing physical specializations");
  const missing = { ...context, records: { ...context.records,
    asyncFunction: { get: node => node === declaration ? undefined : context.records.asyncFunction.get(node) },
  } };
  invariant(() => selectRustPromiseBodyRecursion(missing,
    createSourceStorageBudget(defaultSourceStorageLimits)), call, "complete physical body set");
});

test("the native edge owner distinguishes rejected component evidence from a contradictory completed identity", () => {
  const { context, call, operation } = checked();
  const declaration = operation.asyncBody.declaration;
  const unresolved = { ...context, sourcePackageComponentIdentities: { kind: "rejected", diagnostics: [] } };
  assert.equal(rustDirectPromiseBodyCallee(unresolved, call, operation.asyncBody.logicalResultCarrier) === undefined, true,
    "an already rejected source-package index does not invent a native edge or internal failure");
  const missing = { ...context, sourcePackageComponentIdentities: { kind: "resolved",
    identities: { ...context.sourcePackageComponentIdentities.identities, componentIdForFile: () => undefined },
  } };
  invariant(() => rustDirectPromiseBodyCallee(missing, call, operation.asyncBody.logicalResultCarrier), call,
    "validated source-package component identities");
  assert.equal(rustDirectPromiseBodyCallee(context, call, operation.asyncBody.logicalResultCarrier) === declaration, true,
    "the unchanged complete component index still admits the exact checked recursive call");
});

function native(name, source) {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `${header}\n${source}` },
    target: { id: "rust", options: { outputType: "bin", crateName: "promise_native_recursion" } },
  });
  assert.equal(result.diagnostics.length, 0,
    `${name}: ${JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message })))}`);
  assert.equal(validateGeneratedProject(name, result.artifacts, { run: true }).status, 0,
    `${name}: the exact method, static and recursive ABI builds, lints and executes`);
  return rustSourceText(result);
}

test("ordinary generic object-method returns stay native payloads, without proving a generic await", { timeout: 300_000 }, () => {
  const rust = native("promise-generic-object-method-payload", `
function make<Value>(value: Value): { read(): Promise<Value> } {
  return { async read(): Promise<Value> { return value; } };
}
async function main(): Promise<void> {
  const first = make<int32>(7);
  const second = make<string>("exact");
  if (await first.read() !== 7 || await second.read() !== "exact") throw new Error("generic method payload");
}
await main();`);
  assert.equal(rust.includes("from_fallible_factory") || rust.includes("from_infallible_factory"), false,
    "a body that only returns its generic native value creates no pending factory");
  assert.equal(rustAwaitSelection({ kind: "type-parameter", identity: "control:Value", name: "Value" }), undefined,
    "ordinary generic value completion does not establish an awaitable or owned native contract");
});

test("a generic JS async return keeps ordinary values and actual Promise adoption coherent", { timeout: 300_000 }, () => {
  native("promise-generic-actual-adoption", `
async function identity<Value>(value: Value) { return value; }
async function main(): Promise<void> {
  const ordinary: int32 = 7;
  const other: int32 = 9;
  const promised = Promise.resolve(other);
  if (await identity(ordinary) !== 7 || await identity(promised) !== 9) throw new Error("generic adoption");
}
await main();`);
});

test("a public generic JS Promise result preserves actual adoption when stored before await", { timeout: 300_000 }, () => {
  native("promise-generic-stored-adoption", `
export async function identity<Value>(value: Value) { return value; }
async function main(): Promise<void> {
  const ordinary: int32 = 7;
  const other: int32 = 9;
  const first = identity(ordinary);
  const second = identity(Promise.resolve(other));
  if (await first !== 7 || await second !== 9) throw new Error("stored generic adoption");
}
await main();`);
});

test("a generic structural JS method preserves a Promise-valued captured payload", { timeout: 300_000 }, () => {
  native("promise-generic-method-adoption", `
function make<Value>(value: Value): { read(): Promise<Value> } {
  return { async read(): Promise<Value> { return value; } };
}
async function main(): Promise<void> {
  const ordinary: int32 = 7;
  const api = make(Promise.resolve(ordinary));
  if (await api.read() !== 7) throw new Error("generic captured Promise adoption");
}
await main();`);
});

test("recursive suspending instance and static methods retain their own native body names", { timeout: 300_000 }, () => {
  const rust = native("promise-recursive-method-static", `
class Work {
  async count(value: int32, pending: Promise<void>): Promise<int32> {
    if (value > 0) return await this.count(value - 1, pending);
    await pending;
    return 3;
  }
  static async count(value: int32, pending: Promise<void>): Promise<int32> {
    if (value > 0) return await Work.count(value - 1, pending);
    await pending;
    return 5;
  }
}
async function main(): Promise<void> {
  const work = new Work();
  if (await work.count(3, Promise.resolve(undefined)) !== 3 ||
      await Work.count(4, Promise.resolve(undefined)) !== 5) throw new Error("recursive method/static");
}
await main();`);
  assert.equal((rust.match(/Box::pin\(/gu) ?? []).length, 2,
    "exactly one recursive layout edge is boxed per physical method, never the root call");
  assert.equal(rust.includes(".count_native("), true, "the instance call uses its selected native method name");
});

test("finite specialized instance and static methods call the same physical variant that defines their body", { timeout: 300_000 }, () => {
  const rust = native("promise-specialized-method-static", `
abstract class Contract { abstract accept<Value>(value: Value): boolean; }
class Identity extends Contract { override accept<Value>(_value: Value): boolean { return true; } }
class Work {
  async accept<Value>(owner: Contract, value: Value, pending: Promise<void>): Promise<boolean> {
    await pending;
    return owner.accept(value);
  }
  static async accept<Value>(owner: Contract, value: Value, pending: Promise<void>): Promise<boolean> {
    await pending;
    return owner.accept(value);
  }
}
async function main(): Promise<void> {
  const owner = new Identity();
  const work = new Work();
  if (!await work.accept(owner, 7, Promise.resolve(undefined)) ||
      !await work.accept(owner, "instance", Promise.resolve(undefined)) ||
      !await Work.accept(owner, 9, Promise.resolve(undefined)) ||
      !await Work.accept(owner, "static", Promise.resolve(undefined))) throw new Error("specialized method/static");
}
await main();`);
  const names = [...rust.matchAll(/fn ([A-Za-z0-9_]*accept[A-Za-z0-9_]*_native)(?:<|\()/gu)].map(match => match[1]);
  assert.equal(names.length, 4, "two native variants exist for each of the instance and static method");
  assert.equal(new Set(names).size, 4, "instance/static and each finite specialization have distinct physical names");
  for (const name of names) assert.equal([...rust.matchAll(new RegExp(`\\b${name}\\b`, "gu"))].length, 2,
    `${name}: exactly one native definition and its selected concrete invocation`);
});
