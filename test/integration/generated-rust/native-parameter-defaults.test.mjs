import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeParameterDefaultsSource } from "../../../../tsonic/test/fixtures/native-parameter-defaults.mjs";

for (const surface of ["native", "js"]) {
  test(`native broad parameter defaults retain absence, present values and callee effects (${surface})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: surface === "js" ? ["js"] : [],
      target: { id: "rust", options: { outputType: "bin" } }, files: {
        "index.ts": nativeParameterDefaultsSource + '\nexport function main(): void { if (!run()) throw new Error("native parameter defaults"); }',
      } });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject(`native-parameter-defaults-${surface}`, result.artifacts, { run: true });
  });
}
