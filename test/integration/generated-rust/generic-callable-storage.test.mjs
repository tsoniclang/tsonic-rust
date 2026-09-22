import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

function compileAndRun(name, source) {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: name } },
    files: { "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";
${source}` },
  });
  assert.deepEqual(result.diagnostics, []);
  const native = validateGeneratedProject(name, result.artifacts, { run: true });
  assert.equal(native.status, 0, native.stdout + native.stderr);
  return result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
}

test("local quantified functions keep Copy environments inline and pure calls infallible", { timeout: 300_000 }, () => {
  const generated = compileAndRun("local_quantified_values", `
export function main(): void {
  const identity = <Value>(value: Value): Value => value;
  check(identity<int32>(7) === 7);
  check(identity<string>("native") === "native");
}
`);
  assert.match(generated, /impl Copy for GenericCallable/u);
  assert.doesNotMatch(generated, /Rc<[^\n]*CallableEnvironment/u);
  assert.doesNotMatch(generated, /fn call<[^}]*?-> Result/u);
  assert.doesNotMatch(generated, /GenericCallable[^\n]*::[^\n]*Rc::new/u);
});

test("escaping quantified functions share exactly their mutable environment and identity", { timeout: 300_000 }, () => {
  const generated = compileAndRun("shared_quantified_values", `
function make(): <Value>(value: Value) => Value {
  let count: int32 = 0;
  return <Value>(value: Value): Value => {
    count += 1;
    if (count === 3) throw new Error("third");
    return value;
  };
}
export function main(): void {
  const first = make();
  const alias = first;
  const other = make();
  check(first === alias && first !== other);
  check(first<int32>(2) === 2);
  check(alias<string>("second") === "second");
  let failed = false;
  try { alias<int32>(4); } catch { failed = true; }
  check(failed);
  check(other<int32>(5) === 5);
}
`);
  assert.match(generated, /Rc<[^\n]*CallableEnvironment/u);
  assert.match(generated, /fn call<[^}]*?-> Result/u);
  assert.doesNotMatch(generated, /Rc<[^\n]*(?:GenericCallable|CallableAlternatives)/u);
});

test("quantified async callbacks retain one environment while pending work outlives the callable", { timeout: 300_000 }, () => {
  const generated = compileAndRun("suspended_quantified_values", `
function make(): <Value>(value: Value) => Promise<Value> {
  let count: int32 = 0;
  return async <Value>(value: Value): Promise<Value> => {
    count += 1;
    await Promise.resolve();
    if (count === 3) throw new Error("third");
    return value;
  };
}
function pending(): Promise<string> {
  const action = make();
  return action<string>("alive");
}
export async function main(): Promise<void> {
  const action = make();
  const alias = action;
  check(action === alias);
  check(await action<int32>(7) === 7);
  check(await alias<string>("second") === "second");
  let failed = false;
  try { await action<int32>(3); } catch { failed = true; }
  check(failed);
  check(await pending() === "alive");
}
`);
  assert.match(generated, /Rc<[^\n]*CallableEnvironment/u);
  assert.doesNotMatch(generated, /fn call<[^}]*?-> Result/u);
});

test("a synchronous quantified Promise factory preserves separate invocation and awaiting failures", { timeout: 300_000 }, () => {
  compileAndRun("quantified_promise_effects", `
function make(rejectNow: boolean): <Value>(value: Value) => Promise<Value> {
  return <Value>(value: Value): Promise<Value> => {
    if (rejectNow) throw new Error("invocation");
    return Promise.resolve(value);
  };
}
export async function main(): Promise<void> {
  const valid = make(false);
  check(await valid<int32>(4) === 4);
  const invalid = make(true);
  let failed = false;
  try { invalid<string>("not reached"); } catch { failed = true; }
  check(failed);
}
`);
});
