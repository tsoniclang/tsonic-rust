import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, nodejsCapability } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeGuardReachabilitySource, nativeHeaderReachabilitySource } from "../../../../tsonic/test/fixtures/native-guard-reachability.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`native guard reachability preserves absence and effects on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: {
      "index.ts": nativeGuardReachabilitySource + '\nexport function main(): void { if (!run()) throw new Error("native guard reachability"); }',
    } });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject("native-guard-reachability", result.artifacts, { run: true });
  });
}

test("exact native header provider omits the impossible number and array paths", { timeout: 300_000 }, async () => {
  const { result } = compileRust({ surfaces: ["js"], capabilities: [await nodejsCapability()],
    target: { id: "rust", options: { outputType: "bin" } }, files: {
      "index.ts": nativeHeaderReachabilitySource + '\nexport function main(): void { if (!run()) throw new Error("native header reachability"); }',
    } });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("native-header-reachability", result.artifacts, { run: true });
});
