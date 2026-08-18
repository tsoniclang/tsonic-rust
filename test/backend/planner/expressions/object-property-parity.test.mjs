import assert from "node:assert/strict";
import { test } from "node:test";

import {
  acmeTestingPackage,
  artifactText,
  compileRust,
} from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

test("project index signatures and method properties execute through exact mutable storage", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "object_property_parity" },
    },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

interface Scores {
  [name: string]: int32;
}

interface Counter {
  value: int32;
  next(delta: int32): int32;
}

class ClassCounter implements Counter {
  value: int32;

  constructor(value: int32) {
    this.value = value;
  }

  next(delta: int32): int32 {
    this.value += delta;
    return this.value;
  }
}

export function main(): void {
  const scores: Scores = { first: 1, second: 2 };
  scores["third"] = 3;
  scores["first"] += 4;
  const copiedScores: Scores = { ...scores, fourth: 4 };
  check(scores["first"] === 5);
  check(copiedScores["second"] === 2);
  check(copiedScores["third"] === 3);
  check(copiedScores["fourth"] === 4);

  const concrete = new ClassCounter(10);
  const boundConcrete = concrete.next;
  check(boundConcrete(2) === 12);
  concrete.next = (delta: int32): int32 => {
    concrete.value += delta * 2;
    return concrete.value;
  };
  check(concrete.next(3) === 18);

  const counter: Counter = {
    value: 1,
    next(delta) {
      this.value += delta;
      return this.value;
    },
  };
  const boundInterface = counter.next;
  check(boundInterface(2) === 3);
  counter.next = (delta: int32): int32 => {
    counter.value += delta * 3;
    return counter.value;
  };
  check(counter.next(2) === 9);

  const spread: Counter = { ...counter, value: 20 };
  check(spread.next(1) === 12);
  const overridden: Counter = {
    ...counter,
    value: 30,
    next(delta) {
      this.value += delta;
      return this.value;
    },
  };
  check(overridden.next(2) === 32);
  check(counter.value === 12);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /HashMap<String, i32>/u);
  assert.match(source, /method_override/u);
  assert.match(source, /rt::Callable/u);
  assert.equal(
    validateGeneratedProject("object-property-parity", result.artifacts, { run: true }).status,
    0,
  );
});

test("method-property lowering rejects source operations without one closed callable ABI", () => {
  const generic = compileRust({
    files: {
      "index.ts": `
interface Identity {
  identity<T>(value: T): T;
}

export function read(identity: Identity): unknown {
  return identity.identity;
}
`,
    },
  }).result;
  assert.ok(generic.diagnostics.some(({ code }) =>
    code === "RUST_PROJECT_METHOD_CALLABLE_NOT_CLOSED"));

  const staticMethod = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

class Factory {
  static make(): int32 { return 1; }
}

export function read(): () => int32 {
  return Factory.make;
}
`,
    },
  }).result;
  assert.ok(staticMethod.diagnostics.some(({ code }) =>
    code === "RUST_STATIC_METHOD_PROPERTY_UNSUPPORTED"));
});

test("structural object-literal accessors preserve reads writes updates and this", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "object_accessor_parity" },
    },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

type MutableValue = { current: int32 };
type OptionalValue = Partial<MutableValue>;
type OptionalSnapshot = Readonly<OptionalValue>;

export function main(): void {
  let backing: int32 = 4;
  let writes: int32 = 0;
  const value = {
    get current(): int32 { return backing; },
    set current(next: int32) { backing = next; writes += 1; },
    get doubled(): int32 { return this.current * 2; },
  };
  check(value.current === 4);
  value.current += 3;
  check(value.current === 7);
  check(value.doubled === 14);
  check(writes === 1);

  const stored: MutableValue = { current: 2 };
  const contextual: MutableValue = {
    get current(): int32 { return backing; },
    set current(next: int32) { backing = next; writes += 1; },
  };
  check(stored.current === 2);
  check(contextual.current === 7);
  contextual.current = 9;
  check(contextual.current === 9);
  check(writes === 2);

  const optionalStored: OptionalValue = { current: 5 };
  const optionalEmpty: OptionalValue = {};
  const optionalSnapshot: OptionalSnapshot = {
    get current(): int32 { return backing; },
  };
  check((optionalStored.current ?? (0 as int32)) === 5);
  check((optionalSnapshot.current ?? (0 as int32)) === 9);
  check((optionalEmpty.current ?? (0 as int32)) === 0);
  check(writes === 2);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  const shapes = artifactText(result, "src/shapes.rs");
  assert.match(source, /record_getter/u);
  assert.match(source, /record_setter/u);
  assert.match(source, /property_getter/u);
  assert.match(source, /property_setter/u);
  assert.match(shapes, /rt::Callable/u);
  assert.equal(
    validateGeneratedProject("object-accessor-parity", result.artifacts, { run: true }).status,
    0,
  );
});

test("structural object-literal accessors reject incomplete native contracts", () => {
  const setterOnly = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
export function write(): void {
  const value = { set current(next: int32) {} };
  value.current = 1;
}
`,
    },
  }).result;
  assert.ok(setterOnly.diagnostics.some(({ code }) =>
    code === "RUST_OBJECT_LITERAL_SETTER_ONLY_UNSUPPORTED"));

  const optionalSetter = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
