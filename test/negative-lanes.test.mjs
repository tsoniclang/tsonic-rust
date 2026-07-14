import { test } from "node:test";
import assert from "node:assert/strict";
import { compileRust, createRustSession, rustSourceDiagnostics } from "./helpers/rust-session.mjs";

test("unsupported AST fails closed with deterministic diagnostics", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export function f(value: number): number {
  switch (value) {
    default:
      return value;
  }
}
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
    code: "RUST_CHECKED_OPERATION_NOT_FINALIZED",
    message: "Checked Rust operation has no finalized target fact after post-check carrier closure.",
    evidence: [
      "target.capability=rust.operation.post-check-finalization",
      "source.operatorKind=KindPlusToken",
    ],
  }]);
});

test("dynamic any member access fails closed in strict-native mode", () => {
  const harness = createRustSession({
    files: {
      "index.ts": `
declare const value: any;

export function read(): string {
  return value.name;
}
`,
    },
  });
  const diagnostics = rustSourceDiagnostics(harness, ["/src/index.ts"]);

  assert.match(diagnostics, /TSEXT0/u);
  assert.match(diagnostics, /Checked property access has no selected provider, source-profile, or project-source declaration evidence/u);
});

test("dynamic any calls fail closed without selected callable evidence", () => {
  const harness = createRustSession({
    files: {
      "index.ts": `
declare const invoke: any;

export function run(): void {
  invoke();
}
`,
    },
  });
  const diagnostics = rustSourceDiagnostics(harness, ["/src/index.ts"]);

  assert.match(diagnostics, /TSEXT0/u);
  assert.match(diagnostics, /Checked project-source call has callee evidence but no exact selected callable declaration evidence/u);
});

test("for-of over an unproven dynamic carrier fails closed", () => {
  const harness = createRustSession({
    files: {
      "index.ts": `
export function walk(values: any): void {
  for (const value of values) {
    value;
  }
}
`,
    },
  });
  const diagnostics = rustSourceDiagnostics(harness, ["/src/index.ts"]);

  assert.match(diagnostics, /TSEXT0/u);
  assert.match(diagnostics, /Selected for-of iteration receiver is not a finalized supported Rust iterable carrier/u);
});

test("source-name guessing is impossible: unmapped module import fails closed", () => {
  const options = {
    surfaces: ["js"],
    files: {
      "index.ts": `
export function fallback(a: number, b: number): number {
  return Math.max(a, b);
}
`,
    },
  };
  const diagnostics = rustSourceDiagnostics(createRustSession(options), ["/src/index.ts"]);

  assert.match(diagnostics, /The selected JavaScript call 'Math\.max' has no closed Rust operation row/u);
  assert.throws(
    () => compileRust(options),
    (error) => error instanceof Error && error.message === `TypeScript diagnostics:\n${diagnostics}`,
  );
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
  const harness = createRustSession({
    files: {
      "index.ts": `
export function invalid(): void {
  throw new Error();
}
`,
    },
  });
  const diagnostics = rustSourceDiagnostics(harness, ["/src/index.ts"]);

  assert.match(diagnostics, /requires one checked string message argument/u);
  assert.throws(
    () => compileRust({ files: { "index.ts": `export function invalid(): void { throw new Error(); }` } }),
    /requires one checked string message argument/u,
  );
});
