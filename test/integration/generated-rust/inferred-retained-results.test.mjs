import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("a returned owned Promise does not retain a loan of its callback input", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: {
    outputType: "lib", crateName: "inferred_retained_results",
  } }, files: { "index.ts": `
    export function forward(callback: () => Promise<string>): Promise<string> { return callback(); }
  ` } });
  assert.deepEqual(result.diagnostics.map(value => `${value.code}: ${value.message}`), []);
  const generated = artifactText(result, "src/index.rs");
  assert.doesNotMatch(generated, /AwaitError0/u);
  assert.match(generated, /InvocationError/u);
  assert.doesNotMatch(generated, /Implementation\w*: [^\n]*(?:Clone|'static)|transmute/u);
  const root = writeGeneratedProject("inferred-retained-results", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests", "forward.rs"), `
use core::convert::Infallible;
use inferred_retained_results::index;
use tsonic_rust_js::abi::JsPromise;
use tsonic_rust_runtime as rt;

struct Borrowed<'region>(&'region str);

impl rt::CallableImplementation<()> for Borrowed<'_> {
    type Output = Result<JsPromise<String>, Infallible>;
    fn invoke(&self, (): ()) -> Self::Output {
        let value = String::from(self.0);
        Ok(JsPromise::resolved(value))
    }
}

#[test]
fn returned_future_outlives_the_non_clone_callback() {
    let pending = {
        let value = String::from("owned completion");
        let callback = Borrowed(&value);
        index::forward(&callback).unwrap()
    };
    assert_eq!(rt::block_on(pending.into_result()).unwrap(), "owned completion");
}
`);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["fmt", "--all"]);
  runCargo(root, ["fmt", "--all", "--check"]);
  runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
  runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(root, ["test", "--locked", "--offline"]);
});
