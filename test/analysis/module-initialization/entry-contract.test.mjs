import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`binary entry rejects uncalled main on ${surfaces[0] ?? "native"}`, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": "export function main(): void {}" } });
    assert.equal(result.artifacts.length, 0);
    assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.code), ["TSONIC_UNCALLED_BINARY_ENTRY_MAIN"]);
  });

  for (const [name, source] of [
    ["explicit", 'export function main(): void { console.log("entry ran"); } main();'],
    ["top_level", 'console.log("entry ran");'],
  ]) {
    test(`binary ${name} runs exactly once on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
      const sourceText = surfaces.length === 0
        ? name === "explicit" ? "export function main(): void {} main();" : "export const result = 42;"
        : source;
      const { result } = compileRust({ surfaces,
        target: { id: "rust", options: { outputType: "bin", crateName: `entry_${name}_${surfaces[0] ?? "native"}` } },
        files: { "index.ts": sourceText } });
      assert.equal(result.diagnostics.length, 0, result.diagnostics.map(diagnostic => diagnostic.message).join("\n"));
      assert.doesNotMatch(artifactText(result, "src/main.rs"), /tsonic_entry/u);
      const native = validateGeneratedProject(`entry-${name}`, result.artifacts, { run: true });
      assert.equal(native.stdout, surfaces.length === 0 ? "" : "entry ran\n");
    });
  }

  test(`library main remains an uninvoked export on ${surfaces[0] ?? "native"}`, () => {
    const { result } = compileRust({ surfaces, files: { "index.ts": "export function main(): void {}" } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(diagnostic => diagnostic.message).join("\n"));
    assert.equal(result.artifacts.some(artifact => artifact.path === "src/main.rs"), false);
    assert.match(artifactText(result, "src/index.rs"), /pub fn main\(\)/u);
  });
}
