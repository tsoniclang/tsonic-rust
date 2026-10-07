import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { nativeClosedValuesSource } from "../../../../tsonic/test/fixtures/native-closed-values.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [undefined, ["js"]]) {
  test(`native closed values retain exact primitive, absence and shared-object operations in ${surfaces?.[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": nativeClosedValuesSource + '\nexport function main(): void { if (!run()) throw new Error("native closed values"); }' } });
    assertNoTargetDiagnostics(result.diagnostics);
    const source = artifactText(result, "src/index.rs");
    if (surfaces === undefined) assert.match(source, /native_values_equal/u);
    assert.match(source, /from_shared_identity/u);
    assert.doesNotMatch(source, /TsValue::from_identity/u);
    if (surfaces === undefined) assert.doesNotMatch(source, /js_abi|tsonic_rust_js/u);
    validateGeneratedProject(`native-closed-values-${surfaces?.[0] ?? "native"}`, result.artifacts, { run: true });
  });
}
