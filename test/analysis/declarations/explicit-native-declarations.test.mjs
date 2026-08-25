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
