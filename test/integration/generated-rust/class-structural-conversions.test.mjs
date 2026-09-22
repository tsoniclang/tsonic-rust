import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { classStructuralConversionFiles, invalidClassStructuralConversions } from "../../../../tsonic/test/fixtures/class-structural-conversions.mjs";

test("class structural views compose assignments, parameters, returns, literals, accessors and generic owners", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "class_structural_conversions" } },
    files: { ...classStructuralConversionFiles, "index.ts": `${classStructuralConversionFiles["index.ts"]}
export function main(): void { if (!run()) throw new Error("structural conversion"); }
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const native = validateGeneratedProject("class-structural-conversions", result.artifacts, { run: true });
  assert.equal(native.status, 0, native.stdout + native.stderr);
  const emitted = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.match(emitted, /ObjectHandleState</u);
  assert.match(emitted, /\.into_shared\(\)/u);
  assert.doesNotMatch(emitted, /view_reader|view_writer/u);
});

test("structural-view checking retains incompatible field and readonly-write errors", () => {
  for (const source of invalidClassStructuralConversions) {
    const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": source } });
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.category === "error"));
    assert.equal(result.artifacts.length, 0);
  }
});
