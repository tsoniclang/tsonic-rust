import assert from "node:assert/strict";
import { test } from "node:test";

import {
  artifactText,
  compileRust,
} from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

test("native pointer operations lower inside one explicit unsafe block", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import {
  loadNativePointer,
  offsetNativePointer,
  storeNativePointer,
  unsafeContext,
} from "@tsonic/core/lang.js";
import type { NativePointer, int32, nativeInt } from "@tsonic/core/types.js";

export function copy(
  source: NativePointer<int32>,
  destination: NativePointer<int32>,
  elementOffset: nativeInt,
): NativePointer<int32> {
  unsafeContext();
  storeNativePointer(destination, loadNativePointer(source));
  return offsetNativePointer(source, elementOffset);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /pub fn copy\(source: \*mut i32, destination: \*mut i32, elementOffset: isize\) -> \*mut i32/u);
  assert.match(source, /unsafe \{\s*\*destination = \*source;\s*source\.offset\(elementOffset\)\s*\}/u);
  assert.doesNotMatch(source, /loadNativePointer|offsetNativePointer|storeNativePointer|unsafeContext/u);
  validateGeneratedProject("explicit-safety-native-pointer-block", result.artifacts);
});

test("unsafe expressions and caller contracts remain independent Rust knobs", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import { loadNativePointer, safety, unsafeContext } from "@tsonic/core/lang.js";
import type { NativePointer, int32 } from "@tsonic/core/types.js";

export function read(pointer: NativePointer<int32>): int32 {
  return unsafeContext(loadNativePointer(pointer));
}

export function declaredUnsafe(value: int32): int32 {
  return value;
}

safety(declaredUnsafe).requiresUnsafe();
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /pub fn read\(pointer: \*mut i32\) -> i32 \{\s*unsafe \{ \*pointer \}\s*\}/u);
  assert.match(source, /pub unsafe fn declaredUnsafe\(value: i32\) -> i32/u);
  assert.doesNotMatch(source, /pub unsafe fn read/u);
  validateGeneratedProject("explicit-safety-independent-contracts", result.artifacts);
});

test("native pointer type existence does not imply lexical or caller unsafety", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { NativePointer, int32 } from "@tsonic/core/types.js";

export function pass(pointer: NativePointer<int32>): NativePointer<int32> {
  return pointer;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /pub fn pass\(pointer: \*mut i32\) -> \*mut i32/u);
  assert.doesNotMatch(source, /unsafe/u);
  validateGeneratedProject("explicit-safety-pointer-shape", result.artifacts);
});

test("Rust const and mutable pointer aliases preserve independent raw-pointer mutability", { timeout: 300_000 }, () => {
  const accepted = compileRust({
    files: {
      "index.ts": `
import type { constPtr, mutPtr, u8 } from "@tsonic/rust/types.js";

export function preserveConst(pointer: constPtr<u8>): constPtr<u8> {
  return pointer;
}

export function preserveMut(pointer: mutPtr<u8>): mutPtr<u8> {
  return pointer;
}

export function widen(pointer: mutPtr<u8>): constPtr<u8> {
  return pointer;
}
`,
    },
  });
  assert.deepEqual(accepted.result.diagnostics, []);
  const source = artifactText(accepted.result, "src/index.rs");
  assert.match(source, /pub fn preserveConst\(pointer: \*const u8\) -> \*const u8/u);
  assert.match(source, /pub fn preserveMut\(pointer: \*mut u8\) -> \*mut u8/u);
  assert.match(source, /pub fn widen\(pointer: \*mut u8\) -> \*const u8/u);
  validateGeneratedProject("explicit-safety-rust-pointer-mutability", accepted.result.artifacts);

  const rejected = compileRust({
    files: {
      "index.ts": `
import type { constPtr, mutPtr, u8 } from "@tsonic/rust/types.js";

export function narrow(pointer: constPtr<u8>): mutPtr<u8> {
  return pointer;
}
`,
    },
  }).result;
  assert.equal(rejected.artifacts.length, 0);
  assert.ok(rejected.diagnostics.some(({ code }) =>
    code === "RUST_RETURN_CARRIER_MISMATCH" ||
    code === "RUST_CONVERSION_UNSUPPORTED"));
});

