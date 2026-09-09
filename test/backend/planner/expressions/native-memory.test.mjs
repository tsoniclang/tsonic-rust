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

test("cross-file equivalent layouts preserve one native backing location", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    capabilities: [memoryAbiCapability("rust")],
    target: { id: "rust", options: { outputType: "bin" } },
    files: {
      "layout.ts": `
        import { abi } from "test:abi";
        import type { uint32 } from "@tsonic/core/types.js";
        import { memoryLayout } from "@tsonic/core/lang.js";
        export const remote = memoryLayout<uint32>(abi, 4, 4, 4);
      `,
      "index.ts": `
        import { abi } from "test:abi";
        import { remote } from "./layout.js";
        import type { uint32 } from "@tsonic/core/types.js";
        import { memoryLayout, addressOf, toRawPointer, reinterpretRawPointer, loadPointer,
          storePointer, equalPointer, equalRawPointer, unsafeContext } from "@tsonic/core/lang.js";
        const local = memoryLayout<uint32>(abi, 4, 4, 4);
        function run(): boolean {
          unsafeContext();
          let value: uint32 = 7;
          const pointer = addressOf(value);
          const first = toRawPointer(pointer, local);
          const second = toRawPointer(pointer, remote);
          const left = reinterpretRawPointer(first, local);
          const right = reinterpretRawPointer(second, remote);
          if (left === undefined || right === undefined) return false;
          storePointer(left, 9);
          if (value !== 9 || loadPointer(right) !== 9) return false;
          value = 17;
          return loadPointer(right) === 17 && equalPointer(pointer, left) && equalRawPointer(first, second);
        }
        export function main(): void { if (!run()) throw new Error("cross-file native aliasing"); }
      `,
    },
  });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(item => `${item.code}: ${item.message}`).join("\n"));
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /allocate_native_location/u);
  assert.match(output, /reinterpret_raw_location::<u32>/u);
  assert.doesNotMatch(output, /as \*mut|as \*const/u);
  validateGeneratedProject("native-cross-file-aliases", result.artifacts, { run: true });
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

test("huge fixed-array metadata observations erase before native value admission", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    capabilities: [memoryAbiCapability("rust")],
    target: { id: "rust", options: { outputType: "bin" } },
    files: {
      "layouts.ts": `
        import { abi } from "test:abi";
        import { memoryLayout, memoryArrayLayout } from "@tsonic/core/lang.js";
        export const empty = memoryLayout<{}>(abi, 0, 1, 0);
        export const remote = memoryArrayLayout(abi, 0, 1, 0, empty, 9007199254740993n);
      `,
      "index.ts": `
        import { abi } from "test:abi";
        import { empty, remote } from "./layouts.js";
        import { memoryArrayLayout, sizeOf, alignOf, strideOf } from "@tsonic/core/lang.js";
        import type { nativeUint } from "@tsonic/core/types.js";
        export function direct(): nativeUint {
          return sizeOf(memoryArrayLayout(abi, 0, 1, 0, empty, 9007199254740993n));
        }
        export function remoteSize(): nativeUint { return sizeOf(remote); }
        export function remoteAlignment(): nativeUint { return alignOf(remote); }
        export function remoteStride(): nativeUint { return strideOf(remote); }
        export function main(): void {
          if (direct() !== 0 || remoteSize() !== 0 || remoteAlignment() !== 1 || remoteStride() !== 0) {
            throw new Error("fixed-array metadata observation");
          }
        }
      `,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /pub fn direct\(\) -> usize \{\s*0usize\s*\}/u);
  for (const artifact of result.artifacts.filter(artifact => artifact.path.endsWith(".rs"))) {
    assert.doesNotMatch(artifact.text, /9007199254740993|memoryArrayLayout|NativeLayout|NativeArray/u);
  }
  assert.equal(validateGeneratedProject("huge-fixed-array-metadata", result.artifacts, { run: true }).status, 0);
});

for (const [name, declarations, selectedLayout, body, diagnostic, extent] of [
  ["direct fixed array", "", "array", "return reinterpretRawPointer(raw, array);",
    "RUST_RAW_LOCATION_NOT_PROVEN", "2"],
  ["nested fixed array", `
    const nested = memoryArrayLayout<FixedArray<uint32, 2>, 3>(abi, 24, 4, 24, array, 3);
  `, "nested", "return reinterpretRawPointer(raw, nested);", "RUST_RAW_LOCATION_NOT_PROVEN", "3"],
  ["record containing a fixed array", `
    interface Container { values: FixedArray<uint32, 2> }
    const record = memoryLayout<Container>(abi, 8, 4, 8,
      memoryField((value: Container) => value.values, 0, 4, array));
  `, "record", "return reinterpretRawPointer(raw, record);", "RUST_RAW_LOCATION_NOT_PROVEN", "2"],
  ["fixed-array physical backing", "", "array", `
    let values: FixedArray<uint32, 2> = [1, 2];
    return toRawPointer(addressOf(values), array);
  `, "RUST_NATIVE_BACKING_NOT_PROVEN", "2"],
  ["huge zero-sized fixed array", `
    const zero = memoryLayout<{}>(abi, 0, 1, 0);
    const huge = memoryArrayLayout<{}, 9007199254740993n>(abi, 0, 1, 0, zero, 9007199254740993n);
  `, "huge", "return reinterpretRawPointer(raw, huge);", "RUST_RAW_LOCATION_NOT_PROVEN", "9007199254740993"],
]) {
  test(`native physical layouts reject ${name} explicitly`, () => {
    const { result } = compileRust({
      capabilities: [memoryAbiCapability("rust")],
      files: { "index.ts": `
        import { abi } from "test:abi";
        import type { FixedArray, RawPointer, uint32 } from "@tsonic/core/types.js";
        import { memoryLayout, memoryArrayLayout, memoryField, addressOf, toRawPointer,
          reinterpretRawPointer, unsafeContext, sizeOf } from "@tsonic/core/lang.js";
        const word = memoryLayout<uint32>(abi, 4, 4, 4);
        const array = memoryArrayLayout<uint32, 2>(abi, 8, 4, 8, word, 2);
        ${declarations}
        export function size() { return sizeOf(${selectedLayout}); }
        export function expose(raw: RawPointer | undefined) {
          unsafeContext();
          ${body}
        }
      ` },
    });
    const message = `Rust native raw/backing storage does not support an inline fixed-array layout with exact extent ${extent}; no native array layout adapter is implemented.`;
    assert.ok(result.diagnostics.some(item => item.code === diagnostic && item.message === message),
      JSON.stringify(result.diagnostics));
    assert.deepEqual(result.artifacts, []);
  });
}
