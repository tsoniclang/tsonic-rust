import { test } from "node:test";
import assert from "node:assert/strict";
import { compileRust } from "./helpers/rust-session.mjs";

test("unsupported AST fails closed with deterministic diagnostics", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export class Widget {
  value: number = 0;
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "RUST_UNSUPPORTED_AST");
  assert.ok(result.diagnostics[0].evidence.includes("target.capability=rust.backend.statement"));
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

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.code === "RUST_MISSING_TARGET_FACT" &&
    diagnostic.message.includes("operator fact")));
});

test("dynamic any member access fails closed in strict-native mode", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
declare const value: { name: string };

export function read(): string {
  return value.name;
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "RUST_MISSING_TARGET_FACT"));
});

test("source-name guessing is impossible: unmapped module import fails closed", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export function fallback(a: number, b: number): number {
  return Math.max(a, b);
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.length > 0);
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
