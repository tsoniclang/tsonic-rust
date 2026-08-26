import assert from "node:assert/strict";
import { test } from "node:test";

import {
  artifactText,
  compileRust,
} from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

function diagnosticCodes(result) {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

test("unsafe traits and their project implementations require independent exact controls", { timeout: 300_000 }, () => {
  const accepted = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { rust } from "@tsonic/rust/lang.js";

export interface Trusted {
  check(value: int32): int32;
}

rust<Trusted>().unsafeTrait();

export class Token implements Trusted {
  check(value: int32): int32 {
    return value;
  }
}

rust<Token>().unsafeImpl<Trusted>();
`,
    },
  }).result;
  assert.deepEqual(accepted.diagnostics, []);
  const source = artifactText(accepted, "src/index.rs");
  assert.match(source, /pub unsafe trait Trusted/u);
  assert.match(source, /unsafe impl Trusted for Token/u);
  assert.doesNotMatch(source, /rust\(|unsafeTrait|unsafeImpl/u);
  validateGeneratedProject("explicit-unsafe-trait-and-impl", accepted.artifacts);

  const rejected = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { rust } from "@tsonic/rust/lang.js";

interface Trusted {
  check(value: int32): int32;
}
rust<Trusted>().unsafeTrait();

class Token implements Trusted {
  check(value: int32): int32 {
    return value;
  }
}
`,
    },
  }).result;
  assert.equal(rejected.artifacts.length, 0);
  assert.ok(diagnosticCodes(rejected).includes("RUST_DECLARATION_UNSAFE_PROJECT_IMPL_REQUIRED"));
});

