import assert from "node:assert/strict";
import { test } from "node:test";

import {
  acmeTestingPackage,
  compileRust,
} from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

function compileExecutable(source, crateName) {
  return compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName } },
    files: { "index.ts": source },
  });
}

test("explicit derived constructors select an implicit base constructor by checker signature", { timeout: 300_000 }, () => {
  const { result } = compileExecutable(`
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

class Base {
  value: int32 = 7;
}

class Derived extends Base {
  constructor() {
    super();
  }
}

export function main(): void {
  check(new Derived().value === 7);
}
`, "rust_implicit_base_constructor_proof");

  assert.deepEqual(result.diagnostics, []);
  const run = validateGeneratedProject("implicit-base-constructor", result.artifacts, { run: true });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});

test("implicit derived constructors forward exact inherited generic and default parameters", { timeout: 300_000 }, () => {
  const { result } = compileExecutable(`
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

class Base<T> {
  value: T;
  count: int32;

  constructor(value: T, count: int32 = 1) {
    this.value = value;
    this.count = count;
  }
}

class Derived extends Base<string> {
  label: string = "derived";
}

export function main(): void {
  const first = new Derived("one");
  const second = new Derived("two", 2);
  check(first.value === "one");
  check(first.count === 1);
  check(first.label === "derived");
  check(second.value === "two");
  check(second.count === 2);
}
`, "rust_implicit_derived_constructor_proof");

  assert.deepEqual(result.diagnostics, []);
  const run = validateGeneratedProject("implicit-derived-constructor", result.artifacts, { run: true });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});

test("generated project dispatch names cannot collide with authored declarations", { timeout: 300_000 }, () => {
  const { result } = compileExecutable(`
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

class __TsonicDispatch_Counter {
  marker: int32 = 1;
}

class __TsonicRoot_Counter {
  marker: int32 = 2;
}

class Counter {
  value: int32;
  constructor(value: int32) { this.value = value; }
  static new(): int32 { return 6; }
  static __tsonic_initialize(): int32 { return 7; }
  read(): int32 { return this.value; }
}

class DerivedCounter extends Counter {
  constructor(value: int32) { super(value); }
  read(): int32 { return super.read() + 1; }
}

export function main(): void {
  const value: Counter = new DerivedCounter(4);
  check(value.read() === 5);
  check(Counter.new() === 6);
  check(Counter.__tsonic_initialize() === 7);
  check(new __TsonicDispatch_Counter().marker === 1);
  check(new __TsonicRoot_Counter().marker === 2);
}
`, "rust_generated_project_name_hygiene_proof");

  assert.deepEqual(result.diagnostics, []);
  const run = validateGeneratedProject("generated-project-name-hygiene", result.artifacts, { run: true });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});

test("three-level dispatch preserves constructor order, exact super calls, and interface diamonds", { timeout: 300_000 }, () => {
  const { result } = compileExecutable(`
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

let order = "";
function mark(value: string): string {
  order += value;
  return value;
}

interface Named {
  name: string;
  describe(): string;
}
interface Tagged extends Named { tag: string; }
interface Counted extends Named { count: int32; }
interface Complete extends Tagged, Counted {}

class Base {
  name: string = mark("base-field;");
  constructor() { this.name = mark("base-body;"); }
  describe(): string { return "base:" + this.name; }
}

class Middle extends Base {
  tag: string = mark("middle-field;");
  constructor() {
    super();
    this.tag = mark("middle-body;");
  }
  describe(): string { return "middle>" + super.describe(); }
}

class Leaf extends Middle implements Complete {
  count: int32;
  constructor(count: int32) {
    super();
    this.count = count;
  }
  describe(): string { return "leaf>" + super.describe(); }
}

export function main(): void {
  const leaf = new Leaf(3);
  const base: Base = leaf;
  const complete: Complete = leaf;
  const named: Named = complete;
  check(base === leaf);
  check(complete === leaf);
  check(named === leaf);
  check(base.describe() === "leaf>middle>base:base-body;");
  check(complete.tag === "middle-body;");
  check(complete.count === 3);
  check(order === "base-field;base-body;middle-field;middle-body;");
  check(new Leaf(3) !== leaf);
}
`, "rust_deep_project_dispatch_proof");

  assert.deepEqual(result.diagnostics, []);
  const run = validateGeneratedProject("deep-project-dispatch", result.artifacts, { run: true });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});

test("polymorphic generic methods close exact selected Rust dispatch specializations", { timeout: 300_000 }, () => {
  const { result } = compileExecutable(`
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

class Base {
  calls: int32 = 0;
  identity<T>(value: T): T {
    this.calls += 1;
    return value;
  }
}
class Derived extends Base {
  identity<U>(value: U): U {
    this.calls += 10;
    return value;
  }
}

export function main(): void {
  const value: Base = new Derived();
  check(value.identity<string>("selected") === "selected");
  check(value.identity<int32>(7) === 7);
  check(value.calls === 20);
}
`, "rust_generic_virtual_dispatch_proof");

  assert.deepEqual(result.diagnostics, []);
  const output = result.artifacts.find((artifact) => artifact.path === "src/index.rs")?.text ?? "";
  assert.match(output, /dispatch_base_identity_specialization_1/u);
  assert.match(output, /dispatch_base_identity_specialization_2/u);
  assert.doesNotMatch(output, /fn dispatch_base_identity[^_]/u);
  const run = validateGeneratedProject("generic-virtual-dispatch", result.artifacts, { run: true });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});

test("generic interface dispatch and exact super calls share closed specializations", { timeout: 300_000 }, () => {
  const { result } = compileExecutable(`
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

interface Identity {
  identity<T>(value: T): T;
}

class Base {
  calls: int32 = 0;
  identity<T>(value: T): T {
    this.calls += 1;
    return value;
  }
}

class Derived extends Base implements Identity {
  identity<U>(value: U): U {
    this.calls += 10;
    return value;
  }

  baseString(value: string): string {
    return super.identity<string>(value);
  }
}

export function main(): void {
  const concrete = new Derived();
  const identity: Identity = concrete;
  check(identity.identity<string>("interface") === "interface");
  check(concrete.baseString("base") === "base");
  check(concrete.calls === 11);
}
`, "rust_generic_interface_dispatch_proof");

  assert.deepEqual(result.diagnostics, []);
  const output = result.artifacts.find((artifact) => artifact.path === "src/index.rs")?.text ?? "";
  assert.match(output, /dispatch_identity_identity_specialization_1/u);
  assert.match(output, /exact_base_identity_specialization_1/u);
  const run = validateGeneratedProject("generic-interface-dispatch", result.artifacts, { run: true });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});