type MutableValue = { current: int32 };
type OptionalValue = Partial<MutableValue>;
export function write(): void {
  const value: OptionalValue = {
    get current(): int32 { return 1; },
    set current(next: int32) {},
  };
  value.current = 2;
}
`,
    },
  }).result;
  assert.ok(optionalSetter.diagnostics.some(({ code }) =>
    code === "RUST_STRUCTURAL_OPTIONAL_ACCESSOR_WRITE_UNSUPPORTED"));

});

test("nominal project fields dispatch stored and accessor implementations exactly", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "nominal_accessor_parity" },
    },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

interface Counter {
  current: int32;
  readonly doubled: int32;
}

class StoredCounter implements Counter {
  current: int32 = 3;
  get doubled(): int32 { return this.current * 2; }
}

function exercise(counter: Counter): void {
  check(counter.doubled === counter.current * 2);
  counter.current += 2;
}

export function main(): void {
  let backing: int32 = 4;
  const accessor: Counter = {
    get current(): int32 { return backing; },
    set current(value: int32) { backing = value; },
    get doubled(): int32 { return this.current * 2; },
  };
  exercise(accessor);
  check(backing === 6);
  check(accessor.doubled === 12);

  const stored: Counter = { current: 5, doubled: 10 };
  exercise(stored);
  check(stored.current === 7);
  check(stored.doubled === 10);

  const concrete = new StoredCounter();
  exercise(concrete);
  check(concrete.current === 5);
  check(concrete.doubled === 10);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /property_getter/u);
  assert.match(source, /property_setter/u);
  assert.match(source, /TsonicResult/u);
  assert.equal(
    validateGeneratedProject("nominal-accessor-parity", result.artifacts, { run: true }).status,
    0,
  );
});

test("optional structural methods preserve presence receiver identity spread and lazy arguments", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "optional_structural_methods" },
    },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

interface Counter {
  value: int32;
  read(): int32;
  add(delta: int32): int32;
}

type CounterPatch = Partial<Counter>;

export function main(): void {
  let evaluations: int32 = 0;
  const argument = (): int32 => {
    evaluations += 1;
    return 2;
  };
  const first: CounterPatch = {
    value: 4,
    read() { return this.value ?? 0; },
    add(delta) { return (this.value ?? 0) + delta; },
  };
  const second: CounterPatch = {
    value: 7,
    read() { return (this.value ?? 0) * 2; },
  };
  const empty: CounterPatch = {};
  const spread: CounterPatch = { ...first, value: 9 };

  check((first.read?.() ?? 0) === 4);
  check((first.read?.() ?? 0) === 4);
  check((second.read?.() ?? 0) === 14);
  check((spread.read?.() ?? 0) === 9);
  check((first.add?.(argument()) ?? 0) === 6);
  check(evaluations === 1);
  check((empty.add?.(argument()) ?? 0) === 0);
  check(evaluations === 1);
  check((empty.read?.() ?? 0) === 0);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  const shapes = artifactText(result, "src/shapes.rs");
  assert.match(source, /let record_method = Some\(\s*rt::Callable/u);
  assert.match(source, /\.with\(\|state\| state\.read\.clone\(\)\)/u);
  assert.match(source, /\.as_ref\(\)\s*\.map\(\|optional_receiver\|/u);
  assert.match(shapes, /Option<rt::Callable/u);
  assert.equal(
    validateGeneratedProject("optional-structural-methods", result.artifacts, { run: true }).status,
    0,
  );
});

test("standalone structural method values fail at the exact receiver-binding boundary", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
interface Counter { value: int32; read(): int32; }
type CounterPatch = Partial<Counter>;
export function read(counter: CounterPatch): int32 {
  const detached = counter.read;
  return detached?.() ?? 0;
}
`,
    },
  });

  assert.ok(result.diagnostics.some(({ code }) =>
    code === "RUST_STRUCTURAL_METHOD_VALUE_UNSUPPORTED"));
});
