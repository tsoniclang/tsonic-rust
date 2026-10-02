import assert from "node:assert/strict";
import test from "node:test";
import { optionalOverloadedMethodSource, optionalOverloadedBroadMethodSource } from "../../../../tsonic/test/fixtures/optional-overloaded-methods.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  const lane = surfaces[0] ?? "native";
  for (const [name, sourceText] of [["string", optionalOverloadedMethodSource], ["broad", optionalOverloadedBroadMethodSource]]) {
    test(`optional overloaded ${name} methods retain selected native calls in ${lane}`, { timeout: 300_000 }, () => {
      const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
        files: { "index.ts": sourceText + '\nexport function main(): void { if (!run()) throw new Error("optional overload"); }' } });
      assert.deepEqual(result.diagnostics, []);
      const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
      assert.doesNotMatch(output, /invoke_dynamic|read_dynamic_slot/u);
      validateGeneratedProject(`optional-overloaded-${name}-${lane}`, result.artifacts, { run: true });
    });
  }
}

test("optional overloaded calls reject arguments outside every selected signature", () => {
  assert.throws(() => compileRust({ surfaces: ["js"], files: { "index.ts":
    optionalOverloadedBroadMethodSource + '\nexport function rejected(source: Source | undefined): unknown { return source?.read(true); }' } }), /TS2769/u);
});
