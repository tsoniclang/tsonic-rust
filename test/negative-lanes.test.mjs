import { test } from "node:test";
import assert from "node:assert/strict";
import { artifactText, assertRustTargetRejection, compileRust } from "./helpers/rust-session.mjs";

test("unsupported top-level mutable declarations fail closed with deterministic diagnostics", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export let value: int32 = 1;
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.length > 0);
  assert.ok(result.diagnostics.every((diagnostic) => diagnostic.code === "RUST_UNSUPPORTED_AST" || diagnostic.code === "RUST_MISSING_TARGET_FACT"));
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.evidence.some((entry) => entry.startsWith("target.capability=rust.backend."))));
});

test("mixed-kind numeric operators have no fact and fail closed", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32, float64 } from "@tsonic/core/types.js";

export function mix(a: int32, b: float64): float64 {
  return a + b;
}
`,
    },
  });
  assert.deepEqual(result.artifacts, []);
  assert.deepEqual(result.diagnostics.map(({ code, message, evidence }) => ({ code, message, evidence })), [{
    code: "RUST_BINARY_OPERATOR_CARRIER_UNSUPPORTED",
    message: "Checked binary operator 'KindPlusToken' has no closed Rust operation for the finalized operand carriers.",
    evidence: [
      "target.capability=rust.operation.binary",
      "source.operatorKind=KindPlusToken",
    ],
  }]);
});

test("dynamic any member access fails closed in strict-native mode", () => {
  const options = {
    files: {
      "index.ts": `
declare const value: any;

export function read(): string {
  return value.name;
}
`,
    },
  };
  assertRustTargetRejection(options, [{
    code: "RUST_SELECTED_EVIDENCE_MISSING",
    message: "Checked property access has no selected provider, source-profile, or project-source declaration evidence.",
  }]);
});

test("dynamic any calls fail closed without selected callable evidence", () => {
  const options = {
    files: {
      "index.ts": `
declare const invoke: any;

export function run(): void {
  invoke();
}
`,
    },
  };
  assertRustTargetRejection(options, [{
    code: "RUST_SELECTED_PROJECT_DECLARATION_MISSING",
    message: "Checked project-source call has callee evidence but no exact selected callable declaration evidence.",
  }]);
});

test("for-of over an unproven dynamic carrier fails closed", () => {
  const options = {
    files: {
      "index.ts": `
export function walk(): void {
  const values: any = 1;
  for (const value of values) {
    value;
  }
}
`,
    },
  };
  assertRustTargetRejection(options, [{
    code: "RUST_ITERATION_CARRIER_UNSUPPORTED",
    message: "Selected for-of iteration receiver is not a finalized supported Rust iterable carrier.",
  }]);
});

test("source-name guessing is impossible: a project Math class stays project-owned", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
class Math {
  constructor() {}

  static max(a: number, _b: number): number {
    return a;
  }
}

export function fallback(a: number, b: number): number {
  return Math.max(a, b);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /Math::max\(a, b\)/u);
  assert.doesNotMatch(text, /js_abi::math_max/u);
});

test("functions without return annotations fail closed", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export function noAnnotation(a: number) {
  return a;
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.message.includes("explicit return type annotation")));
});

test("throw Error requires the exact selected one-message constructor shape", () => {
  const options = {
    files: {
      "index.ts": `
export function invalid(): void {
  throw new Error();
}
`,
    },
  };
  assertRustTargetRejection(options, [{
    code: "RUST_ERROR_MESSAGE_REQUIRED",
    message: "Rust Error construction currently requires one checked string message argument.",
  }]);
});
