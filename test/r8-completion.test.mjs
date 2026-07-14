import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acmeTestingPackage,
  artifactText,
  compileRust,
  createRustSession,
  nodejsCapability,
  rustSourceDiagnostics,
} from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

function assertSourceSemanticRejection(options, expectedMessages) {
  const diagnostics = rustSourceDiagnostics(createRustSession(options), ["/src/index.ts"]);
  const actualMessages = diagnostics.split("\n").filter((line) => line !== "").map((line) => {
    const match = /: error TS0: \[TSEXT0\] (.*)$/u.exec(line);
    assert.ok(match, `unexpected source diagnostic: ${line}`);
    return match[1];
  });
  assert.deepEqual(actualMessages, expectedMessages);
  assert.throws(
    () => compileRust(options),
    (error) => error instanceof Error && error.message === `TypeScript diagnostics:\n${diagnostics}`,
    "source diagnostics must block backend artifact handoff",
  );
}

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
  assert.match(text, /pub fn manifest_has\(path: &str, needle: &str\) -> rt::TsonicResult<bool>/u);
  assert.match(text, /let xs: \[i32; 3\] = \[10, 20, 30\];/u);
  assert.match(text, /tsonic_rust_node::crypto::random_bytes\(16usize\)\?/u);
  const run = validateGeneratedProject("r8-proof-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("dynamic fixed-array indexing fails closed", async () => {
  const options = {
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function f(i: int32): int32 {
  const xs: [int32, int32] = [1, 2];
  return xs[i];
}
`,
    },
  };
  assertSourceSemanticRejection(options, [
    "Fixed-array element access requires a TSTS-selected in-range fixed ordinal.",
  ]);
});

test("RegExp outside the oracle subset stays hard-rejected", async () => {
  const fixtures = [
    { source: "export function f(s: string): boolean {\n  return /a(?<name>b)/.test(s);\n}\n" },
    {
      source: "export function f(p: string, s: string): boolean {\n  const r = new RegExp(p);\n  return r.test(s);\n}\n",
      sourceMessage: "Rust RegExp construction requires TSTS-selected RegExp constructor evidence and compile-time string pattern/flags.",
    },
    { source: "export function f(s: string): string {\n  return s.replace(/(a)\\1/, \"b\");\n}\n" },
  ];
  for (const fixture of fixtures) {
    const options = { surfaces: ["js"], files: { "index.ts": fixture.source } };
    if (fixture.sourceMessage !== undefined) {
      assertSourceSemanticRejection(options, [fixture.sourceMessage]);
      continue;
    }
    const { result } = compileRust(options);
    assert.equal(result.artifacts.length, 0, "unsupported RegExp must not emit artifacts");
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
