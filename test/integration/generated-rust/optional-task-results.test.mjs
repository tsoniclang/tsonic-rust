import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("void-bearing promise returns retain one native absence and precise completion", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
    type Next = (flag: boolean, calls: number[]) => void | Promise<void>;
    async function later(calls: number[]): Promise<void> { calls.push(2); }
    function mark(calls: number[]): void { calls.push(3); }
    function returnCall(_flag: boolean, calls: number[]): void | Promise<void> { return mark(calls); }
    function synchronous(_flag: boolean, calls: number[]): void { mark(calls); }
    function maybe(flag: boolean, calls: number[]): Promise<number> | undefined {
      calls.push(4);
      return flag ? Promise.resolve(7) : undefined;
    }
    function choose(flag: boolean, calls: number[]): void | Promise<void> {
      calls.push(1);
      if (flag) return later(calls);
    }
    function early(flag: boolean, calls: number[]): void | Promise<void> {
      if (!flag) return;
      return later(calls);
    }
    async function run(): Promise<boolean> {
      const calls: number[] = [];
      const next: Next = (flag, values) => { if (flag) return later(values); };
      const empty: Next = () => {};
      const expression: Next = (_flag, values) => mark(values);
      const selected: Next = synchronous;
      if (choose(false, calls) !== undefined || early(false, calls) !== null) return false;
      await choose(false, calls);
      await choose(true, calls);
      await early(false, calls);
      await early(true, calls);
      await next(false, calls);
      await next(true, calls);
      await empty(false, calls);
      await expression(false, calls);
      await returnCall(false, calls);
      await selected(false, calls);
      if (await maybe(false, calls) !== undefined || await maybe(true, calls) !== 7) return false;
      return calls.length === 11;
    }
    export async function main(): Promise<void> { if (!await run()) throw new Error("optional promise completion"); }
  ` } });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("optional-task-results", result.artifacts, { run: true });
});
