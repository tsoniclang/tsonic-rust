import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { guardedNativeIntegerSource, unguardedNativeIntegerSource } from "../../../../tsonic/test/fixtures/guarded-native-integers.mjs";

for (const surfaces of [[], ["js"]]) {
  const name = surfaces.length === 0 ? "native" : "js";
  test(`guarded native integer arithmetic retains exact width (${name})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: "guarded_integers" } },
      files: { "index.ts": guardedNativeIntegerSource + '\nexport function main(): void { if (!run()) throw new Error("guarded integers"); }' } });
    assert.deepEqual(result.diagnostics, []);
    const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
    assert.match(output, /value as u64/u);
    assert.match(output, /value as usize/u);
    assert.doesNotMatch(output, /f64|checked_integer/u);
    validateGeneratedProject(`guarded-native-integers-${name}`, result.artifacts, { run: true });
  });
  test(`unguarded signed arithmetic cannot enter an unsigned native carrier (${name})`, () => {
    const { result } = compileRust({ surfaces, files: { "index.ts": unguardedNativeIntegerSource } });
    assert.notEqual(result.diagnostics.length, 0);
    assert.equal(result.artifacts.length, 0);
  });
}
