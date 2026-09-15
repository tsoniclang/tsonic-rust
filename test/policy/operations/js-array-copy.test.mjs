import assert from "node:assert/strict";
import test from "node:test";
import { jsArrayCopyFiles } from "../../../../tsonic/test/fixtures/js-array-copy.mjs";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("Array.from preserves dense copies and materializes sparse undefined entries", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `${jsArrayCopyFiles["index.ts"]}
export function main(): void { if (!run()) throw new Error("array copy contract"); }` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /array_from_dense_array/u);
  assert.match(output, /array_from_optional_array/u);
  assert.match(output, /array_from_undefined_array/u);
  validateGeneratedProject("js-array-copy", result.artifacts, { run: true });
});

for (const [label, source] of [
  ["a scalar hole", "const values: number[] = new Array<number>(2);"],
  ["a null-only payload with a hole", "const values: (number | null)[] = new Array<number | null>(2);"],
  ["length expansion", "const values = [1]; values.length = 3;"],
  ["deletion through an alias", "const values = [1]; const alias = values; delete alias[0];"],
]) {
  test(`Array.from rejects ${label} without a representable undefined element`, () => {
    const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
export function copy(): number { ${source} return Array.from(values).length; }
` } });
    assert.equal(result.artifacts.length, 0);
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_SELECTED_OPERATION_UNSUPPORTED"));
  });
}

test("Array.from does not infer density for an open exported parameter", () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "lib" } },
    files: { "index.ts": `
export function copy<T>(values: T[]): T[] { return Array.from(values); }
export function example(): number { return copy([1, 2]).length; }
` },
  });
  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_SELECTED_OPERATION_UNSUPPORTED"));
});
