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

test("the complete explicit ownership operation family lowers without hidden transfers", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import {
  clone,
  load,
  move,
  mut,
  own,
  ref,
  replace,
  store,
  take,
} from "@tsonic/rust/lang.js";
import type { Owned } from "@tsonic/rust/types.js";

export function duplicate(value: Owned<string>): Owned<string> {
  return clone(value);
}

export function detach(value: Owned<string>): Owned<string> {
  return own(ref(value));
}

export function readCopy(value: Owned<int32>): int32 {
  return load(ref(value));
}

export function exchange(value: Owned<int32>, replacement: int32): int32 {
  const destination = mut(value);
  const previous = replace(destination, replacement);
  store(destination, 0);
  return move(previous);
}

export function reset(value: Owned<string>): Owned<string> {
  return take(mut(value));
}

export function resetAndReuse(value: Owned<string>): Owned<string> {
  const previous = take(mut(value));
  consume(move(previous));
  return move(value);
}

function consume(_value: Owned<string>): void {}

export function copyRemainsAvailable(value: Owned<int32>): int32 {
  const first = move(value);
  return first + move(value);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /pub fn duplicate\(value: String\) -> String \{\s*value\.clone\(\)\s*\}/u);
  assert.match(source, /pub fn detach\(value: String\) -> String \{\s*value\.to_owned\(\)\s*\}/u);
  assert.match(source, /pub fn read_copy\(value: i32\) -> i32 \{\s*value\s*\}/u);
  assert.match(source, /core::mem::replace\(destination, replacement\)/u);
  assert.match(source, /\*destination = 0/u);
  assert.match(source, /core::mem::take\(&mut value\)/u);
  assert.match(source, /pub fn reset_and_reuse\(mut value: String\) -> String/u);
  assert.match(source, /pub fn copy_remains_available\(value: i32\) -> i32/u);
  assert.doesNotMatch(source, /Rc<|Arc<|Mutex<|RefCell</u);
  validateGeneratedProject("explicit-native-ownership-operations", result.artifacts);
});

test("operations requiring a trait reject before planning when the exact proof is absent", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import { load, ref } from "@tsonic/rust/lang.js";
import type { Owned } from "@tsonic/rust/types.js";

export function reject(value: Owned<string>): string {
  return load(ref(value));
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(diagnosticCodes(result).includes("RUST_OWNERSHIP_MARKER_TRAIT_NOT_PROVEN"));
});

test("fixed projections are disjoint while dynamic indexes remain conservatively overlapping", { timeout: 300_000 }, () => {
  const accepted = compileRust({
    files: {
      "index.ts": `
import type { FixedArray } from "@tsonic/core/types.js";
import { mut, store } from "@tsonic/rust/lang.js";
import type { Owned } from "@tsonic/rust/types.js";

export function update(values: Owned<FixedArray<string, 2>>): void {
  const left = mut(values[0]);
  const right = mut(values[1]);
  store(left, "left");
  store(right, "right");
}
`,
    },
  }).result;
  assert.deepEqual(accepted.diagnostics, []);
  validateGeneratedProject("explicit-fixed-index-loans", accepted.artifacts);

  const rejected = compileRust({
    files: {
      "index.ts": `
import type { FixedArray, nativeUint } from "@tsonic/core/types.js";
import { mut, store } from "@tsonic/rust/lang.js";
import type { Owned } from "@tsonic/rust/types.js";

export function reject(
  values: Owned<FixedArray<string, 2>>,
  first: nativeUint,
  second: nativeUint,
): void {
  const left = mut(values[first]);
  const right = mut(values[second]);
  store(left, "left");
  store(right, "right");
}
`,
    },
  }).result;
  assert.equal(rejected.artifacts.length, 0);
  assert.ok(diagnosticCodes(rejected).includes("RUST_OVERLAPPING_LOANS"));
});

test("selected native mutable receivers use two-phase loans for argument reads but not argument mutation", { timeout: 300_000 }, () => {
  const accepted = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { Vec } from "@tsonic/rust/std/vec.js";

export function appendFirst(values: Vec<int32>): void {
  values.push(values[0]);
}

export function replaceFirst(values: Vec<int32>, value: int32): void {
  values[0] = value;
}
`,
    },
  }).result;
  assert.deepEqual(accepted.diagnostics, []);
  const source = artifactText(accepted, "src/index.rs");
  assert.match(source, /values\.push\(/u);
  assert.match(source, /values\[tsonic_rust_runtime::conversions::i32_to_usize\(0\)\?\] = value/u);
  validateGeneratedProject("explicit-two-phase-receiver-loan", accepted.artifacts);

  const rejected = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { Vec } from "@tsonic/rust/std/vec.js";

export function reject(values: Vec<int32>): void {
  values.push(values.pop()!);
}
`,
    },
  }).result;
  assert.equal(rejected.artifacts.length, 0);
  assert.ok(diagnosticCodes(rejected).some((code) =>
    code === "RUST_OVERLAPPING_LOANS" || code === "RUST_OPERATION_CONFLICTS_WITH_LIVE_LOAN"));
});

test("borrowed execution carriers retain named lifetimes across suspension", { timeout: 300_000 }, () => {
  const accepted = compileRust({
    files: {
      "index.ts": `
import type { Life, Ref } from "@tsonic/rust/types.js";

async function pause(): Promise<void> {}

export async function preserve<L extends Life>(value: Ref<string, L>): Promise<Ref<string, L>> {
  await pause();
  return value;
}

export function* values<L extends Life>(
  value: Ref<string, L>,
): Generator<Ref<string, L>, void, void> {
  yield value;
}

export async function* asyncValues<L extends Life>(
  value: Ref<string, L>,
): AsyncGenerator<Ref<string, L>, void, void> {
  yield value;
}
`,
    },
  }).result;
  assert.deepEqual(accepted.diagnostics, []);
  const source = artifactText(accepted, "src/index.rs");
  assert.match(source, /BorrowedGenerator<'l,/u);
  assert.match(source, /BorrowedAsyncGenerator<'l,/u);
  validateGeneratedProject("explicit-borrowed-suspension-carriers", accepted.artifacts);

  const rejected = compileRust({
    files: {
      "index.ts": `
import { ref } from "@tsonic/rust/lang.js";
import type { Owned, Ref } from "@tsonic/rust/types.js";

function inspect(_value: Ref<string>): void {}
async function pause(): Promise<void> {}

export async function reject(value: Owned<string>): Promise<void> {
  const held = ref(value);
  await pause();
  inspect(held);
}
`,
    },
  }).result;
  assert.equal(rejected.artifacts.length, 0);
  assert.ok(diagnosticCodes(rejected).includes("RUST_SELF_REFERENTIAL_LOAN_ACROSS_SUSPENSION"));
});
