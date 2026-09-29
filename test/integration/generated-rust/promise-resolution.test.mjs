import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("Promise.resolve preserves exact values, absence, evaluation and existing promise failure", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
      import type { uint64 } from "@tsonic/core/types.js";
      function value(calls: number[]): string { calls.push(1); return "ready"; }
      async function fail(): Promise<number> { throw new Error("rejected"); }
      export async function main(): Promise<void> {
        const absent = Promise.resolve(undefined);
        if (await absent !== undefined || await absent !== null) throw new Error("absence");
        const calls: number[] = [];
        const text = Promise.resolve(value(calls));
        if (calls.length !== 1 || await text !== "ready" || await text !== "ready") throw new Error("evaluation");
        const wide: uint64 = 9007199254740993n;
        if (await Promise.resolve(wide) !== wide) throw new Error("native width");
        if (await Promise.resolve(Promise.resolve(7)) !== 7) throw new Error("promise value");
        let rejected = false;
        try { await Promise.resolve(fail()); } catch { rejected = true; }
        if (!rejected) throw new Error("promise rejection");
      }
    ` },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /JsPromise::resolved/);
  assert.match(artifactText(result, "src/index.rs"), /std::convert::identity/);
  validateGeneratedProject("promise-resolution", result.artifacts, { run: true });
});
