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
  return result.artifacts.map(artifact => artifact.text).join("\n");
}

test("module async arrows and generator expressions reuse declared-function lowering", { timeout: 300_000 }, () => {
  const source = compileAndRun("module_suspended_callables", `
export const increment = async (value: int32): Promise<int32> => value + 1;
export const values = function* (seed: int32): Generator<int32, int32, int32> {
  const received: int32 = yield seed;
  return received + 1;
};
export const asyncValues = async function* (seed: int32): AsyncGenerator<int32, int32, int32> {
  const received: int32 = yield await increment(seed);
  return received;
};
export async function main(): Promise<void> {
  check(await increment(2) === 3);
  const sequence = values(4);
  const first = sequence.next();
  check(!first.done && first.value === 4);
  const last = sequence.next(8);
  check(last.done === true && last.value === 9);
  const asynchronous = asyncValues(10);
  const initial = await asynchronous.next();
  check(!initial.done && initial.value === 11);
  const completed = await asynchronous.next(12);
  check(completed.done === true && completed.value === 12);
}
`);
  assert.match(source, /fn increment\(/u);
  assert.match(source, /fn values\(/u);
  assert.doesNotMatch(source, /increment[^\n]*ModuleCell/u);
});

test("escaping async callbacks retain captures and observe mutation across invocations", { timeout: 300_000 }, () => {
  const source = compileAndRun("owned_async_callable", `
async function pause(): Promise<void> {}
function counter(prefix: string): (step: int32) => Promise<string> {
  let total: int32 = 0;
  return async (step: int32): Promise<string> => {
    total += step;
    await pause();
    return prefix + total.toString();
  };
}
function pending(): Promise<string> {
  const action = counter("kept:");
  return action(7);
}
export async function main(): Promise<void> {
  const action = counter("value:");
  const alias = action;
  check(alias === action);
  check(await action(2) === "value:2");
  check(await alias(3) === "value:5");
  check(await pending() === "kept:7");
}
`);
  assert.match(source, /::from_shared\(/u);
  assert.match(source, /rt::CallableImplementation</u);
  assert.doesNotMatch(source, /callable_state[^\n]*\.state\.\d+\.clone\(\)[\s\S]{0,40}from_.*factory/u);
});

test("generator expressions retain their captures through next, return and finally", { timeout: 300_000 }, () => {
  compileAndRun("captured_generator_callable", `
function make(): (seed: int32) => Generator<int32, int32, int32> {
  let completed: int32 = 0;
  return function* (seed: int32): Generator<int32, int32, int32> {
    try {
      const received: int32 = yield seed + completed;
      return received;
    } finally {
      completed += 1;
    }
  };
}
export function main(): void {
  const values = make();
  const first = values(10);
  const yielded = first.next();
  check(!yielded.done && yielded.value === 10);
  const ended = first.return(30);
  check(ended.done === true && ended.value === 30);
  const second = values(10);
  const next = second.next();
  check(!next.done && next.value === 11);
  const completed = second.next(40);
  check(completed.done === true && completed.value === 40);
}
`);
});

test("suspended generic methods retain the exact receiver after the invoking scope ends", { timeout: 300_000 }, () => {
  compileAndRun("owned_suspended_receiver", `
class Box<Value> {
  value: Value;
  constructor(value: Value) { this.value = value; }
  async read(): Promise<Value> { return this.value; }
  *values(): Generator<Value, void, unknown> { yield this.value; }
  async *asyncValues(): AsyncGenerator<Value, void, unknown> { yield await this.read(); }
}
function pending<Value>(value: Value): Promise<Value> { return new Box(value).read(); }
function values<Value>(value: Value): Generator<Value, void, unknown> { return new Box(value).values(); }
function asyncValues<Value>(value: Value): AsyncGenerator<Value, void, unknown> { return new Box(value).asyncValues(); }
export async function main(): Promise<void> {
  check(await pending("kept") === "kept");
  check(await pending<int32>(7) === 7);
  const sequence = values("yielded");
  const first = sequence.next();
  check(!first.done && first.value === "yielded");
  check(sequence.next().done === true);
  const asynchronous = asyncValues<int32>(9);
  const next = await asynchronous.next();
  check(!next.done && next.value === 9);
  check((await asynchronous.next()).done === true);
}
`);
});

test("locally awaited receiver methods keep native value storage", { timeout: 300_000 }, () => {
  const generated = compileAndRun("local_suspended_receiver", `
class LocalValue {
  value: int32;
  constructor(value: int32) { this.value = value; }
  async read(): Promise<int32> { return this.value; }
}
export async function main(): Promise<void> {
  const value = new LocalValue(3);
  check(await value.read() === 3);
}
`);
  assert.doesNotMatch(generated, /(?:Rc|RefCell)<LocalValue/u);
  assert.doesNotMatch(generated, /(?:Rc|ObjectHandle)::new\(LocalValue/u);
});
