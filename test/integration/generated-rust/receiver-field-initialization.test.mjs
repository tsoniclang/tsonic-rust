import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { receiverFieldInitializationSource } from "../../../../tsonic/test/fixtures/receiver-field-initialization.mjs";

for (const surface of ["native", "js"]) {
  test(`receiver field initialization retains ordered construction and live callbacks (${surface})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: surface === "js" ? ["js"] : [],
      target: { id: "rust", options: { outputType: "bin" } }, files: {
        "index.ts": receiverFieldInitializationSource + '\nexport function main(): void { if (!run()) throw new Error("receiver field initialization"); }',
      } });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject(`receiver-field-initialization-${surface}`, result.artifacts, { run: true });
  });
}
