import assert from "node:assert/strict";
import test from "node:test";
import { inferredDefaultParameterSource } from "../../../../tsonic/test/fixtures/inferred-default-parameters.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`inferred defaults retain exact values and conditional effects in ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: "inferred_defaults" } },
      files: { "index.ts": `${inferredDefaultParameterSource}
export function main(): void { if (!run()) throw new Error("inferred defaults"); }` },
    });
    assert.deepEqual(result.diagnostics, []);
    assert.equal(validateGeneratedProject("inferred-defaults", result.artifacts, { run: true }).status, 0);
  });
}