test("native pointer operations fail closed without an explicit unsafe context", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import { loadNativePointer } from "@tsonic/core/lang.js";
import type { NativePointer, int32 } from "@tsonic/core/types.js";

export function reject(pointer: NativePointer<int32>): int32 {
  return loadNativePointer(pointer);
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.deepEqual(
    result.diagnostics.map(({ code, message }) => ({ code, message })),
    [{
      code: "RUST_NATIVE_POINTER_UNSAFE_CONTEXT_REQUIRED",
      message: "Rust native-pointer 'load' requires an explicit unsafeContext() source region.",
    }],
  );
});

test("unsafe declaration contracts never create lexical unsafe permission", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import { loadNativePointer, safety } from "@tsonic/core/lang.js";
import type { NativePointer, int32 } from "@tsonic/core/types.js";

export function read(pointer: NativePointer<int32>): int32 {
  return loadNativePointer(pointer);
}

safety(read).requiresUnsafe();
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.deepEqual(
    result.diagnostics.map(({ code, message }) => ({ code, message })),
    [{
      code: "RUST_NATIVE_POINTER_UNSAFE_CONTEXT_REQUIRED",
      message: "Rust native-pointer 'load' requires an explicit unsafeContext() source region.",
    }],
  );
});

test("safety facts follow aliases and do not match local same-spelled calls", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import { unsafeContext as exactUnsafe } from "@tsonic/core/lang.js";
import type { int32 } from "@tsonic/core/types.js";

function unsafeContext(value: int32): int32 { return value; }

export function exact(value: int32): int32 {
  return exactUnsafe(value);
}

export function local(value: int32): int32 {
  return unsafeContext(value);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /pub fn exact\(value: i32\) -> i32 \{\s*unsafe \{ value \}\s*\}/u);
  assert.match(source, /pub fn local\(value: i32\) -> i32 \{\s*unsafeContext\(value\)\s*\}/u);
});

test("unsupported safe declaration contracts fail at the Rust declaration boundary", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import { safety } from "@tsonic/core/lang.js";
import type { int32 } from "@tsonic/core/types.js";

export function selected(value: int32): int32 { return value; }
safety(selected).safe();
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.deepEqual(
    result.diagnostics.map(({ code, message }) => ({ code, message })),
    [{
      code: "RUST_SAFE_DECLARATION_TARGET_UNSUPPORTED",
      message: "Rust 'safe' is not an explicit modifier on ordinary function declarations; the selected source declaration has no Rust boundary where this contract can be emitted.",
    }],
  );
});

test("selected unsafe calls require their own explicit call-site context", () => {
  const rejected = compileRust({
    files: {
      "index.ts": `
import { safety } from "@tsonic/core/lang.js";
import type { int32 } from "@tsonic/core/types.js";

export function selected(value: int32): int32 { return value; }
safety(selected).requiresUnsafe();

export function rejected(value: int32): int32 {
  return selected(value);
}
`,
    },
  }).result;
  assert.equal(rejected.artifacts.length, 0);
  assert.deepEqual(
    rejected.diagnostics.map(({ code, message }) => ({ code, message })),
    [{
      code: "RUST_UNSAFE_OPERATION_CONTEXT_REQUIRED",
      message: "The selected Rust operation requires an explicit unsafeContext() source region at this use site.",
    }],
  );

  const accepted = compileRust({
    files: {
      "index.ts": `
import { safety, unsafeContext } from "@tsonic/core/lang.js";
import type { int32 } from "@tsonic/core/types.js";

export function selected(value: int32): int32 { return value; }
safety(selected).requiresUnsafe();

export function accepted(value: int32): int32 {
  return unsafeContext(selected(value));
}
`,
    },
  }).result;
  assert.deepEqual(accepted.diagnostics, []);
  const source = artifactText(accepted, "src/index.rs");
  assert.match(source, /pub unsafe fn selected\(value: i32\) -> i32/u);
  assert.match(source, /pub fn accepted\(value: i32\) -> i32 \{\s*unsafe \{ selected\(value\) \}\s*\}/u);
  validateGeneratedProject("explicit-safety-call-contract", accepted.artifacts);
});

test("method and constructor safety contracts map to their exact Rust function boundaries", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import { safety, unsafeContext } from "@tsonic/core/lang.js";
import type { int32 } from "@tsonic/core/types.js";

export class Box {
  value: int32;
  constructor(value: int32) { this.value = value; }
  read(): int32 { return this.value; }
}

safety<Box>().constructor().requiresUnsafe();
safety<Box>().method(box => box.read).requiresUnsafe();

export function inspect(value: int32): int32 {
  const instance = unsafeContext(new Box(value));
  return unsafeContext(instance.read());
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /pub unsafe fn new\(value: i32\) -> Box/u);
  assert.match(source, /pub unsafe fn read\(&self\) -> i32/u);
  assert.match(source, /let instance = unsafe \{ Box::new\(value\) \};/u);
  assert.match(source, /unsafe \{ instance\.clone\(\)\.read\(\) \}/u);
  validateGeneratedProject("explicit-safety-method-constructor", result.artifacts);
});

