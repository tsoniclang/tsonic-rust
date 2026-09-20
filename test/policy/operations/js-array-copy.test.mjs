import assert from "node:assert/strict";
import test from "node:test";
import { jsArrayCopyFiles } from "../../../../tsonic/test/fixtures/js-array-copy.mjs";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("Array.from preserves dense copies and explicit undefined entries", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `${jsArrayCopyFiles["index.ts"]}
export function main(): void { if (!run()) throw new Error("array copy contract"); }` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /array_from_dense_array/u);
  assert.doesNotMatch(output, /array_from_optional_array|array_from_undefined_array/u);
  validateGeneratedProject("js-array-copy", result.artifacts, { run: true });
});

for (const source of ["const values = [1, , 3];", "const values = [, undefined];"]) {
  test(`omitted array elements reject: ${source}`, () => {
    const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
export function copy(): number { ${source} return Array.from(values).length; }
` } });
    assert.equal(result.artifacts.length, 0);
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_SPARSE_ARRAY_UNSUPPORTED"));
  });
}

test("Array.from accepts canonical dense storage in an open exported parameter", () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "lib" } },
    files: { "index.ts": `
export function copy<T>(values: T[]): T[] { return Array.from(values); }
export function example(): number { return copy([1, 2]).length; }
` },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /array_from_dense_array/u);
});
