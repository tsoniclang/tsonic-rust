import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { borrowedComparisonMutationSource, closedUnionEqualitySource } from "../../../../tsonic/test/fixtures/closed-union-equality.mjs";

test("closed union equality borrows exact payloads and preserves identity", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": closedUnionEqualitySource + '\nexport function main(): void { if (!run()) throw new Error("union equality"); }' } });
  assertNoTargetDiagnostics(result.diagnostics);
  const generated = artifactText(result, "src/index.rs");
  const path = generated.split("fn path(")[1]?.split(/\n(?:pub(?:\([^)]*\))? )?fn /u)[0];
  assert.ok(path !== undefined);
  assert.doesNotMatch(path, /\.clone\(|to_owned\(|to_string\(|Box::|JsValue/u);
  assert.match(path, /match /u);
  validateGeneratedProject("closed-union-equality", result.artifacts, { run: true });
});

test("closed union comparison preserves imported alias and callable identities", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } }, files: {
    "values.ts": closedUnionEqualitySource,
    "index.ts": 'import { run } from "./values.js"; export function main(): void { if (!run()) throw new Error("cross-file equality"); }',
  } });
  assertNoTargetDiagnostics(result.diagnostics);
  validateGeneratedProject("cross-file-union-equality", result.artifacts, { run: true });
});

for (const surfaces of [[], ["js"]]) {
  test(`borrowed comparisons preserve the first value and release its owner before RHS mutation (${surfaces[0] ?? "native"})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": borrowedComparisonMutationSource + '\nexport function main(): void { if (!run()) throw new Error("borrowed comparison mutation"); }' } });
    assertNoTargetDiagnostics(result.diagnostics);
    validateGeneratedProject(`borrowed-comparison-mutation-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });
}
