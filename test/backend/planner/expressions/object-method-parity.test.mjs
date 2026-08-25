import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acmeTestingPackage,
  artifactText,
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

test("object literal methods preserve this, captures, identity, and recursive dispatch", { timeout: 300_000 }, () => {
  const { result } = compileExecutable(`
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

interface Counter {
  value: int32;
  next(delta: int32): int32;
  countdown(): int32;
}

export function main(): void {
  let captured: int32 = 10;
  const counter: Counter = {
    value: 1,
    next(delta) {
      captured += delta;
      this.value += delta;
      return captured + this.value;
    },
    countdown() {
      if (this.value === 0) {
        return captured;
      }
      this.value -= 1;
      return this.countdown();
    },
  };
  const alias = counter;
  check(alias === counter);
  check(alias.next(2) === 15);
  check(counter.value === 3);
  check(counter.countdown() === 12);
  check(counter.value === 0);
}
`, "rust_object_method_semantics");

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /ObjectLiteral/u);
  assert.equal(
    validateGeneratedProject("object-method-semantics", result.artifacts, { run: true }).status,
    0,
  );
});

test("object literal methods bind exact contextual declarations instead of same-spelled members", { timeout: 300_000 }, () => {
  const { result } = compileExecutable(`
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

interface NumericReader {
  read(): int32;
}

interface TextReader {
  read(): string;
}

export function main(): void {
  const numeric: NumericReader = { ["read"]() { return 7; } };
  const text: TextReader = { read() { return "seven"; } };
  check(numeric.read() === 7);
  check(text.read() === "seven");
}
`, "rust_object_method_identity");

  assert.deepEqual(result.diagnostics, []);
  assert.equal(
    validateGeneratedProject("object-method-identity", result.artifacts, { run: true }).status,
    0,
  );
});

test("object literal methods implement inherited interface contracts", { timeout: 300_000 }, () => {
  const { result } = compileExecutable(`
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

interface Readable {
  value: int32;
  read(): int32;
}

interface Counter extends Readable {
  add(delta: int32): int32;
}

export function main(): void {
  const counter: Counter = {
    value: 1,
    read() { return this.value; },
    add(delta) {
      this.value += delta;
      return this.read();
    },
  };
  const readable: Readable = counter;
  check(readable.read() === 1);
  check(counter.add(4) === 5);
  check(readable.read() === 5);
}
`, "rust_object_method_inheritance");

  assert.deepEqual(result.diagnostics, []);
  assert.equal(
    validateGeneratedProject("object-method-inheritance", result.artifacts, { run: true }).status,
    0,
  );
});

test("object literal generic methods close every selected dispatch specialization", { timeout: 300_000 }, () => {
  const { result } = compileExecutable(`
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

interface Identity {
  identity<T>(value: T): T;
}

export function main(): void {
  const identity: Identity = {
    identity<T>(value: T): T { return value; },
  };
  check(identity.identity<int32>(7) === 7);
  check(identity.identity<string>("seven") === "seven");
}
`, "rust_object_method_generics");

  assert.deepEqual(result.diagnostics, []);
  assert.equal(
    validateGeneratedProject("object-method-generics", result.artifacts, { run: true }).status,
    0,
  );
});

test("one object literal implementation adapts every exact overload ABI", { timeout: 300_000 }, () => {
  const { result } = compileExecutable(`
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

interface Parser {
  parse(value: string): string;
  parse(value: string, radix: int32): string;
}

export function main(): void {
  const parser: Parser = {
    parse(value: string, radix?: int32): string {
      return radix === undefined ? value : value + "-radix";
    },
  };
  check(parser.parse("seven") === "seven");
  check(parser.parse("seven", 2) === "seven-radix");
}
`, "rust_object_method_overloads");

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.equal((source.match(/method_implementation: rt::OwnedLocalCallable/gu) ?? []).length, 1);
  assert.equal((source.match(/\.method_implementation\.clone\(\)/gu) ?? []).length, 2);
  assert.match(source, /Some\(radix\)/u);
  assert.match(source, /None/u);
  assert.equal(
    validateGeneratedProject("object-method-overloads", result.artifacts, { run: true }).status,
    0,
  );
});

