import assert from "node:assert/strict";
import { test } from "node:test";

import {
  acmeTestingPackage,
  artifactText,
  compileRust,
} from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

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
