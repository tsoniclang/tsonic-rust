import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeAbsenceSource, nativeAbsenceJsSource, nativeAbsenceArraySource } from "../../../../tsonic/test/fixtures/native-absence.mjs";

test("generic absence arrays retain native storage and aliases", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "native_absence_arrays" } },
    files: { "index.ts": `${nativeAbsenceArraySource}\nexport function main(): void { if (!run()) throw new Error("native absence arrays"); }` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("native-absence-js-arrays", result.artifacts, { run: true });
  const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.doesNotMatch(output, /JsArray<Option<Option</u);
});

test("JS surface absence keeps membership and native values", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "native_absence_collections" } },
    files: { "index.ts": `${nativeAbsenceJsSource}\nexport function main(): void { if (!run()) throw new Error("native absence collections"); }` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("native-absence-js-collections", result.artifacts, { run: true });
});

for (const surfaces of [[], ["js"]]) {
  test(`one native absence preserves values, aliases and evaluation (${surfaces[0] ?? "native"})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: "native_absence" } },
      files: { "index.ts": `${nativeAbsenceSource}\nexport function main(): void { if (!run()) throw new Error("native absence"); }` },
    });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject(`native-absence-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
    const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
    assert.doesNotMatch(output, /rt::(?:Null|Undefined)/u);
  });
}
