import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { compileRust, artifactText } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";
import { memoryAbiCapability, nativeLocationProofSource } from "../../../helpers/memory-abi.mjs";
import { nativeFieldProofSource, nativeArrayProofSource } from "../../../helpers/native-record-proof.mjs";

for (const [name, body] of [
  ["self", `export function make(): Pointer<typeof make> { return allocatePointer<typeof make>(make); }`],
  ["mutual", `function first(): Pointer<typeof second> { return allocatePointer<typeof second>(second); }
    export function second(): Pointer<typeof first> { return allocatePointer<typeof first>(first); }`],
]) {
  test(`recursive pointer return carrier rejects ${name} without unbounded classification`, { timeout: 30_000 }, () => {
    const source = `import { allocatePointer } from "@tsonic/core/lang.js";
      import type { Pointer } from "@tsonic/core/types.js";
      ${body}`;
    const helper = new URL("../../../helpers/rust-session.mjs", import.meta.url).href;
    const loader = new URL("../../../../scripts/register-tsonic-root-loader.mjs", import.meta.url).pathname;
    const script = `import assert from "node:assert/strict";
      import { compileRust } from ${JSON.stringify(helper)};
      const { result } = compileRust({ files: { "index.ts": ${JSON.stringify(source)} } });
      assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_POINTER_POINTEE_CARRIER_NOT_PROVEN"));
      assert.equal(result.artifacts.length, 0);`;
    const result = spawnSync(process.execPath, ["--import", loader, "--input-type=module", "--eval", script], {
      encoding: "utf8", timeout: 20_000, maxBuffer: 1_048_576,
      env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=512" },
    });
    assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
  });
}

test("pointer recursion guards preserve nominal recursion and independent finite callable carriers", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
      import { allocatePointer, loadPointer } from "@tsonic/core/lang.js";
      import type { Pointer, uint32 } from "@tsonic/core/types.js";
      class Link { next: Link | undefined = undefined; }
      function link(): Pointer<Link> { return allocatePointer(new Link()); }
      function value(): uint32 { return 7; }
      function first(): Pointer<typeof value> { return allocatePointer(value); }
      function second(): Pointer<typeof value> { return allocatePointer(value); }
      export function main(): void {
        const item = loadPointer(link());
        const left = loadPointer(first());
        const right = loadPointer(second());
        if (item.next !== undefined || left() !== 7 || right() !== 7) throw new Error("pointer carrier recursion");
      }
    ` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("native-pointer-recursion-controls", result.artifacts, { run: true });
});

test("native array storage preserves strided element aliases and variable replacement", { timeout: 300_000 }, () => {
  const { result } = compileRust({ capabilities: [memoryAbiCapability("rust")],
    target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": nativeArrayProofSource } });
  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /NativeArray/u);
  validateGeneratedProject("native-array-aliases", result.artifacts, { run: true });
});

test("native field storage retains aliases, ordinary writes and object replacement", { timeout: 300_000 }, () => {
  const { result } = compileRust({ capabilities: [memoryAbiCapability("rust")],
    target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": nativeFieldProofSource } });
  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /allocate_native_location/u);
  validateGeneratedProject("native-field-aliases", result.artifacts, { run: true });
});

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
  ["conflicting array layouts", `import { addressOf } from "@tsonic/core/lang.js";
    const packed = memoryLayout<uint32>(abi, 4, 1, 4);
    export function expose(): void {
      const values: uint32[] = [1, 2];
      const alias = values;
      toRawPointer(addressOf(values[0]), word);
      toRawPointer(addressOf(alias[0]), packed);
    }`, "RUST_NATIVE_BACKING_NOT_PROVEN"],
  ["escaping array storage", `import { addressOf } from "@tsonic/core/lang.js";
    declare function escape(values: uint32[]): void;
    export function expose(): void {
      const values: uint32[] = [1];
      toRawPointer(addressOf(values[0]), word);
      escape(values);
    }`, "RUST_NATIVE_BACKING_NOT_PROVEN"],
  ["captured array storage", `import { addressOf } from "@tsonic/core/lang.js";
    export function expose(): void {
      const values: uint32[] = [1];
      toRawPointer(addressOf(values[0]), word);
      const read = () => values[0];
      read();
    }`, "RUST_NATIVE_BACKING_NOT_PROVEN"],
  ["conflicting object field layouts", `import { addressOf } from "@tsonic/core/lang.js";
    const packed = memoryLayout<uint32>(abi, 4, 1, 4);
    export function expose(): void {
      const cell: { value: uint32 } = { value: 1 };
      const alias = cell;
      toRawPointer(addressOf(cell.value), word);
      toRawPointer(addressOf(alias.value), packed);
    }`, "RUST_NATIVE_BACKING_NOT_PROVEN"],
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
