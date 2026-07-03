import { test } from "node:test";
import assert from "node:assert/strict";
import { acmeTestingPackage, artifactText, compileRust, nodejsCapability } from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

test("generated cargo binary proves string ABI, fixed arrays, and new node rows", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "r8_proof" } },
    files: {
      "index.ts": `
import { readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

export function manifest_has(path: string, needle: string): boolean {
  if (existsSync(path)) {
    const text = readFileSync(path, "utf8");
    return text.includes(needle);
  }
  return false;
}

export function main(): void {
  check(manifest_has("Cargo.toml", "r8_proof"));
  const xs: [int32, int32, int32] = [10, 20, 30];
  check(xs[0] + xs[2] === 40);
  let random_ok = false;
  try {
    randomBytes(16);
    random_ok = true;
  } catch (error) {
    random_ok = false;
  }
  check(random_ok);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn manifest_has\(path: &str, needle: String\) -> rt::TsonicResult<bool>/u);
  assert.match(text, /let xs: \[i32; 3\] = \[10, 20, 30\];/u);
  assert.match(text, /node_crypto::random_bytes\(16usize\)\?/u);
  const run = validateGeneratedProject("r8-proof-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("dynamic fixed-array indexing fails closed", async () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function f(i: int32): int32 {
  const xs: [int32, int32] = [1, 2];
  return xs[i];
}
`,
    },
  });
  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.length > 0);
});

test("RegExp stays hard-rejected across literal, constructor, and string methods", async () => {
  const fixtures = [
    "export function f(s: string): boolean {\n  return /ab+c/.test(s);\n}\n",
    "export function f(s: string): boolean {\n  const r = new RegExp(\"ab+c\");\n  return r.test(s);\n}\n",
    "export function f(s: string): string {\n  return s.replace(/a/, \"b\");\n}\n",
  ];
  for (const fixture of fixtures) {
    const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": fixture } });
    assert.equal(result.artifacts.length, 0, "RegExp lane must not emit artifacts");
    assert.ok(result.diagnostics.length > 0);
  }
});

test("discriminated union narrowing repro stays fail-closed: it requires narrowing facts", async () => {
  // Exact repro: narrowing requires finalized facts; checker-level narrowed
  // types are not exposed as finalized facts, so member access on a
  // narrowed branch cannot prove its variant.
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export type Shape =
  | { kind: "circle"; radius: int32 }
  | { kind: "square"; size: int32 };

export function area(shape: Shape): int32 {
  if (shape.kind === "circle") {
    return shape.radius * 3;
  }
  return shape.size * shape.size;
}
`,
    },
  });
  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.length > 0);
  assert.ok(result.diagnostics.every((diagnostic) => diagnostic.code.startsWith("RUST_")));
});

test("fixed-array indexing accepts only exact in-range integer literal indexes", async () => {
  // TypeScript itself rejects fractional, negative, and out-of-range
  // literal indexes on tuple-typed fixed arrays (TS2493); the extension
  // guard (integer parse + range check) is the fact-level backstop.
  for (const index of ["1.5", "-1", "2"]) {
    assert.throws(
      () => compileRust({
        files: {
          "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function f(): int32 {
  const xs: [int32, int32] = [1, 2];
  return xs[${index}];
}
`,
        },
      }),
      /TypeScript diagnostics/u,
      `index ${index} must be rejected`,
    );
  }
});