test("object literal overload adapters ignore surplus parameters and assemble rest values", { timeout: 300_000 }, () => {
  const { result } = compileExecutable(`
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

interface Reader {
  read(value: string): string;
  read(value: string, ignored: int32): string;
}

interface Joiner {
  join(): string;
  join(first: string): string;
  join(first: string, second: string): string;
}

export function main(): void {
  const reader: Reader = {
    read(value: string): string { return value; },
  };
  const joiner: Joiner = {
    join(...values: string[]): string {
      void values;
      return "joined";
    },
  };
  check(reader.read("one") === "one");
  check(reader.read("two", 2) === "two");
  check(joiner.join() === "joined");
  check(joiner.join("one") === "joined");
  check(joiner.join("one", "two") === "joined");
}
`, "rust_object_method_overload_shapes");

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /vec!\[\]/u);
  assert.match(source, /vec!\[first\]/u);
  assert.match(source, /vec!\[first, second\]/u);
  assert.equal(
    validateGeneratedProject("object-method-overload-shapes", result.artifacts, { run: true }).status,
    0,
  );
});

test("object literal generic implementation binders are alpha-equivalent to contract binders", { timeout: 300_000 }, () => {
  const { result } = compileExecutable(`
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

interface Identity {
  identity<ContractValue>(value: ContractValue): ContractValue;
}

export function main(): void {
  const identity: Identity = {
    identity<ImplementationValue>(value: ImplementationValue): ImplementationValue {
      return value;
    },
  };
  check(identity.identity<int32>(7) === 7);
  check(identity.identity<string>("seven") === "seven");
}
`, "rust_object_method_generic_alpha_equivalence");

  assert.deepEqual(result.diagnostics, []);
  assert.equal(
    validateGeneratedProject("object-method-generic-alpha-equivalence", result.artifacts, { run: true }).status,
    0,
  );
});

test("object literal method adapters preserve authored primitive carriers", { timeout: 300_000 }, () => {
  const { result } = compileExecutable(`
import type { float64, int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

interface Converter {
  convert(value: int32): int32;
}

export function main(): void {
  const converter: Converter = {
    convert(value: float64): float64 { return value; },
  };
  check(converter.convert(7) === 7);
}
`, "rust_object_method_carrier_adapters");

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /i32_to_f64/u);
  assert.match(source, /f64_to_i32/u);
  assert.equal(
    validateGeneratedProject("object-method-carrier-adapters", result.artifacts, { run: true }).status,
    0,
  );
});

test("object literal methods satisfy inherited contracts through exact redeclarations", { timeout: 300_000 }, () => {
  const { result } = compileExecutable(`
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

interface Readable {
  value: int32;
  read(): int32;
}

interface Counter extends Readable {
  value: int32;
  read(): int32;
  add(delta: int32): int32;
}

export function main(): void {
  const counter: Counter = {
    value: 2,
    read() { return this.value; },
    add(delta) {
      this.value += delta;
      return this.read();
    },
  };
  const readable: Readable = counter;
  check(readable.read() === 2);
  check(counter.add(3) === 5);
  check(readable.value === 5);
}
`, "rust_object_method_redeclarations");

  assert.deepEqual(result.diagnostics, []);
  assert.equal(
    validateGeneratedProject("object-method-redeclarations", result.artifacts, { run: true }).status,
    0,
  );
});

test("function-valued object members preserve dynamic this and lexical captures", { timeout: 300_000 }, () => {
  const { result } = compileExecutable(`
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

interface Counter {
  value: int32;
  next(delta: int32): int32;
}

export function main(): void {
  let captured: int32 = 4;
  const counter: Counter = {
    value: 1,
    next: function (delta) {
      captured += delta;
      this.value += delta;
      return captured + this.value;
    },
  };
  check(counter.next(2) === 9);
  check(counter.value === 3);
}
`, "rust_object_function_property");

  assert.deepEqual(result.diagnostics, []);
  assert.equal(
    validateGeneratedProject("object-function-property", result.artifacts, { run: true }).status,
    0,
  );
});

test("arrow-valued object members retain lexical receiver semantics", { timeout: 300_000 }, () => {
  const { result } = compileExecutable(`
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

interface Reader {
  read(delta: int32): int32;
}

export function main(): void {
  const captured: int32 = 5;
  const reader: Reader = {
    read: (delta) => captured + delta,
  };
  check(reader.read(3) === 8);
}
`, "rust_object_arrow_property");

  assert.deepEqual(result.diagnostics, []);
  assert.equal(
    validateGeneratedProject("object-arrow-property", result.artifacts, { run: true }).status,
    0,
  );
});
