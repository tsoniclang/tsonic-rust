import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { closedArrayPredicateFiles } from "../../../../tsonic/test/fixtures/closed-array-predicates.mjs";

test("closed array predicates retain native union payloads and evaluate once", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } }, files: {
    ...closedArrayPredicateFiles,
    "index.ts": closedArrayPredicateFiles["index.ts"] + '\nexport function main(): void { if (!run()) throw new Error("array predicates"); }',
  } });
  assert.deepEqual(result.diagnostics, []);
  const source = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.doesNotMatch(source, /js_value_from_array|js_value_from_source_union/u);
  validateGeneratedProject("closed-array-predicates", result.artifacts, { run: true });
});
