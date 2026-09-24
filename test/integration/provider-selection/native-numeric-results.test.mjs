import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust, nodejsCapability } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeSurfaceResultsSource, nativeNodeResultsSource } from "../../../../tsonic/test/fixtures/native-surface-results.mjs";
import { nativeCharacterInputsSource } from "../../../../tsonic/test/fixtures/native-character-inputs.mjs";
import { nativeNumericArraysSource } from "../../../../tsonic/test/fixtures/native-numeric-arrays.mjs";

test("optional native integers and negative sentinels join without floating transport", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "native_optional_integers" } },
    files: { "index.ts": `
import type { uint64, uint32 } from "@tsonic/core/types.js";
function read(wide: uint64 | undefined, small: uint32 | undefined): boolean {
  const value = wide ?? -1;
  const count = small ?? -1;
  if (wide === undefined) return value === -1 && count === -1;
  return value === 18446744073709551615n && count === 4294967295;
}
function unexpected(): never { throw new Error("eager fallback"); }
export function main(): void {
  const maximum: uint64 = 18446744073709551615n;
  const count: uint32 = 4294967295;
  const matches = "abc".match(/a/);
  const absent = "abc".match(/z/);
  if (!read(maximum, count) || !read(undefined, undefined) ||
      (matches?.length ?? -1) !== 1 || (absent?.length ?? -1) !== -1 ||
      (matches?.length ?? unexpected()) !== 1) throw new Error("incorrect native join");
}
` } });
  assert.deepEqual(result.diagnostics, []);
  const text = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.match(text, /value: i128/u);
  assert.match(text, /count: i64/u);
  assert.doesNotMatch(text, /(?:u64|usize)_to_f64|as f64|JsNumeric/u);
  validateGeneratedProject("native_optional_integers", result.artifacts, { run: true });
});

test("Atomics preserves native provider integers through storage, comparison and return", { timeout: 300_000 }, async () => {
  const { result } = compileRust({ surfaces: ["js"], capabilities: [await nodejsCapability()],
    target: { id: "rust", options: { outputType: "bin", crateName: "native_atomic_inputs" } },
    files: { "index.ts": `
import { cpuUsage } from "node:process";
export function main(): void {
  const cpu = cpuUsage();
  cpu.user = 9007199254740993;
  const values = new Int32Array(new SharedArrayBuffer(4));
  const stored = Atomics.store(values, 0, cpu.user);
  if (stored !== cpu.user || Atomics.load(values, 0) !== 1) throw new Error("lost integer bits");
  if (Atomics.wait(values, 0, cpu.user, 0) !== "timed-out") throw new Error("lost wait bits");
}
` } });
  assert.deepEqual(result.diagnostics, []);
  const text = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.match(text, /stored: i64/u);
  assert.doesNotMatch(text, /i64_to_f64|as f64/u);
  validateGeneratedProject("native_atomic_inputs", result.artifacts, { run: true });
});

test("numeric array construction and copy retain native element bits", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "native_numeric_arrays" } },
    files: { "index.ts": `${nativeNumericArraysSource}
      import { check } from "@acme/testing";
      export function main(): void { check(run()); }` },
  });
  assert.deepEqual(result.diagnostics, []);
  const text = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.match(text, /values: js_abi::JsArray<usize>/u);
  assert.doesNotMatch(text, /usize_to_f64|as f64/u);
  validateGeneratedProject("native_numeric_arrays", result.artifacts, { run: true });
});

test("character constructors retain native arguments and evaluation order", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "native_character_inputs" } },
    files: { "index.ts": `${nativeCharacterInputsSource}
      import { check } from "@acme/testing";
      export function main(): void { check(run()); }` },
  });
  assert.deepEqual(result.diagnostics, []);
  const text = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.match(text, /from_code_point::<u32>/u);
  assert.match(text, /from_char_code::<u8>/u);
  assert.doesNotMatch(text, /(?:u32|u64|usize)_to_f64|as f64/u);
  validateGeneratedProject("native_character_inputs", result.artifacts, { run: true });
});

for (const [name, source, node] of [
  ["native_surface_results", nativeSurfaceResultsSource, false],
  ["native_node_results", nativeNodeResultsSource, true],
]) {
  test(`${name} retains native result widths and API behavior`, { timeout: 300_000 }, async () => {
    const { result } = compileRust({
      surfaces: ["js"], packages: [acmeTestingPackage()],
      capabilities: node ? [await nodejsCapability()] : [],
      target: { id: "rust", options: { outputType: "bin", crateName: name } },
      files: { "index.ts": `${source}
        import { check } from "@acme/testing";
        export function main(): void { check(run()); }` },
    });
    assert.deepEqual(result.diagnostics, []);
    const text = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
    assert.match(text, /word: u32/u);
    if (node) {
      assert.match(text, /size: u64/u);
      assert.match(text, /fn native_file_size\(path: &str\) -> Result<u64,/u);
      assert.match(text, /fn forwarded_file_size\(path: &str\) -> Result<u64,/u);
      assert.doesNotMatch(text, /u64_to_f64|usize_to_i32/u);
    } else {
      assert.match(text, /single: f32/u);
      assert.match(text, /first: u32/u);
      assert.match(text, /timer: u64/u);
      assert.match(text, /interval: u64/u);
    }
    validateGeneratedProject(name, result.artifacts, { run: true });
  });
}
