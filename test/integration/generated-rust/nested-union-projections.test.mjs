import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nestedUnionProjectionFiles } from "../../../../tsonic/test/fixtures/nested-union-projections.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`nested native union projections retain payload identity and one absence on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: {
      ...nestedUnionProjectionFiles,
      "index.ts": nestedUnionProjectionFiles["index.ts"] + '\nexport function main(): void { if (!run()) throw new Error("nested union projections"); }',
    } });
    assertNoTargetDiagnostics(result.diagnostics);
    const source = result.artifacts.find(artifact => artifact.path === "src/index.rs").text;
    const start = source.indexOf("fn read(");
    const end = source.indexOf("fn readOptional(");
    assert.ok(start >= 0 && end > start);
    const read = source.slice(start, end);
    assert.match(read, /Entries::Variant1\(flow_value_\d+\)\)\s*=>\s*(?:\{\s*)?flow_value_\d+(?:\s*\})?\s*[,}]/u);
    validateGeneratedProject("nested-union-projections", result.artifacts, { run: true });
  });
}
