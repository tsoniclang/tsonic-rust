import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { partialNativeGuardsSource } from "../../../../tsonic/test/fixtures/partial-native-guards.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`partial native guards preserve stronger checked evidence on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: {
      "index.ts": partialNativeGuardsSource + '\nexport function main(): void { if (!run()) throw new Error("partial native guards"); }',
    } });
    assertNoTargetDiagnostics(result.diagnostics);
    validateGeneratedProject("partial-native-guards", result.artifacts, { run: true });
  });
}

test("disjunctive early guards retain the complete present array/text carrier and exact wide integers", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } }, files: {
    "index.ts": `
import type { int64 } from "@tsonic/core/types.js";
export function rewrite(value: string | readonly string[] | undefined): void {
  if (!(Array.isArray(value) || typeof value === "string")) return;
  if (typeof value === "string") return;
  value[0] = "rewritten";
}
function wide(value: string | int64 | readonly string[] | undefined): int64 {
  if (!(Array.isArray(value) || typeof value === "bigint")) return 0n;
  if (Array.isArray(value)) return 1n;
  return value;
}
export function main(): void {
  const values: string[] = ["original"];
  rewrite(values);
  rewrite("unchanged");
  rewrite(undefined);
  const integer: int64 = 9007199254740993n;
  if (values[0] !== "rewritten" || wide(integer) !== integer ||
      wide(values) !== 1n || wide("excluded") !== 0n || wide(undefined) !== 0n) {
    throw new Error("native disjunction carrier or alias lost");
  }
}
`,
  } });
  assertNoTargetDiagnostics(result.diagnostics);
  const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.match(output, /i64/u);
  assert.doesNotMatch(output, /f64|checked_integer|js_value_from_closed/u);
  validateGeneratedProject("native-disjunction-present-carrier", result.artifacts, { run: true });
});
