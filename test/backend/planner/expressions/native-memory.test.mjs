import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";
import { memoryAbiCapability, nativeLocationProofSource } from "../../../helpers/memory-abi.mjs";

test("native locations retain original local storage, allocation aliases and lifetime owners", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    capabilities: [memoryAbiCapability("rust")],
    target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": nativeLocationProofSource + `
export function main(): void { if (!run()) throw new Error("native location aliasing"); }
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /allocate_native_location/u);
  assert.match(output, /reinterpret_raw_location::<u32>/u);
  assert.doesNotMatch(output, /as \*mut|as \*const/u);
  validateGeneratedProject("native-location-aliases", result.artifacts, { run: true });
});

test("native array value reads clone proven owned handles while storage writes remain places", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
      export function main(): void {
        const values: string[] = ["original", "second"];
        const saved = values[0];
        values[0] = "changed";
        if (saved !== "original" || values[0] !== "changed" || values[1] !== "second") {
          throw new Error("native index value/storage ownership");
        }
      }
    ` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /\]\.clone\(\)/u);
  assert.doesNotMatch(output, /\]\.clone\(\)\s*=/u);
  validateGeneratedProject("native-index-owned-reads", result.artifacts, { run: true });
});

for (const [name, source, diagnostic] of [
  ["open caller", `export function expose(pointer: Pointer<uint32>) { return toRawPointer(pointer, word); }`, "RUST_NATIVE_BACKING_NOT_PROVEN"],
  ["conflicting inferred pointees", `import type { int32 } from "@tsonic/core/types.js"; export function expose(flag: boolean) { return flag ? allocatePointer<uint32>(1) : allocatePointer<int32>(2); }`, "RUST_MISSING_TARGET_FACT"],
  ["logical projection", `export function expose() { const pointer = allocatePointer<uint32>(1); return toRawPointer(projectPointer<uint32, uint32>(pointer, value => value, value => value), word); }`, "RUST_NATIVE_BACKING_NOT_PROVEN"],
  ["incompatible scalar size", `const wrong = memoryLayout<uint32>(abi, 8, 4, 8); export function expose(raw: RawPointer | undefined) { unsafeContext(); return reinterpretRawPointer(raw, wrong); }`, "RUST_RAW_LOCATION_NOT_PROVEN"],
  ["unsafe context", `export function expose(raw: RawPointer | undefined): Pointer<uint32> | undefined { return reinterpretRawPointer(raw, word); }`, "RUST_NATIVE_POINTER_UNSAFE_CONTEXT_REQUIRED"],
  ["invalid bit patterns", `const invalid = memoryLayout<boolean>(abi, 1, 1, 1); export function expose(raw: RawPointer | undefined) { unsafeContext(); return reinterpretRawPointer(raw, invalid); }`, "RUST_RAW_LOCATION_NOT_PROVEN"],
]) {
  test(`native memory rejects ${name} without publishing artifacts`, () => {
    const { result } = compileRust({ capabilities: [memoryAbiCapability("rust")], files: { "index.ts": `
import { abi } from "test:abi";
import { memoryLayout, toRawPointer, reinterpretRawPointer, allocatePointer, projectPointer, unsafeContext } from "@tsonic/core/lang.js";
import type { Pointer, RawPointer, uint32 } from "@tsonic/core/types.js";
const word = memoryLayout<uint32>(abi, 4, 4, 4);
${source}
` } });
    assert.ok(result.diagnostics.some(item => item.code === diagnostic), JSON.stringify(result.diagnostics, null, 2));
    assert.equal(result.artifacts.length, 0);
  });
}
