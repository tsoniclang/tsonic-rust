import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { compileRust, artifactText } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";
import { memoryAbiCapability, nativeLocationProofSource } from "../../../helpers/memory-abi.mjs";
import { nativeFieldProofSource, nativeArrayProofSource } from "../../../helpers/native-record-proof.mjs";

for (const [name, body] of [
  ["self", `export function make(): Pointer<typeof make> { return allocateptr<typeof make>(make); }`],
  ["mutual", `function first(): Pointer<typeof second> { return allocateptr<typeof second>(second); }
    export function second(): Pointer<typeof first> { return allocateptr<typeof first>(first); }`],
]) {
  test(`recursive pointer return carrier rejects ${name} without unbounded classification`, { timeout: 30_000 }, () => {
    const source = `import { allocateptr } from "@tsonic/core/lang.js";
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
      import { allocateptr, loadptr } from "@tsonic/core/lang.js";
      import type { Pointer, uint32 } from "@tsonic/core/types.js";
      class Link { next: Link | undefined = undefined; }
      function link(): Pointer<Link> { return allocateptr(new Link()); }
      function value(): uint32 { return 7; }
      function first(): Pointer<typeof value> { return allocateptr(value); }
      function second(): Pointer<typeof value> { return allocateptr(value); }
      export function main(): void {
        const item = loadptr(link());
        const left = loadptr(first());
        const right = loadptr(second());
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
  assert.match(output, /reinterpret_raw_location::<u32, rt::TsonicError>/u);
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
        import { memorylayout } from "@tsonic/core/lang.js";
        export const remote = memorylayout<uint32>({ datalayout: abi, bytesize: 4, bytealignment: 4, stride: 4, fields: [] });
      `,
      "index.ts": `
        import { abi } from "test:abi";
        import { remote } from "./layout.js";
        import type { uint32 } from "@tsonic/core/types.js";
        import { memorylayout, addressof, torawptr, reinterpretrawptr, loadptr,
          storeptr, equalptr, equalrawptr, unsafecontext } from "@tsonic/core/lang.js";
        const local = memorylayout<uint32>({ datalayout: abi, bytesize: 4, bytealignment: 4, stride: 4, fields: [] });
        function run(): boolean {
          unsafecontext();
          let value: uint32 = 7;
          const pointer = addressof(value);
          const first = torawptr(pointer, local);
          const second = torawptr(pointer, remote);
          const left = reinterpretrawptr(first, local);
          const right = reinterpretrawptr(second, remote);
          if (left === undefined || right === undefined) return false;
          storeptr(left, 9);
          if (value !== 9 || loadptr(right) !== 9) return false;
          value = 17;
          return loadptr(right) === 17 && equalptr(pointer, left) && equalrawptr(first, second);
        }
        export function main(): void { if (!run()) throw new Error("cross-file native aliasing"); }
      `,
    },
  });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(item => `${item.code}: ${item.message}`).join("\n"));
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /allocate_native_location/u);
  assert.match(output, /reinterpret_raw_location::<u32, rt::TsonicError>/u);
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
  ["conflicting array layouts", `import { addressof } from "@tsonic/core/lang.js";
    const packed = memorylayout<uint32>({ datalayout: abi, bytesize: 4, bytealignment: 1, stride: 4, fields: [] });
    export function expose(): void {
      const values: uint32[] = [1, 2];
      const alias = values;
      torawptr(addressof(values[0]), word);
      torawptr(addressof(alias[0]), packed);
    }`, "RUST_NATIVE_BACKING_NOT_PROVEN"],
  ["escaping array storage", `import { addressof } from "@tsonic/core/lang.js";
    declare function escape(values: uint32[]): void;
    export function expose(): void {
      const values: uint32[] = [1];
      torawptr(addressof(values[0]), word);
      escape(values);
    }`, "RUST_NATIVE_BACKING_NOT_PROVEN"],
  ["captured array storage", `import { addressof } from "@tsonic/core/lang.js";
    export function expose(): void {
      const values: uint32[] = [1];
      torawptr(addressof(values[0]), word);
      const read = () => values[0];
      read();
    }`, "RUST_NATIVE_BACKING_NOT_PROVEN"],
  ["conflicting object field layouts", `import { addressof } from "@tsonic/core/lang.js";
    const packed = memorylayout<uint32>({ datalayout: abi, bytesize: 4, bytealignment: 1, stride: 4, fields: [] });
    export function expose(): void {
      const cell: { value: uint32 } = { value: 1 };
      const alias = cell;
      torawptr(addressof(cell.value), word);
      torawptr(addressof(alias.value), packed);
    }`, "RUST_NATIVE_BACKING_NOT_PROVEN"],
  ["open caller", `export function expose(pointer: Pointer<uint32>) { return torawptr(pointer, word); }`, "RUST_NATIVE_BACKING_NOT_PROVEN"],
  ["conflicting inferred pointees", `import type { int32 } from "@tsonic/core/types.js"; export function expose(flag: boolean) { return flag ? allocateptr<uint32>(1) : allocateptr<int32>(2); }`, "RUST_MISSING_TARGET_FACT"],
  ["logical projection", `export function expose() { const pointer = allocateptr<uint32>(1); return torawptr(projectptr<uint32, uint32>(pointer, value => value, value => value), word); }`, "RUST_NATIVE_BACKING_NOT_PROVEN"],
  ["incompatible scalar size", `const wrong = memorylayout<uint32>({ datalayout: abi, bytesize: 8, bytealignment: 4, stride: 8, fields: [] }); export function expose(raw: RawPointer | undefined) { unsafecontext(); return reinterpretrawptr(raw, wrong); }`, "RUST_RAW_LOCATION_NOT_PROVEN"],
  ["unsafe context", `export function expose(raw: RawPointer | undefined): Pointer<uint32> | undefined { return reinterpretrawptr(raw, word); }`, "RUST_NATIVE_POINTER_UNSAFE_CONTEXT_REQUIRED"],
  ["invalid bit patterns", `const invalid = memorylayout<boolean>({ datalayout: abi, bytesize: 1, bytealignment: 1, stride: 1, fields: [] }); export function expose(raw: RawPointer | undefined) { unsafecontext(); return reinterpretrawptr(raw, invalid); }`, "RUST_RAW_LOCATION_NOT_PROVEN"],
]) {
  test(`native memory rejects ${name} without publishing artifacts`, () => {
    const { result } = compileRust({ capabilities: [memoryAbiCapability("rust")], files: { "index.ts": `
import { abi } from "test:abi";
import { memorylayout, torawptr, reinterpretrawptr, allocateptr, projectptr, unsafecontext } from "@tsonic/core/lang.js";
import type { Pointer, RawPointer, uint32 } from "@tsonic/core/types.js";
const word = memorylayout<uint32>({ datalayout: abi, bytesize: 4, bytealignment: 4, stride: 4, fields: [] });
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
        import { memorylayout, memoryarraylayout } from "@tsonic/core/lang.js";
        export const empty = memorylayout<{}>({ datalayout: abi, bytesize: 0, bytealignment: 1, stride: 0, fields: [] });
        export const remote = memoryarraylayout({ datalayout: abi, bytesize: 0, bytealignment: 1, stride: 0, elementlayout: empty, length: 9007199254740993n });
      `,
      "index.ts": `
        import { abi } from "test:abi";
        import { empty, remote } from "./layouts.js";
        import { memoryarraylayout, sizeof, alignof, strideof } from "@tsonic/core/lang.js";
        import type { nativeUint } from "@tsonic/core/types.js";
        export function direct(): nativeUint {
          return sizeof(memoryarraylayout({ datalayout: abi, bytesize: 0, bytealignment: 1, stride: 0, elementlayout: empty, length: 9007199254740993n }));
        }
        export function remoteSize(): nativeUint { return sizeof(remote); }
        export function remoteAlignment(): nativeUint { return alignof(remote); }
        export function remoteStride(): nativeUint { return strideof(remote); }
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
    assert.doesNotMatch(artifact.text, /9007199254740993|memoryarraylayout|NativeLayout|NativeArray/u);
  }
  assert.equal(validateGeneratedProject("huge-fixed-array-metadata", result.artifacts, { run: true }).status, 0);
});

for (const [name, declarations, selectedLayout, body, diagnostic, accepted] of [
  ["direct fixed array", "", "array", "return reinterpretrawptr(raw, array);",
    "RUST_RAW_LOCATION_NOT_PROVEN", true],
  ["nested fixed array", `
    const nested = memoryarraylayout<FixedArray<uint32, 2>, 3>({ datalayout: abi, bytesize: 24, bytealignment: 4, stride: 24, elementlayout: array, length: 3 });
  `, "nested", "return reinterpretrawptr(raw, nested);", "RUST_RAW_LOCATION_NOT_PROVEN", true],
  ["record containing a fixed array", `
    interface Container { values: FixedArray<uint32, 2> }
    const record = memorylayout<Container>({ datalayout: abi, bytesize: 8, bytealignment: 4, stride: 8,
      fields: [memoryfield({ select: (value: Container) => value.values, byteoffset: 0, bytealignment: 4, fieldlayout: array })] });
  `, "record", "return reinterpretrawptr(raw, record);", "RUST_RAW_LOCATION_NOT_PROVEN", false],
  ["fixed-array physical backing", "", "array", `
    let values: FixedArray<uint32, 2> = [1, 2];
    return torawptr(addressof(values), array);
  `, "RUST_NATIVE_BACKING_NOT_PROVEN", true],
  ["huge zero-sized fixed array", `
    const zero = memorylayout<{}>({ datalayout: abi, bytesize: 0, bytealignment: 1, stride: 0, fields: [] });
    const huge = memoryarraylayout<{}, 9007199254740993n>({ datalayout: abi, bytesize: 0, bytealignment: 1, stride: 0, elementlayout: zero, length: 9007199254740993n });
  `, "huge", "return reinterpretrawptr(raw, huge);", "RUST_RAW_LOCATION_NOT_PROVEN", false],
]) {
  test(`native physical layouts ${accepted ? "admit" : "reject unproved reference storage for"} ${name}`, () => {
    const { result } = compileRust({
      capabilities: [memoryAbiCapability("rust")],
      files: { "index.ts": `
        import { abi } from "test:abi";
        import type { FixedArray, RawPointer, uint32 } from "@tsonic/core/types.js";
        import { memorylayout, memoryarraylayout, memoryfield, addressof, torawptr,
          reinterpretrawptr, unsafecontext, sizeof } from "@tsonic/core/lang.js";
        const word = memorylayout<uint32>({ datalayout: abi, bytesize: 4, bytealignment: 4, stride: 4, fields: [] });
        const array = memoryarraylayout<uint32, 2>({ datalayout: abi, bytesize: 8, bytealignment: 4, stride: 8, elementlayout: word, length: 2 });
        ${declarations}
        export function size() { return sizeof(${selectedLayout}); }
        export function expose(raw: RawPointer | undefined) {
          unsafecontext();
          ${body}
        }
      ` },
    });
    if (accepted) {
      assert.deepEqual(result.diagnostics, []);
      assert.notEqual(result.artifacts.length, 0);
      return;
    }
    assert.ok(result.diagnostics.some(item => item.code === diagnostic && item.message.includes("all-bit-pattern")),
      JSON.stringify(result.diagnostics));
    assert.deepEqual(result.artifacts, []);
  });
}

test("huge zero-sized native arrays retain their exact extent without element loops", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    capabilities: [memoryAbiCapability("rust")],
    target: { id: "rust", options: { outputType: "bin", crateName: "huge_zero_array" } },
    files: { "index.ts": `
import { abi } from "test:abi";
import { allocateptr, loadptr, memoryarraylayout, memorylayout,
  reinterpretrawptr, storeptr, struct, torawptr, unsafecontext } from "@tsonic/core/lang.js";
const Empty = struct({});
type Empty = typeof Empty;
const empty = memorylayout<Empty>({ datalayout: abi, bytesize: 0, bytealignment: 1, stride: 0, fields: [] });
const huge = memoryarraylayout<Empty, 9007199254740993n>({ datalayout: abi, bytesize: 0, bytealignment: 1, stride: 0, elementlayout: empty, length: 9007199254740993n });
export function main(): void {
  unsafecontext();
  const origin = allocateptr<Empty>({});
  const raw = torawptr(origin, empty);
  const pointer = reinterpretrawptr(raw, huge);
  if (pointer === undefined) throw new Error("zero-sized pointer");
  const value = loadptr(pointer);
  storeptr(pointer, value);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /; 9007199254740993\]/u);
  assert.doesNotMatch(output, /array::from_fn|for index_/u);
  validateGeneratedProject("huge-zero-native-array", result.artifacts, { run: true });
});

test("native fixed-array layout identity retains count, stride and child signedness", async () => {
  const { rustNativeMemoryLayoutsEqual } = await import("../../../../dist/target-model/operations/native-memory.js");
  const { rustFixedArrayTargetType } = await import("../../../../dist/target-model/types/index.js");
  const scalar = { kind: "scalar", pointeeCarrier: { kind: "source-primitive", name: "uint32" },
    size: 4, alignment: 4, width: 64, littleEndian: true, fields: [] };
  const array = { kind: "array", pointeeCarrier: rustFixedArrayTargetType(scalar.pointeeCarrier, 2),
    size: 16, alignment: 4, width: 64, littleEndian: true, length: "2", stride: 8, element: scalar };
  assert.equal(rustNativeMemoryLayoutsEqual(array, structuredClone(array)), true);
  for (const change of [{ length: "3" }, { stride: 4 }, { element: { ...scalar, size: 8 } },
    { element: { ...scalar, pointeeCarrier: { kind: "source-primitive", name: "int32" } } }]) {
    assert.equal(rustNativeMemoryLayoutsEqual(array, { ...array, ...change }), false);
  }
});
