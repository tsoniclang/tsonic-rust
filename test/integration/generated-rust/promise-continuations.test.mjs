import test from "node:test";
import assert from "node:assert/strict";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("Promise executors and continuations preserve exact native values and adoption", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } }, files: {
    "index.ts": `
      import type { uint64 } from "@tsonic/core/types.js";
      async function next(value: number): Promise<number> { return value + 1; }
      async function fail(): Promise<number> { throw new Error("failure"); }
      export async function main(): Promise<void> {
        const wide: uint64 = 9007199254740993n;
        const value = await Promise.resolve(wide).then(value => value);
        const adopted = await Promise.resolve(2).then(value => next(value));
        const recovered = await fail().catch(reason => 7);
        const delayed = new Promise<number>((resolve, reject) => { resolve(4); reject(new Error("late")); });
        const fromExecutor = await delayed.then(value => value + 1);
        const done = new Promise<void>((resolve, reject) => {
          void Promise.resolve(5).then(value => { if (value === 5) resolve(); }, reason => reject(reason));
        });
        await done;
        if (value !== wide || adopted !== 3 || recovered !== 7 || fromExecutor !== 5) throw new Error("Promise completion");
      }
    `,
  } });
  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /PromiseResolution::Value/);
  validateGeneratedProject("promise-continuations", result.artifacts, { run: true });
});

test("Promise rejection preserves a source error's identity and native payload", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } }, files: {
    "index.ts": `
      import type { uint64 } from "@tsonic/core/types.js";
      class Failure extends Error {
        readonly code: uint64;
        constructor(code: uint64) { super("failure"); this.code = code; }
      }
      export async function main(): Promise<void> {
        const wide: uint64 = 9007199254740993n;
        const original = new Failure(wide);
        const rejected = new Promise<void>((resolve, reject) => { reject(original); });
        try { await rejected; throw new Error("missing rejection"); }
        catch (reason) {
          if (!(reason instanceof Failure)) throw new Error("lost error type");
          if (reason !== original || reason.code !== wide) throw new Error("lost identity or payload");
        }
      }
    `,
  } });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("promise-rejection-identity", result.artifacts, { run: true });
});

test("authored unknown rejection handlers receive the exact native error for then and catch", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } }, files: {
    "index.ts": `
      import type { int32 } from "@tsonic/core/types.js";
      class Counter { count: int32 = 0; }
      async function fail(): Promise<void> { throw new Error("selected native rejection"); }
      export async function main(): Promise<void> {
        const counter = new Counter();
        const failUnknown = (reason: unknown): void => {
          if (!(reason instanceof Error) || reason.message !== "selected native rejection") {
            throw new Error("rejection callback lost the native error");
          }
          counter.count += 1;
        };
        await fail().then(() => { counter.count += 100; }, failUnknown);
        await fail().catch(failUnknown);
        if (counter.count !== 2) throw new Error("native rejection handler did not run");
      }
    `,
  } });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /\.then\(/u);
  assert.match(source, /\.catch\(/u);
  assert.doesNotMatch(source, /dyn Future|Any|Box::pin/u);
  validateGeneratedProject("promise-unknown-rejection", result.artifacts, { run: true });
});
