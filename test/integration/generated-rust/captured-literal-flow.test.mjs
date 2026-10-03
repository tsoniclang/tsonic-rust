import assert from "node:assert/strict";
import test from "node:test";
import { capturedLiteralFlowSource } from "../../../../tsonic/test/fixtures/captured-literal-flow.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`captured literal guards retain native source members on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const name = `captured_literal_flow_${surfaces[0] ?? "native"}`;
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: name } },
      files: { "index.ts": `${capturedLiteralFlowSource}
        export function main(): void { if (!run()) throw new Error("captured literal flow"); }` },
    });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
    validateGeneratedProject(name, result.artifacts, { run: true });
  });
}
