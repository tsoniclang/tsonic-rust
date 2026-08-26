import assert from "node:assert/strict";
import { test } from "node:test";

import {
  artifactText,
  compileRust,
} from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("Rust provenance and volatile operations retain exact pointer carriers", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import { unsafeContext } from "@tsonic/core/lang.js";
import type { int32 } from "@tsonic/core/types.js";
import {
  constPointerFromExposedAddress,
  exposePointerAddress,
  mutPointerFromExposedAddress,
  readVolatile,
  writeVolatile,
} from "@tsonic/rust/lang.js";
import type { constPtr, mutPtr, usize } from "@tsonic/rust/types.js";

export function expose(pointer: constPtr<int32>): usize {
  return exposePointerAddress(pointer);
}

export function restore(address: usize): constPtr<int32> {
  return constPointerFromExposedAddress<int32>(address);
}

export function restoreMutable(address: usize): mutPtr<int32> {
  return mutPointerFromExposedAddress<int32>(address);
}

export function read(pointer: constPtr<int32>): int32 {
  return unsafeContext(readVolatile(pointer));
}

export function write(pointer: mutPtr<int32>, value: int32): void {
  unsafeContext(writeVolatile(pointer, value));
}

`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /pointer\.expose_provenance\(\)/u);
  assert.match(source, /std::ptr::with_exposed_provenance::<i32>\(address\)/u);
  assert.match(source, /std::ptr::with_exposed_provenance_mut::<i32>\(address\)/u);
  assert.match(source, /unsafe \{\s*std::ptr::read_volatile\(pointer\)\s*\}/u);
  assert.match(source, /unsafe \{\s*std::ptr::write_volatile\(pointer, value\)\s*\}/u);
  validateGeneratedProject("rust-pointer-provenance-and-volatile", result.artifacts);
});

test("volatile access does not inherit lexical unsafe permission from pointer type or provenance", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { readVolatile } from "@tsonic/rust/lang.js";
import type { constPtr } from "@tsonic/rust/types.js";

export function reject(pointer: constPtr<int32>): int32 {
  return readVolatile(pointer);
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some(({ code }) =>
    code === "RUST_NATIVE_POINTER_UNSAFE_CONTEXT_REQUIRED"));
});
