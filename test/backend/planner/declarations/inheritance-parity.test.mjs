import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acmeTestingPackage,
  artifactText,
  compileRust,
} from "../../../helpers/rust-session.mjs";
import { rustModuleNameForSourcePath } from "../../../../dist/analysis/program/source-output-identities.js";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

function compileExecutable(files, crateName) {
  return compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName } },
    files,
  });
}

test("project class heritage preserves inherited state, construction, and virtual dispatch", { timeout: 300_000 }, () => {
  const { result } = compileExecutable({
    "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

class Counter {
  value: int32;

  constructor(value: int32) {
    this.value = value;
  }

  add(delta: int32): int32 {
    this.value += delta;
    return this.value;
  }

  label(): string {
    return "base";
  }
}

class SteppedCounter extends Counter {
  step: int32;

  constructor(value: int32, step: int32) {
    super(value);
    this.step = step;
  }

  add(delta: int32): int32 {
    return super.add(delta * this.step);
  }

  label(): string {
    return "derived";
  }
}

function readBase(counter: Counter): string {
  return counter.label();
}

export function main(): void {
  const counter = new SteppedCounter(10, 3);
  const base: Counter = counter;
  check(base === counter);
  check(base.add(2) === 16);
  check(counter.value === 16);
  check(readBase(counter) === "derived");
}
`,
  }, "rust_inheritance_dispatch_proof");

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.equal(source.match(/let project_this = SteppedCounter \{/gu)?.length ?? 0, 1);
  assert.equal(source.match(/String::from\("derived"\)/gu)?.length ?? 0, 1);
  assert.match(
    source,
    /fn dispatch_stepped_counter_add[\s\S]*SteppedCounterRoot::exact_stepped_counter_add\(self, delta\)/u,
  );
  const run = validateGeneratedProject("inheritance-dispatch", result.artifacts, { run: true });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});

test("project interfaces retain exact implementation identity and inherited contracts", { timeout: 300_000 }, () => {
  const { result } = compileExecutable({
    "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

interface Named {
  name: string;
  describe(): string;
}

interface CountedNamed extends Named {
  count: int32;
}

class Item implements CountedNamed {
  name: string;
  count: int32;

  constructor(name: string, count: int32) {
    this.name = name;
    this.count = count;
  }

  describe(): string {
    return this.name;
  }
}

function describe(value: Named): string {
  return value.describe();
}

export function main(): void {
  const item = new Item("ready", 2);
  const counted: CountedNamed = item;
  const named: Named = counted;
  check(named === item);
  check(named.name === "ready");
  check(counted.count === 2);
  check(describe(item) === "ready");
}
`,
  }, "rust_interface_dispatch_proof");

  assert.deepEqual(result.diagnostics, []);
  const run = validateGeneratedProject("interface-dispatch", result.artifacts, { run: true });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});

test("generic and transitive heritage preserves exact selected type arguments", { timeout: 300_000 }, () => {
  const { result } = compileExecutable({
    "index.ts": `
import { check } from "@acme/testing";

interface Named<T> {
  value: T;
}

class Box<T> {
  value: T;

  constructor(value: T) {
    this.value = value;
  }
}

class NamedBox<T> extends Box<T> implements Named<T> {
  constructor(value: T) {
    super(value);
  }
}

class StringBox extends NamedBox<string> {
  constructor(value: string) {
    super(value);
  }
}

function readBox(value: Box<string>): string {
  return value.value;
}

function readNamed(value: Named<string>): string {
  return value.value;
}

export function main(): void {
  const value = new StringBox("closed");
  check(readBox(value) === "closed");
  check(readNamed(value) === "closed");
}
`,
  }, "rust_generic_heritage_proof");

  assert.deepEqual(result.diagnostics, []);
  const run = validateGeneratedProject("generic-heritage", result.artifacts, { run: true });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});

test("project heritage closes across source modules independent of file order", () => {
  const { result } = compileRust({
    entryPoint: "a-consumer.ts",
    files: {
      "a-consumer.ts": `
import { Derived } from "./z-models.js";
export function create(): Derived { return new Derived("ready"); }
`,
      "z-models.ts": `
export class Base<T> {
  value: T;
  constructor(value: T) { this.value = value; }
}
export class Derived extends Base<string> {
  constructor(value: string) { super(value); }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const modelsModule = rustModuleNameForSourcePath("z-models.ts");
  const consumerModule = rustModuleNameForSourcePath("a-consumer.ts");
  assert.notEqual(modelsModule, undefined);
  assert.notEqual(consumerModule, undefined);
  assert.match(artifactText(result, `src/${modelsModule}.rs`), /struct Derived/u);
  assert.match(artifactText(result, `src/${consumerModule}.rs`), /Derived::new/u);
});

test("inherited method bodies retain lexical bindings when emitted for a derived module", { timeout: 300_000 }, () => {
  const { result } = compileExecutable({
    "base.ts": `
import type { int32 } from "@tsonic/core/types.js";

export class Base {
  format(input: string, count: int32): string {
    const separator = ":";
    const value = input + separator;
    let index: int32 = 0;
    let output = "";
    while (index < count) {
      output += value;
      index += 1;
    }
    return output;
  }
}
`,
    "derived.ts": `
import { Base } from "./base.js";

export class Derived extends Base {}
`,
    "index.ts": `
import { check } from "@acme/testing";
import { Derived } from "./derived.js";

export function main(): void {
  const value = new Derived();
  check(value.format("x", 2) === "x:x:");
}
`,
  }, "rust_inherited_lexical_binding_proof");

  assert.deepEqual(result.diagnostics, []);
  const derivedModule = rustModuleNameForSourcePath("derived.ts");
  assert.notEqual(derivedModule, undefined);
  const derived = artifactText(result, `src/${derivedModule}.rs`);
  assert.doesNotMatch(derived, /crate::base::(?:input|count|separator|value|index|output)/u);
  const run = validateGeneratedProject("inherited-lexical-binding", result.artifacts, { run: true });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});
