import assert from "node:assert/strict";
import test from "node:test";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { nativeErrorCatchFunctionSource, nativeErrorCatchSource } from "../../../../tsonic/test/fixtures/native-error-catch.mjs";
import { compileRust, artifactText, rustSourceText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`closed native callback catch retains the direct runtime carrier (${surfaces.length === 0 ? "native" : "js"})`,
    { timeout: 300_000 }, () => {
      const { result } = compileRust({ surfaces,
        target: { id: "rust", options: { outputType: "bin", crateName: "native_error_catch" } },
        files: { "index.ts": `${nativeErrorCatchSource}
export function main(): void { if (!run()) throw new Error("callback Error catch failed"); }` } });
      assertNoTargetDiagnostics(result.diagnostics);
      assert.equal(/\bSourceError\b/u.test(rustSourceText(result)), false,
        "closed native origins do not require a broader Error view");
      assert.equal(validateGeneratedProject(`native-error-catch-closed-${surfaces.length}`, result.artifacts, { run: true }).status, 0);
    });
  test(`native callback catch owns its selected native Error view (${surfaces.length === 0 ? "native" : "js"})`,
    { timeout: 300_000 }, () => {
      const { result } = compileRust({ surfaces,
        target: { id: "rust", options: { outputType: "lib", crateName: "native_error_catch" } },
        files: { "index.ts": nativeErrorCatchFunctionSource } });
      assertNoTargetDiagnostics(result.diagnostics);
      assert.equal(/pub struct SourceError\b/u.test(artifactText(result, "src/program.rs")), true,
        "a selected native Error view requires its actual transport declaration, not an unsupported runtime projection");
      assert.equal(/Retained\(/u.test(artifactText(result, "src/program.rs")), false,
        "an Error view alone does not invent a retained native payload");
      validateGeneratedProject(`native-error-catch-open-${surfaces.length}`, result.artifacts.map(artifact =>
        artifact.path !== "src/lib.rs" ? artifact : { ...artifact, text: `${artifact.text}
#[cfg(test)]
mod catch_checks {
    #[test]
    fn original_error_and_success_keep_their_values() {
        let original =
            crate::program::TsonicError::from(tsonic_rust_runtime::JsError::error("original"));
        let throwing = tsonic_rust_runtime::Callable::new(move |()| Err(original.clone()));
        assert_eq!(crate::invoke(&throwing), "original");
        let passing = tsonic_rust_runtime::Callable::new(|()| Ok(()));
        assert_eq!(crate::invoke(&passing), "success");
    }
}
` }));
    });
}