test("polymorphic constructor and dispatch safety remain exact Rust ABI contracts", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import { safety, unsafeContext } from "@tsonic/core/lang.js";
import type { int32 } from "@tsonic/core/types.js";

class Base {
  value: int32 = 1;
  read(): int32 { return this.value; }
}

class Derived extends Base {
  read(): int32 { return this.value + 1; }
}

safety<Base>().constructor().requiresUnsafe();
safety<Base>().method(value => value.read).requiresUnsafe();
safety<Derived>().method(value => value.read).requiresUnsafe();

export function inspect(): int32 {
  const value = unsafeContext(new Base());
  return unsafeContext(value.read());
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /pub unsafe fn new\(\) -> Base/u);
  assert.match(source, /unsafe fn __tsonic_virtual_/u);
  assert.match(source, /unsafe \{ Base::new\(\) \}/u);
  assert.match(source, /unsafe \{\n        \{\n            let __tsonic_dispatch_receiver/u);
  validateGeneratedProject("explicit-safety-polymorphic-contracts", result.artifacts);
});

test("polymorphic safety ABI mismatches fail closed", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import { safety } from "@tsonic/core/lang.js";
import type { int32 } from "@tsonic/core/types.js";

class Base {
  read(): int32 { return 1; }
}

class Derived extends Base {
  read(): int32 { return 2; }
}

safety<Base>().method(value => value.read).requiresUnsafe();
export function create(): Base { return new Derived(); }
`,
    },
  });
  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some(({ code }) =>
    code === "RUST_MISSING_TARGET_FACT"));
  assert.ok(result.diagnostics.some(({ message }) =>
    message.includes("does not preserve the exact contract Rust ABI")));
});

test("conflicting declaration safety contracts fail once at the exact declaration", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import { safety } from "@tsonic/core/lang.js";
import type { int32 } from "@tsonic/core/types.js";

export function selected(value: int32): int32 { return value; }
safety(selected).safe();
safety(selected).requiresUnsafe();
`,
    },
  });
  assert.equal(result.artifacts.length, 0);
  assert.deepEqual(
    result.diagnostics.map(({ code, message }) => ({ code, message })),
    [{
      code: "RUST_SAFETY_CONTRACT_CONFLICT",
      message: "One exact Rust declaration received conflicting finalized safe and requires-unsafe contracts.",
    }],
  );
});

