import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { nativeProviderUnionSource } from "../../../../tsonic/test/fixtures/native-provider-unions.mjs";
import { compileRust, nodejsCapability } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("native provider unions retain selected members and nominal payloads", { timeout: 300_000 }, async () => {
  const { result } = compileRust({ surfaces: ["js"], capabilities: [await nodejsCapability()],
    target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": nativeProviderUnionSource +
      '\nexport function main(): void { if (!run()) throw new Error("native provider union"); }' } });
  assertNoTargetDiagnostics(result.diagnostics);
  const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.doesNotMatch(output, /JsValue::|invoke_dynamic|read_dynamic_slot/);
  validateGeneratedProject("native-provider-unions", result.artifacts, { run: true });
});
