import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeNullishRecordsSource } from "../../../../tsonic/test/fixtures/native-nullish-records.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`native record coalescing retains backing and lazy fallback on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: {
      "index.ts": nativeNullishRecordsSource + '\nexport function main(): void { if (!run()) throw new Error("native nullish records"); }',
    } });
    assert.deepEqual(result.diagnostics, []);
    const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
    assert.match(output, /Record<String, u64>/u);
    assert.match(output, /let index_key\w* = "missing";/u);
    assert.match(output, /let index_key\w* = "present";/u);
    assert.doesNotMatch(output, /u64_to_f64|f64_to_u64/u);
    const reads = output.match(/\bfn read\b[\s\S]*?(?=\bfn run\b)/u);
    assert.ok(reads);
    assert.doesNotMatch(reads[0], /String::from\(/u);
    validateGeneratedProject("native-nullish-records", result.artifacts, { run: true });
  });
}