test("field safety contracts fail because Rust fields have no unsafe declaration boundary", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import { safety } from "@tsonic/core/lang.js";
import type { int32 } from "@tsonic/core/types.js";

export class Box { value: int32 = 0; }
safety<Box>().property(box => box.value).requiresUnsafe();
`,
    },
  });
  assert.equal(result.artifacts.length, 0);
  assert.deepEqual(
    result.diagnostics.map(({ code, message }) => ({ code, message })),
    [{
      code: "RUST_SAFETY_APPLICATION_TARGET_UNSUPPORTED",
      message: "The selected source declaration has no emitted Rust function boundary that can carry an explicit unsafe contract.",
    }],
  );
});

test("accessor safety contracts remain independent at declarations and use sites", () => {
  const rejectedRead = compileRust({
    files: {
      "index.ts": `
import { safety } from "@tsonic/core/lang.js";
import type { int32 } from "@tsonic/core/types.js";

export class Value {
  private stored: int32 = 1;
  get current(): int32 { return this.stored; }
  set current(value: int32) { this.stored = value; }
}
safety<Value>().property(value => value.current).getter().requiresUnsafe();

export function read(value: Value): int32 { return value.current; }
`,
    },
  }).result;
  assert.deepEqual(
    rejectedRead.diagnostics.map(({ code, message }) => ({ code, message })),
    [{
      code: "RUST_UNSAFE_OPERATION_CONTEXT_REQUIRED",
      message: "The selected Rust operation requires an explicit unsafeContext() source region at this use site.",
    }],
  );

  const rejectedWrite = compileRust({
    files: {
      "index.ts": `
import { safety } from "@tsonic/core/lang.js";
import type { int32 } from "@tsonic/core/types.js";

export class Value {
  private stored: int32 = 1;
  get current(): int32 { return this.stored; }
  set current(value: int32) { this.stored = value; }
}
safety<Value>().property(value => value.current).setter().requiresUnsafe();

export function write(value: Value, next: int32): void { value.current = next; }
`,
    },
  }).result;
  assert.deepEqual(
    rejectedWrite.diagnostics.map(({ code, message }) => ({ code, message })),
    [{
      code: "RUST_UNSAFE_OPERATION_CONTEXT_REQUIRED",
      message: "The selected Rust operation requires an explicit unsafeContext() source region at this use site.",
    }],
  );

  const accepted = compileRust({
    files: {
      "index.ts": `
import { safety, unsafeContext } from "@tsonic/core/lang.js";
import type { int32 } from "@tsonic/core/types.js";

export class Value {
  private stored: int32 = 1;
  get current(): int32 { return this.stored; }
  set current(value: int32) { this.stored = value; }
}
safety<Value>().property(value => value.current).getter().requiresUnsafe();
safety<Value>().property(value => value.current).setter().requiresUnsafe();

export function read(value: Value): int32 {
  return unsafeContext(value.current);
}

export function write(value: Value, next: int32): void {
  unsafeContext();
  value.current = next;
}
`,
    },
  }).result;
  assert.deepEqual(accepted.diagnostics, []);
  const text = artifactText(accepted, "src/index.rs");
  assert.match(text, /unsafe fn __tsonic_read_[0-9]+_[0-9]+\(&self\) -> i32/u);
  assert.match(text, /unsafe fn __tsonic_write_[0-9]+_[0-9]+\(&self, value: i32\)/u);
  assert.match(text, /unsafe \{[\s\S]*__tsonic_read_/u);
  assert.match(text, /unsafe \{[\s\S]*__tsonic_write_/u);
});

test("native-pointer source aliases that collapse in TypeScript remain exact in Rust", () => {
  const mismatchedPointee = compileRust({
    files: {
      "index.ts": `
import { loadNativePointer, unsafeContext } from "@tsonic/core/lang.js";
import type { NativePointer, int32, uint8 } from "@tsonic/core/types.js";

export function read(pointer: NativePointer<int32>): uint8 {
  return unsafeContext(loadNativePointer<uint8>(pointer));
}
`,
    },
  }).result;
  assert.equal(mismatchedPointee.artifacts.length, 0);
  assert.ok(mismatchedPointee.diagnostics.some(({ code }) =>
    code === "RUST_NATIVE_POINTER_POINTEE_CONFLICT"));

  const mismatchedStore = compileRust({
    files: {
      "index.ts": `
import { storeNativePointer, unsafeContext } from "@tsonic/core/lang.js";
import type { NativePointer, int32, uint8 } from "@tsonic/core/types.js";

export function write(pointer: NativePointer<int32>, value: uint8): void {
  unsafeContext(storeNativePointer(pointer, value));
}
`,
    },
  }).result;
  assert.equal(mismatchedStore.artifacts.length, 0);
  assert.ok(mismatchedStore.diagnostics.some(({ code }) =>
    code === "RUST_NATIVE_POINTER_STORE_VALUE_CONFLICT"));
});

test("unsafe block permission ends exactly at the source block boundary", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import { loadNativePointer, unsafeContext } from "@tsonic/core/lang.js";
import type { NativePointer, int32 } from "@tsonic/core/types.js";

export function read(pointer: NativePointer<int32>): int32 {
  {
    unsafeContext();
    loadNativePointer(pointer);
  }
  return loadNativePointer(pointer);
}
`,
    },
  });
  assert.equal(result.artifacts.length, 0);
  assert.deepEqual(
    result.diagnostics.map(({ code, message }) => ({ code, message })),
    [{
      code: "RUST_NATIVE_POINTER_UNSAFE_CONTEXT_REQUIRED",
      message: "Rust native-pointer 'load' requires an explicit unsafeContext() source region.",
    }],
  );
});

test("incomplete safety builders are rejected instead of erased", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import { safety } from "@tsonic/core/lang.js";
import type { int32 } from "@tsonic/core/types.js";

export function selected(value: int32): int32 { return value; }
safety(selected);
`,
    },
  });
  assert.equal(result.artifacts.length, 0);
  assert.deepEqual(
    result.diagnostics.map(({ code, message }) => ({ code, message })),
    [{
      code: "RUST_SAFETY_MARKER_RUNTIME_POSITION_UNSUPPORTED",
      message: "Rust declaration safety markers must be complete standalone expression statements.",
    }],
  );
});
