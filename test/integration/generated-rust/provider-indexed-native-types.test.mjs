import assert from "node:assert/strict";
import test from "node:test";
import { providerIndexedNativeTypes, providerIndexedNativeUse } from "../../../../tsonic/test/fixtures/provider-indexed-native-types.mjs";
import { compileRust, nodejsCapability } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("provider indexed types preserve native fields, aliases and unannotated returns across files", { timeout: 300_000 }, async () => {
  const { result } = compileRust({ surfaces: ["js"], capabilities: [await nodejsCapability()],
    target: { id: "rust", options: { outputType: "bin", crateName: "provider_indexed_native_types" } },
    files: {
      "model.ts": providerIndexedNativeTypes,
      "index.ts": providerIndexedNativeUse + '\nexport function main(): void { if (!run()) throw new Error("provider indexed native types"); }',
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.match(output, /size: u64/u);
  assert.match(output, /direct: u64/u);
  assert.match(output, /optional: Option<u64>/u);
  assert.match(output, /fn forward\(size: u64\) -> u64/u);
  assert.match(output, /fn exact\(size: u64\) -> u64/u);
  assert.match(output, /fn plain\(value: f64\) -> f64/u);
  assert.doesNotMatch(output, /(?:size|direct): f64|u64_to_f64|f64_to_u64/u);
  validateGeneratedProject("provider-indexed-native-types", result.artifacts, { run: true });
});
