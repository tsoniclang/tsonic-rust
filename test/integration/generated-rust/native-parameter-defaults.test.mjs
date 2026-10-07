import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, createRustSession, rustSourceDiagnostics } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeParameterDefaultsSource, orderedParameterDefaultsSource } from "../../../../tsonic/test/fixtures/native-parameter-defaults.mjs";

for (const surface of ["native", "js"]) {
  test(`native broad parameter defaults retain absence, present values and callee effects (${surface})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: surface === "js" ? ["js"] : [],
      target: { id: "rust", options: { outputType: "bin" } }, files: {
        "index.ts": nativeParameterDefaultsSource + '\nexport function main(): void { if (!run()) throw new Error("native parameter defaults"); }',
      } });
    assertNoTargetDiagnostics(result.diagnostics);
    validateGeneratedProject(`native-parameter-defaults-${surface}`, result.artifacts, { run: true });
  });

  test(`default-before-required slots retain required arity and callee effects (${surface})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: surface === "js" ? ["js"] : [],
      target: { id: "rust", options: { outputType: "bin" } }, files: {
        "index.ts": orderedParameterDefaultsSource + '\nexport function main(): void { if (!run()) throw new Error("ordered parameter defaults"); }',
      } });
    assertNoTargetDiagnostics(result.diagnostics);
    validateGeneratedProject(`ordered-parameter-defaults-${surface}`, result.artifacts, { run: true });
  });
}

test("default-before-required source calls cannot omit a mandatory slot", () => {
  const diagnostics = rustSourceDiagnostics(createRustSession({ files: { "index.ts": orderedParameterDefaultsSource + `
    constant(); constant(1); ordered(); deferred(undefined); new Holder();
    destructured(); destructured({ value: 0 }); positional(); positional([0]);
  ` } }));
  assert.equal([...diagnostics.matchAll(/error TS2554:/gu)].length, 9);
});
