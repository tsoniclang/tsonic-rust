import assert from "node:assert/strict";
import test from "node:test";
import { optionalCallbackInputsSource, optionalAsyncCallbackInputsSource } from "../../../../tsonic/test/fixtures/optional-callback-inputs.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  const lane = surfaces[0] ?? "native";
  test(`optional callback inputs preserve exact absent aliases on ${lane}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": optionalCallbackInputsSource + '\nexport function main(): void { if (!run()) throw new Error("optional callback input"); }' } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
    validateGeneratedProject(`optional-callback-inputs-${lane}`, result.artifacts, { run: true });
  });
}

test("optional async callback inputs retain exact Promise completion and live captures", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": optionalAsyncCallbackInputsSource + '\nexport async function main(): Promise<void> { if (!await run()) throw new Error("optional async callback input"); }' } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
  validateGeneratedProject("optional-async-callback-inputs", result.artifacts, { run: true });
});

test("optional callback input validation rejects an incompatible authored payload", () => {
  assert.throws(() => compileRust({ files: { "index.ts": `
    type Next = (value?: string | null) => void;
    function invoke(next: Next): void { next("route"); }
    export function run(): void { invoke((value?: number | null): void => {}); }
  ` } }), /TS2345/u);
});
