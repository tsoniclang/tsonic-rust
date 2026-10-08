import assert from "node:assert/strict";
import test from "node:test";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { suspendedCallbackInputsSource } from "../../../../tsonic/test/fixtures/suspended-callback-inputs.mjs";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("suspended callback inputs preserve borrowed function and owning method result lifetimes", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": suspendedCallbackInputsSource } });
  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.equal(/sum<'input>/u.test(source), true, "one exact function loan binder");
  assert.equal(/pub fn sum\(\s*&self,\s*left: SumLeft,\s*right: SumLeft,\s*\) -> js_abi::JsPromise<'static, f64, rt::TsonicError>/u.test(source),
    true, "closed method inputs retain their sealed owning protocol");
  assert.equal(/&'input impl rt::CallableImplementation/u.test(source), true, "callback inputs remain native borrows");
  assert.equal(/JsPromise<'input, f64, rt::TsonicError>/u.test(source), true, "retained result cannot outlive its inputs");
  validateGeneratedProject("suspended-callback-inputs", result.artifacts, { run: true });
});
