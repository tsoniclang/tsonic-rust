import assert from "node:assert/strict";
import { test } from "node:test";

import {
  acmeTestingPackage,
  artifactText,
  compileRust,
} from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

test("project overloads, preconstruction fields, wide primitives, and bodyless safety contracts execute together", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "project_contract_parity" },
    },
    files: {
      "index.ts": `
import { safety, unsafeContext } from "@tsonic/core/lang.js";
import type { char, int32, int64, uint64 } from "@tsonic/core/types.js";
import type { i128, isize, u128, usize } from "@tsonic/rust/types.js";
import { check } from "@acme/testing";

function combine(value: int32): int32;
function combine(value: int32, delta?: int32): int32;
function combine(value: int32, delta?: int32): int32 {
  return value + (delta ?? 0);
}

class Value {
  label: string = "value";
  copied: string = this.label;
  first: int32;
  second: int32;

  constructor(first: int32);
  constructor(first: int32, delta?: int32);
  constructor(first: int32, delta?: int32) {
    this.first = first;
    this.second = this.first + (delta ?? 0);
  }

  total(value: int32): int32;
  total(value: int32, delta?: int32): int32;
  total(value: int32, delta?: int32): int32 {
    return this.second + value + (delta ?? 0);
  }
}

class Base {
  label: string = "base";
  first: int32 = 40;
}

class Derived extends Base {
  copied: string = this.label;
  second: int32 = this.first + 2;
}

interface UnsafeContract {
  read(value: int32): int32;
}

class UnsafeImplementation implements UnsafeContract {
  read(value: int32): int32 { return value; }
}

safety<UnsafeContract>().method(value => value.read).requiresUnsafe();
safety<UnsafeImplementation>().method(value => value.read).requiresUnsafe();

function letter(): char { return "A"; }
function signed64Maximum(): int64 { return 9223372036854775807n; }
function unsigned64Maximum(): uint64 { return 18446744073709551615n; }
function signedMaximum(): i128 { return 170141183460469231731687303715884105727n; }
function signedMinimum(): i128 { return -170141183460469231731687303715884105728n; }
function unsignedMaximum(): u128 { return 340282366920938463463374607431768211455n; }
function nativeSigned(value: isize): isize { return value; }
function nativeUnsigned(value: usize): usize { return value; }

export function main(): void {
  check(combine(40) === 40);
  check(combine(40, 2) === 42);

  const first = new Value(40);
  const second = new Value(40, 2);
  check(first.copied === "value");
  check(first.total(2) === 42);
  check(second.total(0) === 42);
  check(second.total(1, 1) === 44);

  const derived = new Derived();
  check(derived.copied === "base");
  check(derived.second === 42);

  const unsafeValue: UnsafeContract = new UnsafeImplementation();
  check(unsafeContext(unsafeValue.read(42)) === 42);

  check(signed64Maximum() === 9223372036854775807n);
  check(unsigned64Maximum() === 18446744073709551615n);
  check(signedMaximum() === 170141183460469231731687303715884105727n);
  check(signedMinimum() === -170141183460469231731687303715884105728n);
  check(unsignedMaximum() === 340282366920938463463374607431768211455n);
  check(nativeSigned(42) === 42);
  check(nativeUnsigned(42) === 42);
  void letter();
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.equal(source.match(/fn combine\s*\(/gu)?.length ?? 0, 1);
  assert.equal(source.match(/fn total\s*\(/gu)?.length ?? 0, 1);
  assert.match(source, /let field_copied: String = base_state\.label\.clone\(\);/u);
  assert.match(source, /let field_second: i32 = base_state\.first \+ 2;/u);
  assert.match(source, /fn letter\(\) -> u16 \{\s*65\s*\}/u);
  assert.match(source, /fn signed_maximum\(\) -> i128/u);
  assert.match(source, /fn signed_minimum\(\) -> i128/u);
  assert.match(source, /fn unsigned_maximum\(\) -> u128/u);
  assert.match(source, /unsafe fn dispatch_unsafe_contract_read/u);

  const run = validateGeneratedProject("project-contract-parity", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("constructors lower local control flow through exact preconstruction field storage", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "constructor_control_flow" },
    },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

class Values {
  total: int32;
  complete: boolean;

  constructor(limit: int32) {
    const initial: int32 = 0;
    this.total = initial;
    for (let index: int32 = 0; index < limit; index++) {
      this.total += index;
    }
    if (limit === 3) {
      this.total += 1;
      this.complete = true;
    } else {
      this.total = -1;
      this.complete = false;
    }
  }
}

class Base {
  value: int32;
  constructor(value: int32) { this.value = value; }
}

class Derived extends Base {
  doubled: int32;

  constructor(value: int32) {
    super(value);
    const doubled = this.value * 2;
    this.doubled = doubled;
  }
}

export function main(): void {
  const values = new Values(3);
  check(values.total === 4);
  check(values.complete);
  const derived = new Derived(21);
  check(derived.value === 21);
  check(derived.doubled === 42);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /let mut field_total: i32 = initial;/u);
  assert.match(source, /field_total \+= index;/u);
  assert.match(source, /let doubled: i32 = base_state\.value \* 2;/u);

  const run = validateGeneratedProject("constructor-control-flow", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("wide fixed-width literals reject exact boundary overflow", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int64, int128, uint64, uint128 } from "@tsonic/core/types.js";

export function signed64(): int64 {
  return 9223372036854775808n;
}

export function unsigned64(): uint64 {
  return 18446744073709551616n;
}

export function signed(): int128 {
  return 170141183460469231731687303715884105728n;
}

export function unsigned(): uint128 {
  return 340282366920938463463374607431768211456n;
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.deepEqual(
    result.diagnostics.map(({ code, message }) => ({ code, message })),
    [
      ...Array.from({ length: 4 }, () => ({
        code: "RUST_INTEGER_LITERAL_NOT_EXACT",
        message: "BigInt literal cannot be proven exact for the finalized Rust fixed-width carrier.",
      })),
    ],
  );
});

test("preconstruction this rejects calls and escapes instead of guessing object availability", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export class Invalid {
  first: int32 = 1;
  second: int32 = this.read();

  read(): int32 { return this.first; }
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some(({ code, message }) =>
    code === "RUST_UNSUPPORTED_AST" &&
    message.includes("already-initialized field selected by finalized TSTS property evidence")));
});

test("neutral UTF-16 char does not silently use integer stringification", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { char } from "@tsonic/core/types.js";

export function render(value: char): string {
  return \`value=\${value}\`;
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.deepEqual(
    result.diagnostics.map(({ code, message }) => ({ code, message })),
    [{
      code: "RUST_TEMPLATE_SUBSTITUTION_UNSUPPORTED",
      message: "Template substitution requires an exact closed primitive, string, or undefined carrier.",
    }],
  );
});

test("uncontextualized TypeScript numeric literals retain the number carrier", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export function render(): string {
  let result = "";
  for (let index = 0; index < 2; index++) {
    result = \`\${result}\${index}\`;
  }
  return result;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /let mut index: f64 = 0\.0;/u);
  assert.match(source, /rt::source_string\(&index\)/u);
  validateGeneratedProject("inferred-number-carrier", result.artifacts);
});

test("strict equality for disjoint nullish carriers preserves operand evaluation", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "disjoint_nullish_equality" },
    },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

class Counter {
  value: int32 = 0;
}

function left(counter: Counter): string {
  counter.value = counter.value * 10 + 1;
  return "value";
}

function right(counter: Counter): void {
  counter.value = counter.value * 10 + 2;
}

export function main(): void {
  const counter = new Counter();
  const equal = left(counter) === void right(counter);
  check(!equal);
  check(counter.value === 12);

  const unequal = left(counter) !== void right(counter);
  check(unequal);
  check(counter.value === 1212);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /let equal: bool = \{\s*let _ = left\(counter\.clone\(\)\);\s*\{\s*let _ = \{\s*right\(counter\.clone\(\)\);\s*rt::Undefined\s*\};\s*false\s*\}\s*\};/u);
  assert.match(source, /let unequal: bool = \{\s*let _ = left\(counter\.clone\(\)\);\s*\{\s*let _ = \{\s*right\(counter\.clone\(\)\);\s*rt::Undefined\s*\};\s*true\s*\}\s*\};/u);
  const run = validateGeneratedProject("disjoint-nullish-equality", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("bodyless unsafe contracts require matching implementation ABI facts", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import { safety } from "@tsonic/core/lang.js";
import type { int32 } from "@tsonic/core/types.js";

interface Contract { read(value: int32): int32; }
class Implementation implements Contract {
  read(value: int32): int32 { return value; }
}

safety<Contract>().method(value => value.read).requiresUnsafe();
export function create(): Contract { return new Implementation(); }
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some(({ code, message }) =>
    code === "RUST_MISSING_TARGET_FACT" &&
    message.includes("does not preserve the exact contract Rust ABI")));
});
