import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acmeTestingPackage,
  acmeVectorsPackage,
  artifactText,
  assertRustTargetRejection,
  compileRust,
} from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

test("typed locations retain generic pointees and optional identity", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import { equalPointer, loadPointer, storePointer } from "@tsonic/core/lang.js";
import type { int32, Pointer } from "@tsonic/core/types.js";

export function replace<T>(pointer: Pointer<T>, value: T): T {
  storePointer(pointer, value);
  return loadPointer(pointer);
}

export function same<T>(
  left: Pointer<T> | undefined,
  right: Pointer<T> | undefined,
): boolean {
  return equalPointer(left, right);
}

export function bothMissing(): boolean {
  return equalPointer<int32>(undefined, undefined);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /pub fn replace<T>\(pointer: rt::Location<T>, value: T\) -> T/u);
  assert.match(output, /pointer\.store\(value\);\s*pointer\.load\(\)/u);
  assert.match(output, /pub fn same<T>\(left: Option<rt::Location<T>>, right: Option<rt::Location<T>>\) -> bool/u);
  assert.match(output, /rt::Location::<T>::same\(left\.as_ref\(\), right\.as_ref\(\)\)/u);
  assert.match(output, /rt::Location::<i32>::same\(None\.as_ref\(\), None\.as_ref\(\)\)/u);
  assert.doesNotMatch(output, /equalPointer|loadPointer|storePointer/u);
});

test("generated Rust locations preserve aliases and projected storage", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "typed_location_proof" },
    },
    files: {
      "index.ts": `
import {
  addressOf,
  allocatePointer,
  equalPointer,
  loadPointer,
  storePointer,
} from "@tsonic/core/lang.js";
import type { int32, Pointer } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

class Pair {
  left: int32;
  right: int32;

  constructor(left: int32, right: int32) {
    this.left = left;
    this.right = right;
  }

  incrementLeft(): void {
    this.left += 1;
  }

  addLeft(amount: int32): int32 {
    this.left += amount;
    return this.left;
  }
}

function increment(pointer: Pointer<int32>): void {
  storePointer(pointer, loadPointer(pointer) + 1);
}

function replace<T>(pointer: Pointer<T>, value: T): T {
  storePointer(pointer, value);
  return loadPointer(pointer);
}

function allocateGeneric<T>(value: T): Pointer<T> {
  return allocatePointer(value);
}

function updateParameter(value: int32): int32 {
  const pointer = addressOf(value);
  increment(pointer);
  return value;
}

export function main(): void {
  let local: int32 = 1;
  const alias = addressOf(local);
  local += 1;
  increment(alias);
  check(local === 3);
  check(loadPointer(alias) === 3);

  const allocated = allocateGeneric<int32>(40);
  check(replace(allocated, 41) === 41);

  let pair = new Pair(3, 4);
  const first = addressOf(pair.left);
  const firstAgain = addressOf(pair.left);
  storePointer(first, 5);
  check(pair.left === 5);
  check(loadPointer(firstAgain) === 5);
  check(equalPointer(first, firstAgain));
  pair.incrementLeft();
  check(loadPointer(first) === 6);
  check(pair.addLeft(pair.right) === 10);
  check(loadPointer(first) === 10);

  let values: int32[] = [6, 7];
  const second = addressOf(values[1]);
  values[1] += 1;
  check(loadPointer(second) === 8);
  check(!equalPointer(addressOf(values[0]), second));
  check(equalPointer<int32>(undefined, undefined));
  check(updateParameter(8) === 9);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /let local: rt::Location<i32> = rt::Location::allocate\(1\);/u);
  assert.match(output, /fn allocateGeneric<T: Clone \+ 'static>\(value: T\) -> rt::Location<T>/u);
  assert.match(output, /\.project_member\(/u);
  assert.match(output, /\.project_index\(/u);
  assert.match(output, /rt::Location::<i32>::same/u);
  const run = validateGeneratedProject("typed-location-proof-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("promoted storage preserves selected mutating provider receivers", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    surfaces: ["js"],
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "typed_location_provider_proof" },
    },
    files: {
      "index.ts": `
import { addressOf, loadPointer, storePointer } from "@tsonic/core/lang.js";
import type { int32, Pointer } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

function nextValue(values: Pointer<int32[]>, calls: Pointer<int32>): int32 {
  storePointer(calls, loadPointer(calls) + 1);
  check(loadPointer(values).length === 1);
  return 2;
}

export function main(): void {
  let values: int32[] = [1];
  const alias = addressOf(values);
  let argumentCalls: int32 = 0;
  const calls = addressOf(argumentCalls);
  values.push(nextValue(alias, calls));
  check(argumentCalls === 1);
  check(loadPointer(alias).length === 2);
  check(values.includes(2));
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const run = validateGeneratedProject(
    "typed-location-provider-proof-bin",
    result.artifacts,
    { run: true },
  );
  assert.equal(run.status, 0);
});

