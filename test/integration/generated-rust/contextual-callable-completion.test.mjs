import assert from "node:assert/strict";
import test from "node:test";
import { contextualCallableCompletionSource, optionalCallableCompletionSource } from "../../../../tsonic/test/fixtures/contextual-callable-completion.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("contextual broad callbacks complete through their native absence storage", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": contextualCallableCompletionSource + '\nexport function main(): void { if (!run()) throw new Error("contextual completion"); }' } });
  assert.deepEqual(result.diagnostics, []);
  const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.match(output, /OptionalStorage<.*JsValue>.*>::absent\(/u);
  assert.doesNotMatch(output, /\.map\(\|_\||from_closed\(&\(\)\)|unreachable_unchecked/u);
  validateGeneratedProject("contextual-callable-completion", result.artifacts, { run: true });
});

for (const surfaces of [[], ["js"]]) {
  const lane = surfaces[0] ?? "native";
  test(`optional callable completion retains exact native absence in ${lane}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": optionalCallableCompletionSource + '\nexport function main(): void { if (!run()) throw new Error("optional completion"); }' } });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject(`optional-callable-completion-${lane}`, result.artifacts, { run: true });
  });
}

test("a contextual required result cannot invent an absence completion", () => {
  assert.throws(() => compileRust({ files: { "index.ts": `
    function take(handler: (present: boolean) => number): void {}
    export function run(): void { take(present => { if (present) return 7; }); }
  ` } }), /TS2345/u);
});