test("native unions preserve multi-field ABI layout and require unsafe only for reads", { timeout: 300_000 }, () => {
  const accepted = compileRust({
    files: {
      "index.ts": `
import { unsafeContext } from "@tsonic/core/lang.js";
import type { float32, uint32 } from "@tsonic/core/types.js";
import { rust } from "@tsonic/rust/lang.js";

export class NumberBits {
  integer!: uint32;
  floating!: float32;
}

rust<NumberBits>().reprC().union();

export function writeInteger(bits: NumberBits, value: uint32): void {
  bits.integer = value;
}

export function readInteger(bits: NumberBits): uint32 {
  return unsafeContext(bits.integer);
}
`,
    },
  }).result;
  assert.deepEqual(accepted.diagnostics, []);
  const source = artifactText(accepted, "src/index.rs");
  assert.match(source, /#\[repr\(C\)\]\s*pub union NumberBits/u);
  assert.match(source, /pub integer: u32/u);
  assert.match(source, /pub floating: f32/u);
  assert.match(source, /bits\.integer = value/u);
  assert.match(source, /unsafe \{\s*bits\.integer\s*\}/u);
  assert.doesNotMatch(source, /impl Default for NumberBits|fn new\(/u);
  validateGeneratedProject("explicit-native-union", accepted.artifacts);

  const unsafeRead = compileRust({
    files: {
      "index.ts": `
import type { uint32 } from "@tsonic/core/types.js";
import { rust } from "@tsonic/rust/lang.js";

class NumberBits {
  integer!: uint32;
  second!: uint32;
}
rust<NumberBits>().union();

export function reject(bits: NumberBits): uint32 {
  return bits.integer;
}
`,
    },
  }).result;
  assert.equal(unsafeRead.artifacts.length, 0);
  assert.ok(diagnosticCodes(unsafeRead).includes("RUST_UNSAFE_OPERATION_CONTEXT_REQUIRED"));

  const constructed = compileRust({
    files: {
      "index.ts": `
import type { uint32 } from "@tsonic/core/types.js";
import { rust } from "@tsonic/rust/lang.js";

class NumberBits {
  integer!: uint32;
  second!: uint32;
}
rust<NumberBits>().union();

export function reject(): NumberBits {
  return new NumberBits();
}
`,
    },
  }).result;
  assert.equal(constructed.artifacts.length, 0);
  assert.ok(diagnosticCodes(constructed).includes("RUST_DECLARATION_UNION_CONSTRUCTION_UNSUPPORTED"));
});

test("layout controls remain independent and native Drop is an exact method contract", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { uint8, uint32 } from "@tsonic/core/types.js";
import { rust } from "@tsonic/rust/lang.js";

export class Header {
  tag!: uint8;
  value!: uint32;
}
rust<Header>().reprC().reprAlign(8);

export class Handle {
  value!: uint32;

  release(): void {
    this.value = 0;
  }
}
rust<Handle>().reprTransparent();
rust(Handle.prototype.release).drop();
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /#\[repr\(C, align\(8\)\)\]\s*pub struct Header/u);
  assert.match(source, /#\[repr\(transparent\)\]\s*pub struct Handle/u);
  assert.match(source, /impl Drop for Handle/u);
  assert.match(source, /fn drop\(&mut self\)/u);
  assert.doesNotMatch(source, /fn release\(/u);
  validateGeneratedProject("explicit-layout-and-drop-contracts", result.artifacts);
});

test("packed layout, mutable statics, and thread-local storage remain independent", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32, uint8, uint32 } from "@tsonic/core/types.js";
import { rust } from "@tsonic/rust/lang.js";

export class PackedHeader {
  tag!: uint8;
  value!: uint32;
}
rust<PackedHeader>().reprC().reprPacked(2);

export let nativeState: int32 = 1;
rust(nativeState).mutableStatic();

export let localState: int32 = 2;
rust(localState).threadLocal();
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /#\[repr\(C, packed\(2\)\)\]\s*pub struct PackedHeader/u);
  assert.match(source, /pub static mut native_state: i32 = 1;/u);
  assert.match(source, /std::thread_local! \{[\s\S]*pub static local_state: rt::ModuleCell<i32>/u);
  validateGeneratedProject("explicit-layout-and-storage-controls", result.artifacts);
});

test("foreign declaration safety is independent from ABI and follows the selected Rust edition", { timeout: 300_000 }, () => {
  const edition2024 = compileRust({
    target: { id: "rust", options: { edition: "2024" } },
    files: {
      "index.ts": `
import { safety } from "@tsonic/core/lang.js";
import type { int32 } from "@tsonic/core/types.js";
import { rust } from "@tsonic/rust/lang.js";

export declare function safeForeign(value: int32): int32;
export declare function unsafeForeign(value: int32): int32;
rust(safeForeign).extern("C");
rust(unsafeForeign).extern("C");
safety(unsafeForeign).requiresUnsafe();
`,
    },
  }).result;
  assert.deepEqual(edition2024.diagnostics, []);
  const source2024 = artifactText(edition2024, "src/index.rs");
  assert.match(source2024, /unsafe extern "C" \{[\s\S]*pub safe fn safe_foreign\(value: i32\) -> i32;/u);
  assert.match(source2024, /unsafe extern "C" \{[\s\S]*pub unsafe fn unsafe_foreign\(value: i32\) -> i32;/u);
  validateGeneratedProject("explicit-foreign-safety-rust-2024", edition2024.artifacts);

  const edition2021Unsafe = compileRust({
    target: { id: "rust", options: { edition: "2021" } },
    files: {
      "index.ts": `
import { safety } from "@tsonic/core/lang.js";
import type { int32 } from "@tsonic/core/types.js";
import { rust } from "@tsonic/rust/lang.js";

export declare function foreign(value: int32): int32;
rust(foreign).extern("C");
safety(foreign).requiresUnsafe();
`,
    },
  }).result;
  assert.deepEqual(edition2021Unsafe.diagnostics, []);
  const source2021 = artifactText(edition2021Unsafe, "src/index.rs");
  assert.match(source2021, /extern "C" \{[\s\S]*pub fn foreign\(value: i32\) -> i32;/u);
  assert.doesNotMatch(source2021, /pub safe fn|pub unsafe fn/u);
  validateGeneratedProject("explicit-foreign-safety-rust-2021", edition2021Unsafe.artifacts);

  const edition2021Safe = compileRust({
    target: { id: "rust", options: { edition: "2021" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { rust } from "@tsonic/rust/lang.js";

export declare function foreign(value: int32): int32;
rust(foreign).extern("C");
`,
    },
  }).result;
  assert.equal(edition2021Safe.artifacts.length, 0);
  assert.ok(edition2021Safe.diagnostics.some(({ code, message }) =>
    code === "RUST_UNSUPPORTED_AST" &&
    message.includes("Rust 2021 cannot express an independently safe foreign item")));
});

test("negative implementations fail closed unless the selected dialect proves the feature", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import { rust } from "@tsonic/rust/lang.js";

interface ThreadSafe {}
class LocalValue {}
rust<LocalValue>().negativeImpl<ThreadSafe>();
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(diagnosticCodes(result).includes("RUST_DECLARATION_NEGATIVE_IMPL_UNSTABLE"));
});

test("declaration controls never imply unrelated ABI, safety, or storage knobs", () => {
  const invalid = [
    {
      source: `
import { rust } from "@tsonic/rust/lang.js";
export function ordinary(value: number): number { return value; }
rust(ordinary).variadic();
`,
      code: "RUST_DECLARATION_VARIADIC_ABI_INVALID",
    },
    {
      source: `
import { rust } from "@tsonic/rust/lang.js";
export let state = 1;
rust(state).mutableStatic().threadLocal();
`,
      code: "RUST_DECLARATION_STORAGE_CONTROLS_CONFLICT",
    },
    {
      source: `
import { rust } from "@tsonic/rust/lang.js";
interface SafeTrait {}
class Value {}
rust<Value>().unsafeImpl<SafeTrait>();
`,
      code: "RUST_DECLARATION_SAFE_TRAIT_UNSAFE_IMPL_INVALID",
    },
  ];

  for (const { source, code } of invalid) {
    const result = compileRust({ files: { "index.ts": source } }).result;
    assert.equal(result.artifacts.length, 0);
    assert.ok(diagnosticCodes(result).includes(code), `${code}: ${diagnosticCodes(result).join(", ")}`);
  }
});
