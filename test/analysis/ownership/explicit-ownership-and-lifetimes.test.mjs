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

test("exact Rust ownership markers support direct, aliased, namespace, and re-exported use", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "ownership.ts": `
export { ref as borrowed } from "@tsonic/rust/lang.js";
`,
      "index.ts": `
import { borrowed } from "./ownership.js";
import * as rustOps from "@tsonic/rust/lang.js";
import type { Owned, Ref, Mut } from "@tsonic/rust/types.js";
import type { int32 } from "@tsonic/core/types.js";

function inspect(_value: Ref<string>): void {}
function update(_value: Mut<string>): void {}
function consume(_value: Owned<string>): void {}

function ref(value: int32): int32 {
  return value + 1;
}

export function exercise(mutText: Owned<string>): int32 {
  inspect(borrowed(mutText));
  inspect(rustOps.ref("temporary"));
  update(rustOps.mut(mutText));
  consume(rustOps.move(mutText));
  return ref(4);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /fn inspect\([^)]*: &str\)/u);
  assert.match(source, /fn update\([^)]*: &mut str\)/u);
  assert.match(source, /fn consume\([^)]*: String\)/u);
  assert.match(source, /inspect\(&mut_text\)/u);
  assert.match(source, /inspect\(&String::from\("temporary"\)\)/u);
  assert.match(source, /update\(&mut mut_text\)/u);
  assert.match(source, /consume\(mut_text\)/u);
  assert.match(source, /ref_?\(4\)/u);
  assert.doesNotMatch(source, /rustOps|borrowed\(|captureMove/u);
  validateGeneratedProject("explicit-rust-ownership-marker-identity", result.artifacts);
});

test("owned values require explicit transfer and reject use after the exact move", () => {
  const unmarked = compileRust({
    files: {
      "index.ts": `
import type { Owned } from "@tsonic/rust/types.js";

function consume(_value: Owned<string>): void {}

export function reject(value: Owned<string>): void {
  consume(value);
}
`,
    },
  }).result;
  assert.equal(unmarked.artifacts.length, 0);
  assert.ok(diagnosticCodes(unmarked).includes("RUST_OWNERSHIP_MARKER_MISMATCH"));

  const movedTwice = compileRust({
    files: {
      "index.ts": `
import { move } from "@tsonic/rust/lang.js";
import type { Owned } from "@tsonic/rust/types.js";

function consume(_value: Owned<string>): void {}

export function reject(value: Owned<string>): void {
  consume(move(value));
  consume(move(value));
}
`,
    },
  }).result;
  assert.equal(movedTwice.artifacts.length, 0);
  assert.ok(diagnosticCodes(movedTwice).includes("RUST_USE_AFTER_MOVE"));
});

test("named lifetime, outlives, and type-outlives contracts emit exact Rust generics", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type {
  Life,
  Outlives,
  Ref,
  ValidFor,
} from "@tsonic/rust/types.js";

export function choose<
  A extends Life,
  B extends Life & Outlives<A>,
>(left: Ref<string, A>, _right: Ref<string, B>): Ref<string, A> {
  return left;
}

export function hold<L extends Life, T extends ValidFor<L>>(
  value: Ref<T, L>,
): Ref<T, L> {
  return value;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /pub fn choose<'a, 'b: 'a>\(left: &'a str, _right: &'b str\) -> &'a str/u);
  assert.match(source, /pub fn hold<'l, T: 'l>\(value: &'l T\) -> &'l T/u);
  validateGeneratedProject("explicit-rust-lifetime-contracts", result.artifacts);
});

test("source-authored higher-ranked callable lifetimes retain their own binder", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { Life, Ref } from "@tsonic/rust/types.js";

type Visitor<T> = <L extends Life>(value: Ref<T, L>) => void;

export function invoke<T>(value: Ref<T>, visitor: Visitor<T>): void {
  visitor(value);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /visitor: impl for<'l> Fn\(&'l T\)/u);
  validateGeneratedProject("explicit-rust-higher-ranked-callable", result.artifacts);

  const unsupported = compileRust({
    files: {
      "index.ts": `
type TypeGenericCallable = <T>(value: T) => void;

export function reject(callback: TypeGenericCallable): void {
  callback(1);
}
`,
    },
  }).result;
  assert.equal(unsupported.artifacts.length, 0);
});

test("const parameters preserve exact integer, boolean, and Rust char scalar domains", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type {
  bool as rustBool,
  char as rustChar,
  Const,
  FnPtr,
  usize,
} from "@tsonic/rust/types.js";

export function first<N extends Const<usize>>(
  value: int32,
): int32 {
  return value;
}

export function preserve(
  callback: FnPtr<[int32], int32, "C", true, false>,
): FnPtr<[int32], int32, "C", true, false> {
  return callback;
}

export function booleanConst<Enabled extends Const<rustBool>>(value: rustBool): rustBool {
  return value;
}

export function charConst<Separator extends Const<rustChar>>(value: rustChar): rustChar {
  return value;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /pub fn first<const N: usize>\(value: i32\) -> i32/u);
  assert.match(source, /pub fn preserve\(callback: unsafe extern "C" fn\(i32\) -> i32\) -> unsafe extern "C" fn\(i32\) -> i32/u);
  assert.match(source, /pub fn boolean_const<const ENABLED: bool>\(value: bool\) -> bool/u);
  assert.match(source, /pub fn char_const<const SEPARATOR: char>\(value: char\) -> char/u);
  validateGeneratedProject("explicit-rust-const-and-function-pointer-contracts", result.artifacts);

  const rejected = compileRust({
    files: {
      "index.ts": `
import type { Const } from "@tsonic/rust/types.js";

export function invalid<Value extends Const<string>>(value: string): string {
  return value;
}
`,
    },
  }).result;
  assert.equal(rejected.artifacts.length, 0);
  assert.ok(diagnosticCodes(rejected).includes("RUST_SOURCE_CONST_PARAMETER_VALUE_INVALID"));
});

test("partial moves preserve disjoint tuple fields and reject a later whole-value read", { timeout: 300_000 }, () => {
  const accepted = compileRust({
    files: {
      "index.ts": `
import { move } from "@tsonic/rust/lang.js";
import type { Owned } from "@tsonic/rust/types.js";

function consume(_value: Owned<string>): void {}

export function sibling(pair: Owned<[string, string]>): string {
  consume(move(pair[0]));
  return move(pair[1]);
}
`,
    },
  }).result;
  assert.deepEqual(accepted.diagnostics, []);
  const source = artifactText(accepted, "src/index.rs");
  assert.match(source, /consume\(pair\.0\)/u);
  assert.match(source, /pair\.1/u);
  validateGeneratedProject("explicit-rust-partial-move", accepted.artifacts);

  const rejected = compileRust({
    files: {
      "index.ts": `
import { move } from "@tsonic/rust/lang.js";
import type { Owned } from "@tsonic/rust/types.js";

function consume(_value: Owned<string>): void {}

export function reject(pair: Owned<[string, string]>): Owned<[string, string]> {
  consume(move(pair[0]));
  return move(pair);
}
`,
    },
  }).result;
  assert.equal(rejected.artifacts.length, 0);
  assert.ok(diagnosticCodes(rejected).includes("RUST_USE_AFTER_MOVE"));
});

test("loans are non-lexical, field-sensitive, and exclusive only while live", { timeout: 300_000 }, () => {
  const accepted = compileRust({
    files: {
      "index.ts": `
import { mut, ref } from "@tsonic/rust/lang.js";
import type { Mut, Owned, Ref } from "@tsonic/rust/types.js";

function inspect(_value: Ref<string>): void {}
function update(_value: Mut<string>): void {}

export function sequential(value: Owned<string>): void {
  inspect(ref(value));
  update(mut(value));
}
`,
    },
  }).result;
  assert.deepEqual(accepted.diagnostics, []);
  validateGeneratedProject("explicit-rust-non-lexical-loans", accepted.artifacts);

  const rejected = compileRust({
    files: {
      "index.ts": `
import { mut, ref } from "@tsonic/rust/lang.js";
import type { Mut, Owned, Ref } from "@tsonic/rust/types.js";

function inspect(_value: Ref<string>): void {}
function update(_value: Mut<string>): void {}

export function reject(value: Owned<string>): void {
  const held = ref(value);
  update(mut(value));
  inspect(held);
}
`,
    },
  }).result;
  assert.equal(rejected.artifacts.length, 0);
  assert.ok(diagnosticCodes(rejected).some((code) =>
    code === "RUST_OVERLAPPING_LOANS" || code === "RUST_OPERATION_CONFLICTS_WITH_LIVE_LOAN"));
});

test("closure capture mode and closure-value transfer remain independent", { timeout: 300_000 }, () => {
  const accepted = compileRust({
    files: {
      "index.ts": `
import { captureMove, move } from "@tsonic/rust/lang.js";
import type { Owned } from "@tsonic/rust/types.js";
import type { FnOnce } from "@tsonic/rust/std/ops.js";

function runOnce(_callback: Owned<FnOnce<[], string>>): void {}

export function make(value: Owned<string>): void {
  const callback = captureMove((): string => move(value));
  runOnce(move(callback));
}
`,
    },
  }).result;
  assert.deepEqual(accepted.diagnostics, []);
  const source = artifactText(accepted, "src/index.rs");
  assert.match(source, /move \|\|/u);
  assert.match(source, /run_once\(callback\)/u);
  validateGeneratedProject("explicit-rust-capture-move", accepted.artifacts);

  const rejected = compileRust({
    files: {
      "index.ts": `
import { move } from "@tsonic/rust/lang.js";
import type { Owned } from "@tsonic/rust/types.js";

export function reject(value: Owned<string>): () => string {
  return (): string => move(value);
}
`,
    },
  }).result;
  assert.equal(rejected.artifacts.length, 0);
  assert.ok(diagnosticCodes(rejected).includes("RUST_NATIVE_CAPTURE_REQUIRES_EXPLICIT_MOVE"));
});

test("ordinary TypeScript aliasing remains automatic and separate from explicit native transfer", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
class Counter {
  value: number;

  constructor(value: number) {
    this.value = value;
  }
}

export function aliasing(): number {
  const original = new Counter(1);
  const alias = original;
  alias.value += 1;
  return original.value;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /LocalObjectHandle/u);
  assert.match(source, /\.clone\(\)/u);
  validateGeneratedProject("ordinary-typescript-aliasing-preserved", result.artifacts);
});
