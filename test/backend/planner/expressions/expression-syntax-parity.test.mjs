import assert from "node:assert/strict";
import { test } from "node:test";

import { acmeTestingPackage, artifactText, compileRust } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

test("conditional expressions use one finalized branch carrier", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function choose(condition: boolean, left: int32, right: int32): int32 {
  return condition ? left : right;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /if condition \{\s+left\s+\} else \{\s+right\s+\}/u);
  validateGeneratedProject("expression-conditional", result.artifacts);
});

test("conditional expressions own exact Option branch projections", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
export class Value {
  kind: string;

  constructor(kind: string) {
    this.kind = kind;
  }
}

export class TextValue extends Value {
  value: string;

  constructor(value: string) {
    super("text");
    this.value = value;
  }
}

export function read(value: Value): string | undefined {
  return value instanceof TextValue ? value.value : undefined;
}

export function parenthesized(value: string, present: boolean): string | undefined {
  return (present ? value : undefined);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /if[\s\S]*Some\([\s\S]*\)[\s\S]*else[\s\S]*None/u);
  validateGeneratedProject("expression-conditional-option", result.artifacts);
});

test("no-substitution templates retain their exact string value", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export function text(): string {
  return \`line one\\nline two\`;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /String::from\("line one\\nline two"\)/u);
  validateGeneratedProject("expression-template-literal", result.artifacts);
});

test("string relational operators preserve TypeScript UTF-16 ordering", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "string_ordering_proof" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";

export function main(): void {
  const supplementary = "\u{10000}";
  const privateUse = "\u{e000}";
  check("alpha" < "beta");
  check("alpha" <= "alpha");
  check("beta" > "alpha");
  check("alpha" >= "alpha");
  check(supplementary < privateUse);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /rt::source_string_less_than\("alpha", "beta"\)/u);
  assert.match(source, /rt::source_string_less_than\(&supplementary, &private_use\)/u);
  validateGeneratedProject("expression-string-ordering", result.artifacts, { run: true });
});

test("satisfies and redundant non-null syntax erase through exact identity facts", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function identity(value: int32): int32 {
  const checked: int32 = value satisfies int32;
  return checked!;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /let checked: i32 = value;/u);
  assert.match(source, /checked\n/u);
  validateGeneratedProject("expression-erased-wrappers", result.artifacts);
});

test("non-null syntax projects the exact Option element carrier", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "non_null_projection" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

export function require(value: string | null): string {
  return value!;
}

export function selected(values: string[], index: int32 | undefined): string {
  if (index === undefined) return "";
  return values[index]!;
}

export function main(): void {
  check(require("ready") === "ready");
  check(selected(["zero", "one"], 1) === "one");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /value\.clone\(\)\.unwrap\(\)/u);
  assert.match(source, /get_number[\s\S]*Some\(flow_value\)/u);
  assert.equal(validateGeneratedProject("non-null-projection", result.artifacts, { run: true }).status, 0);
});

test("arrow and function-expression callbacks share one exact block-body contract", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function transform(values: int32[]): int32[] {
  const mapped = values.map(function (value: int32): int32 {
    const next: int32 = value + 1;
    return next;
  });
  const filtered = mapped.filter((value: int32): boolean => {
    return value > 1;
  });
  return filtered.map((value: int32): int32 => {
    value += 1;
    return value;
  });
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /values\.map\(\|value\| \{/u);
  assert.match(source, /mapped\.filter\(\|value\| value > 1\)/u);
  assert.match(source, /filtered\.map\(\|mut value\| \{/u);
  validateGeneratedProject("expression-callable-blocks", result.artifacts);
});

test("named callable expressions preserve exact callback and recursive identities", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "named_callable_expression_proof" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

function transform(values: int32[]): int32[] {
  return values.map(function recurse(value: int32): int32 {
    return value + 1;
  });
}

const factorial: (value: int32) => int32 = function visit(value: int32): int32 {
  return value <= 1 ? 1 : value * visit(value - 1);
};

export function main(): void {
  check(transform([1, 2])[1] === 3);
  check(factorial(5) === 120);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /values\.map\(\|value\| value \+ 1\)/u);
  assert.match(source, /Callable::<\(i32,\), rt::TsonicResult<i32>>::recursive/u);
  validateGeneratedProject("named-callable-expression", result.artifacts, { run: true });
});

test("substituted templates use exact source-string conversions", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "template_proof" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

export function main(): void {
  const count: int32 = 42;
  const enabled: boolean = true;
  const negativeZero: number = -0;
  const text = \`count=\${count}; enabled=\${enabled}; zero=\${negativeZero}\`;
  check(text === "count=42; enabled=true; zero=0");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /rt::source_string\(&count\)/u);
  assert.match(source, /rt::source_string\(&enabled\)/u);
  assert.match(source, /rt::source_string\(&negative_zero\)/u);
  validateGeneratedProject("expression-substituted-template", result.artifacts, { run: true });
});

test("flow-selected optional values project before direct template and arithmetic use", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "flow_read_proof" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

class Diagnostic {
  file: string | undefined;
  line: int32 | undefined;

  constructor(file: string | undefined, line: int32 | undefined) {
    this.file = file;
    this.line = line;
  }

  format(): string {
    if (this.file === undefined) return "";
    if (this.line === undefined) return \`${"${this.file}"}: \`;
    return \`${"${this.file}"}:${"${this.line + 1}"}\`;
  }
}

function direct(value: string | undefined): string {
  if (value === undefined) return "missing";
  return \`value=${"${value}"}\`;
}

export function main(): void {
  check(new Diagnostic(undefined, undefined).format() === "");
  check(new Diagnostic("index.ts", undefined).format() === "index.ts: ");
  check(new Diagnostic("index.ts", 4).format() === "index.ts:5");
  check(direct(undefined) === "missing");
  check(direct("ready") === "value=ready");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /match .*\.as_ref\(\)/su);
  assert.match(source, /checked flow selected a missing optional value/u);
  validateGeneratedProject("flow-read-projection", result.artifacts, { run: true });
});

test("optional value equality applies one exact option projection", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "option_value_equality" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";

class Artifact {
  output_path: string | undefined;

  constructor(output_path: string | undefined) {
    this.output_path = output_path;
  }
}

export function main(): void {
  const expected = "site.css";
  const artifact = new Artifact(expected);
  check(artifact.output_path === \`site.\${"css"}\`);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.doesNotMatch(artifactText(result, "src/index.rs"), /Some\(Some\(/u);
  validateGeneratedProject("option-value-equality", result.artifacts, { run: true });
});

test("typeof consumes exact carriers and preserves operand evaluation without moves", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32, int64 } from "@tsonic/core/types.js";

export function categories(text: string, count: int32, wide: int64, enabled: boolean): string {
  const textKind = typeof text;
  const countKind = typeof count;
  const wideKind = typeof wide;
  const enabledKind = typeof enabled;
  return text + textKind + countKind + wideKind + enabledKind;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /let _ = text;\s+String::from\("string"\)/u);
  assert.match(source, /String::from\("number"\)/u);
  assert.match(source, /String::from\("bigint"\)/u);
  assert.match(source, /String::from\("boolean"\)/u);
  validateGeneratedProject("expression-typeof", result.artifacts);
});

test("void evaluates its operand and produces the closed undefined carrier", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "void_proof" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";

export function main(): void {
  const discarded = void check(true);
  check(typeof discarded === "undefined");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /let discarded: rt::Undefined = \{\s+acme_testing::check\(true\);\s+rt::Undefined\s+\};/u);
  validateGeneratedProject("expression-void", result.artifacts, { run: true });
});

test("bigint literals preserve arbitrary precision, value reuse, and operators", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "bigint_proof" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";

function difference(left: bigint, right: bigint): bigint {
  const sum = left + right;
  return sum - left;
}

class Counter {
  value: bigint;

  constructor(value: bigint) {
    this.value = value;
  }

  read(): bigint {
    return this.value;
  }
}

export function main(): void {
  const huge = 1234567890123456789012345678901234567890n;
  check(difference(huge, 7n) === 7n);
  check(huge === 1234567890123456789012345678901234567890n);
  let changed = huge;
  changed += 2n;
  changed--;
  check(changed === huge + 1n);
  check(-changed < 0n);
  check(typeof changed === "bigint");
  const counter = new Counter(huge);
  check(counter.read() === huge);
  check(counter.read() === huge);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /rt::BigInt/u);
  validateGeneratedProject("expression-bigint", result.artifacts, { run: true });
});

test("wide integer aliases reject number literals during source checking", () => {
  assert.throws(
    () => compileRust({
      files: {
        "index.ts": `
import type { int64 } from "@tsonic/core/types.js";

export function invalid(): int64 {
  return 9007199254740993;
}
`,
      },
    }),
    /TS2322: Type 'number' is not assignable to type 'bigint'/u,
  );
});

test("bigint division and remainder use the catchable runtime ABI", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "bigint_division_proof" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

function divide(left: bigint, right: bigint): bigint {
  return left / right;
}

function remainder(left: bigint, right: bigint): bigint {
  return left % right;
}

class BigCounter {
  value: bigint;

  constructor(value: bigint) {
    this.value = value;
  }
}

class BigAccessor {
  private stored: bigint;
  writes: int32 = 0;

  constructor(value: bigint) {
    this.stored = value;
  }

  get current(): bigint {
    return this.stored;
  }

  set current(value: bigint) {
    this.writes += 1;
    this.stored = value;
  }
}

class BigStatics {
  static value: bigint = 20n;
}

const counter = new BigCounter(20n);
const accessor = new BigAccessor(20n);
let receiverCalls: int32 = 0;

function selectedCounter(): BigCounter {
  receiverCalls += 1;
  return counter;
}

export function main(): void {
  check(divide(7n, 3n) === 2n);
  check(divide(-7n, 3n) === -2n);
  check(remainder(-7n, 3n) === -1n);
  let changed = 20n;
  changed /= 3n;
  check(changed === 6n);
  changed %= 4n;
  check(changed === 2n);
  selectedCounter().value /= 3n;
  check(counter.value === 6n);
  check(receiverCalls === 1);
  accessor.current %= 6n;
  check(accessor.current === 2n);
  check(accessor.writes === 1);
  BigStatics.value /= 4n;
  check(BigStatics.value === 5n);
  let caught = false;
  try {
    divide(1n, 0n);
  } catch (error) {
    caught = true;
  }
  check(caught);
  let unchanged = 9n;
  try {
    unchanged /= 0n;
  } catch (error) {
    caught = true;
  }
  check(unchanged === 9n);
  try {
    accessor.current /= 0n;
  } catch (error) {
    caught = true;
  }
  check(accessor.current === 2n);
  check(accessor.writes === 1);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /rt::BigInt::checked_div\(left\.clone\(\), right\.clone\(\)\)/u);
  assert.match(source, /rt::BigInt::checked_rem\(left\.clone\(\), right\.clone\(\)\)/u);
  assert.match(source, /rt::BigInt::checked_div\(current(?:_[0-9]+)?, value(?:_[0-9]+)?\)\?/u);
  assert.match(source, /rt::BigInt::checked_rem\(\s*current(?:_[0-9]+)?,\s*value(?:_[0-9]+)?,?\s*\)\?/u);
  validateGeneratedProject("expression-bigint-division", result.artifacts, { run: true });
});

test("delete lowers only an exact mutable JS Array index selection", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "delete_proof" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

export function main(): void {
  const values: (int32 | undefined)[] = [10, 20, 30];
  check(delete values[1]);
  check(values.length === 3);
  let keyCount: int32 = 0;
  for (const key in values) {
    check(key !== "1");
    keyCount += 1;
  }
  check(keyCount === 2);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(
    source,
    /values\.delete_number\(tsonic_rust_runtime::conversions::i32_to_f64\(1\)\)/u,
  );
  validateGeneratedProject("expression-delete-js-array", result.artifacts, { run: true });
});

test("delete rejects non-JS-array targets without target-name inference", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function remove(values: int32[]): boolean {
  return delete values[0];
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.code === "RUST_DELETE_SELECTION_UNSUPPORTED"));
});
