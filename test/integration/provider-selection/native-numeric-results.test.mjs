import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust, nodejsCapability } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeSurfaceResultsSource, nativeNodeResultsSource } from "../../../../tsonic/test/fixtures/native-surface-results.mjs";

for (const [name, source, node] of [
  ["native_surface_results", nativeSurfaceResultsSource, false],
  ["native_node_results", nativeNodeResultsSource, true],
]) {
  test(`${name} retains native result widths and API behavior`, { timeout: 300_000 }, async () => {
    const { result } = compileRust({
      surfaces: ["js"], packages: [acmeTestingPackage()],
      capabilities: node ? [await nodejsCapability()] : [],
      target: { id: "rust", options: { outputType: "bin", crateName: name } },
      files: { "index.ts": `${source}
        import { check } from "@acme/testing";
        export function main(): void { check(run()); }` },
    });
    assert.deepEqual(result.diagnostics, []);
    const text = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
    assert.match(text, /word: u32/u);
    if (node) {
      assert.match(text, /size: u64/u);
      assert.doesNotMatch(text, /u64_to_f64|usize_to_i32/u);
    } else {
      assert.match(text, /single: f32/u);
      assert.match(text, /first: u32/u);
      assert.match(text, /timer: u64/u);
      assert.match(text, /interval: u64/u);
    }
    validateGeneratedProject(name, result.artifacts, { run: true });
  });
}
