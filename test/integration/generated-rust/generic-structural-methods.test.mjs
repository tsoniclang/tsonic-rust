import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { genericStructuralMethodFiles, genericStructuralAsyncFiles, genericStructuralOptionalFiles, inheritedStructuralOptionalFiles, monomorphicStructuralOptionalFiles } from "../../../../tsonic/test/fixtures/generic-structural-methods.mjs";

for (const surface of ["native", "js"]) {
  test(`optional monomorphic methods retain their receiver without eager arguments (${surface})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: surface === "js" ? ["js"] : [],
      target: { id: "rust", options: { outputType: "bin" } }, files: {
        "index.ts": monomorphicStructuralOptionalFiles["index.ts"] + '\nexport function main(): void { if (!run()) throw new Error("optional monomorphic method identity"); }',
      } });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject(`monomorphic-structural-optional-${surface}`, result.artifacts, { run: true });
  });
  test(`inherited optional generic methods retain lazy arguments and generic results (${surface})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: surface === "js" ? ["js"] : [],
      target: { id: "rust", options: { outputType: "bin" } }, files: {
        "index.ts": inheritedStructuralOptionalFiles["index.ts"] + '\nexport function main(): void { if (!run()) throw new Error("inherited optional generic method identity"); }',
      } });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject(`inherited-structural-optional-${surface}`, result.artifacts, { run: true });
  });
  test(`optional generic structural methods retain absence and their receiver (${surface})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: surface === "js" ? ["js"] : [],
      target: { id: "rust", options: { outputType: "bin" } }, files: {
        "index.ts": genericStructuralOptionalFiles["index.ts"] + '\nexport function main(): void { if (!run()) throw new Error("optional generic method identity"); }',
      } });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject(`generic-structural-optional-${surface}`, result.artifacts, { run: true });
  });
  test(`generic structural methods retain receivers and lexical capture identity (${surface})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: surface === "js" ? ["js"] : [],
      target: { id: "rust", options: { outputType: "bin" } }, files: {
        ...genericStructuralMethodFiles,
        "index.ts": genericStructuralMethodFiles["index.ts"] + '\nexport function main(): void { if (!run()) throw new Error("generic method identity"); }',
      } });
    assert.deepEqual(result.diagnostics, []);
    const source = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
    assert.match(source, /\.call::<f64>/u);
    assert.match(source, /\.call::<String>/u);
    assert.doesNotMatch(source, /dyn Any|Box<dyn Fn/u);
    validateGeneratedProject(`generic-structural-methods-${surface}`, result.artifacts, { run: true });
  });
  test(`generic structural async methods retain their owning receiver (${surface})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: surface === "js" ? ["js"] : [],
      target: { id: "rust", options: { outputType: "bin" } }, files: {
        "index.ts": genericStructuralAsyncFiles["index.ts"] + '\nexport async function main(): Promise<void> { if (!await run()) throw new Error("generic async method identity"); }',
      } });
    assert.deepEqual(result.diagnostics, []);
    const source = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
    if (surface === "native") assert.doesNotMatch(source, /Box<dyn (?:core::future::)?Future|Pin<Box|Promise|JsValue/u);
    validateGeneratedProject(`generic-structural-async-${surface}`, result.artifacts, { run: true });
  });
}
