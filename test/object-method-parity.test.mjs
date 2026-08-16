import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acmeTestingPackage,
  artifactText,
  compileRust,
} from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

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
