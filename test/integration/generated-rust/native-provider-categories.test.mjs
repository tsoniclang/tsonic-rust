import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { nativeProviderCategoriesSource } from "../../../../tsonic/test/fixtures/native-provider-categories.mjs";
import { compileRust, nodejsCapability } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("native provider categories retain member result identities and one evaluation", { timeout: 300_000 }, async () => {
  const { result } = compileRust({ surfaces: ["js"], capabilities: [await nodejsCapability()],
    target: { id: "rust", options: { outputType: "bin" } }, files: {
      "index.ts": nativeProviderCategoriesSource + '\nexport function main(): void { if (!run()) throw new Error("native provider categories"); }',
    } });
  assertNoTargetDiagnostics(result.diagnostics);
  const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.doesNotMatch(output, /std::any::|type_name\(/u);
  validateGeneratedProject("native-provider-categories", result.artifacts, { run: true });
});
