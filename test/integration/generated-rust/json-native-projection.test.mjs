import assert from "node:assert/strict";
import test from "node:test";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { jsonNativeProjectionSource } from "../../../../tsonic/test/fixtures/json-native-projection.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("native JSON projections preserve exact integers, property keys and callback error identity", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "json_native_projection" } },
    files: { "index.ts": `${jsonNativeProjectionSource}\nexport function main(): void { run(); }` },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.equal(typeof source, "string");
  assert.match(source, /js_value_from_json_projection/u);
  validateGeneratedProject("json-native-projection", result.artifacts, { run: true });
});
