import assert from "node:assert/strict";
import test from "node:test";
import { createSourceStorageBudget, defaultSourceStorageLimits } from "@tsonic/target-api/analysis";
import { compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { analyzeRustCheckedContext } from "../../helpers/rust-session-analysis-context.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { selectRustPromiseBodyRecursion } from "../../../dist/analysis/callables/async/promise-recursion.js";
import { rustDirectPromiseBodyCallee } from "../../../dist/analysis/callables/async/promise-bodies.js";
import { rustAwaitSelection } from "../../../dist/policy/operations/flow/await.js";
import { assertRejectedAsyncSource } from "../../helpers/native-promise-lifetimes.mjs";

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

// PORT-MAP row 624 (analysis/names/plan.ts; RULINGS 2026-10-22): authored values keep their spelling and native E0592
// collisions reject before sealing. A static and an instance method with one name share one Rust inherent item name, so
// such a source is refused on the static member rather than renamed.
function refusedCollision(source, member) {
  const { result, source: checked } = compileRust({ surfaces: ["js"], files: { "index.ts": `${header}\n${source}` },
    target: { id: "rust", options: { outputType: "bin", crateName: "promise_native_recursion" } },
  });
  assert.deepEqual(result.artifacts, []);
  assert.deepEqual(result.diagnostics.map(row => [row.code, row.message]), [["RUST_AUTHORED_IDENTIFIER_UNREPRESENTABLE",
    `Authored static and instance methods '${member}' require the same Rust inherent item name (E0592); their spelling cannot be changed.`]]);
  const [diagnostic] = result.diagnostics;
  assert.equal(checked.ast.kindName(diagnostic.sourceNode), "KindMethodDeclaration");
  assert.equal(checked.ast.hasModifierKind(diagnostic.sourceNode, "static"), true);
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

function rejectedAdoption(source, call) {
  const compilation = compileRust({ surfaces: ["js"], files: { "index.ts": `${header}\n${source}` },
    target: { id: "rust", options: { outputType: "bin", crateName: "promise_native_recursion" } } });
  assertRejectedAsyncSource(compilation, [{ code: "TSONIC_GENERIC_ASYNC_ADOPTION_UNSUPPORTED",
    kind: "KindCallExpression", text: call }]);
}

test("a generic JS async return keeps ordinary values and refuses the frozen actual Promise adoption", () => {
  rejectedAdoption(`
async function identity<Value>(value: Value) { return value; }
async function main(): Promise<void> {
  const ordinary: int32 = 7;
  const other: int32 = 9;
  const promised = Promise.resolve(other);
  if (await identity(ordinary) !== 7 || await identity(promised) !== 9) throw new Error("generic adoption");
}
await main();`, "identity(promised)");
});

test("a public generic JS Promise refuses frozen actual adoption before stored await", () => {
  rejectedAdoption(`
export async function identity<Value>(value: Value) { return value; }
async function main(): Promise<void> {
  const ordinary: int32 = 7;
  const other: int32 = 9;
  const first = identity(ordinary);
  const second = identity(Promise.resolve(other));
  if (await first !== 7 || await second !== 9) throw new Error("stored generic adoption");
}
await main();`, "identity(Promise.resolve(other))");
});

test("a generic structural JS method refuses a frozen Promise-valued captured payload", () => {
  rejectedAdoption(`
function make<Value>(value: Value): { read(): Promise<Value> } {
  return { async read(): Promise<Value> { return value; } };
}
async function main(): Promise<void> {
  const ordinary: int32 = 7;
  const api = make(Promise.resolve(ordinary));
  if (await api.read() !== 7) throw new Error("generic captured Promise adoption");
}
await main();`, "make(Promise.resolve(ordinary))");
});

for (const exported of [false, true]) {
  test(`ordinary generic JS payloads remain native-executed with public=${exported}`, { timeout: 300_000 }, () => {
    native(`promise-generic-ordinary-${exported}`, `
${exported ? "export " : ""}async function identity<Value>(value: Value) { return value; }
async function main(): Promise<void> {
  const ordinary: int32 = 7;
  const selected = identity(ordinary);
  if (await selected !== 7) throw new Error("ordinary generic payload");
}
await main();`);
  });
}

test("an ordinary captured generic method keeps its original native result", { timeout: 300_000 }, () => {
  native("promise-generic-method-ordinary", `
function make<Value>(value: Value): { read(): Promise<Value> } {
  return { async read(): Promise<Value> { return value; } };
}
async function main(): Promise<void> {
  const ordinary: int32 = 7;
  const api = make(ordinary);
  if (await api.read() !== 7) throw new Error("ordinary generic method payload");
}
await main();`);
});

test("recursive suspending instance and static methods with one name are refused before sealing", { timeout: 300_000 }, () => {
  refusedCollision(`
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
await main();`, "count");
});

test("finite specialized instance and static methods with one name are refused before sealing", { timeout: 300_000 }, () => {
  refusedCollision(`
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
await main();`, "accept");
});