test("promoted storage preserves selected mutable provider arguments", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeVectorsPackage(), acmeTestingPackage()],
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "typed_location_provider_argument_proof" },
    },
    files: {
      "index.ts": `
import { addressOf, loadPointer } from "@tsonic/core/lang.js";
import { borrowMut } from "@tsonic/rust/lang.js";
import { Vector, scale } from "@acme/vectors";
import { check } from "@acme/testing";

export function main(): void {
  let value = new Vector(3, 4);
  const alias = addressOf(value);
  scale(borrowMut(value), 2);
  check(loadPointer(alias).x === 6);
  check(loadPointer(alias).y === 8);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const run = validateGeneratedProject(
    "typed-location-provider-argument-proof-bin",
    result.artifacts,
    { run: true },
  );
  assert.equal(run.status, 0);
});

test("multiple promoted mutable inputs require disjoint storage roots", { timeout: 300_000 }, () => {
  const distinct = compileRust({
    packages: [acmeVectorsPackage(), acmeTestingPackage()],
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "typed_location_disjoint_roots_proof" },
    },
    files: {
      "index.ts": `
import { addressOf, loadPointer } from "@tsonic/core/lang.js";
import { borrowMut } from "@tsonic/rust/lang.js";
import { Vector, mutateBoth } from "@acme/vectors";
import { check } from "@acme/testing";

export function main(): void {
  let left = new Vector(1, 2);
  let right = new Vector(3, 4);
  const leftAlias = addressOf(left);
  const rightAlias = addressOf(right);
  mutateBoth(borrowMut(left), borrowMut(right));
  check(loadPointer(leftAlias).x === 2);
  check(loadPointer(rightAlias).y === 5);
}
`,
    },
  });
  assert.deepEqual(distinct.result.diagnostics, []);
  const run = validateGeneratedProject(
    "typed-location-disjoint-roots-proof-bin",
    distinct.result.artifacts,
    { run: true },
  );
  assert.equal(run.status, 0);

  assertRustTargetRejection({
    packages: [acmeVectorsPackage()],
    files: {
      "index.ts": `
import { addressOf } from "@tsonic/core/lang.js";
import { borrowMut } from "@tsonic/rust/lang.js";
import { Vector, mutateBoth } from "@acme/vectors";

class Pair {
  left: Vector;
  right: Vector;

  constructor(left: Vector, right: Vector) {
    this.left = left;
    this.right = right;
  }
}

export function reject(): void {
  let pair = new Pair(new Vector(1, 2), new Vector(3, 4));
  addressOf(pair.left);
  addressOf(pair.right);
  mutateBoth(borrowMut(pair.left), borrowMut(pair.right));
}
`,
    },
  }, [{
    code: "RUST_UNSUPPORTED_AST",
    message: "One provider operation cannot hold multiple mutable Rust locations projected from the same promoted storage root. Node kind: KindPropertyAccessExpression.",
  }]);
});

test("unsupported typed-location contracts reject at the Rust target boundary", () => {
  const cases = [
    {
      operation: "hash-pointer",
      source: `
import { hashPointer } from "@tsonic/core/lang.js";
import type { int32, Pointer } from "@tsonic/core/types.js";
export function reject(pointer: Pointer<int32>): int32 {
  return hashPointer(pointer);
}
`,
    },
    {
      operation: "bind-pointer",
      source: `
import { bindPointer } from "@tsonic/core/lang.js";
import type { int32, Pointer } from "@tsonic/core/types.js";
export function reject(value: int32): Pointer<int32> {
  let storage = value;
  return bindPointer<int32>({}, () => storage, next => { storage = next; });
}
`,
    },
    {
      operation: "project-pointer",
      source: `
import { projectPointer } from "@tsonic/core/lang.js";
import type { int32, Pointer } from "@tsonic/core/types.js";
export function reject(pointer: Pointer<int32>): Pointer<int32> | undefined {
  return projectPointer<int32, int32>(pointer, value => value, value => value);
}
`,
    },
  ];

  for (const { operation, source } of cases) {
    assertRustTargetRejection({ files: { "index.ts": source } }, [{
      code: "RUST_TYPED_LOCATION_UNSUPPORTED",
      message: `Selected typed-location operation '${operation}' has no accepted safe Rust target contract.`,
    }]);
  }
});

test("typed-location storage outside the safe owned-root model fails closed", () => {
  assertRustTargetRejection({
    files: {
      "index.ts": `
import { addressOf } from "@tsonic/core/lang.js";
import type { int32 } from "@tsonic/core/types.js";

export class Box {
  value: int32 = 0;

  takeAddress(): void {
    addressOf(this.value);
  }
}
`,
    },
  }, [{
    code: "RUST_POINTER_STORAGE_NOT_REPRESENTABLE",
    message: "Selected address-of storage has no exact function-local variable or parameter root.",
  }]);
});

test("same-spelled project functions remain ordinary source calls", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

function loadPointer(value: int32): int32 {
  return value;
}

export function run(value: int32): int32 {
  return loadPointer(value);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /fn loadPointer\(value: i32\) -> i32/u);
  assert.match(output, /loadPointer\(value\)/u);
  assert.doesNotMatch(output, /rt::Location/u);
});
