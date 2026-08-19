import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acmeTestingPackage,
  artifactText,
  assertRustTargetRejection,
  compileRust,
  nodejsCapability,
} from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

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
  assert.match(text, /pub fn manifest_has\(path: String, needle: String\) -> rt::TsonicResult<bool>/u);
  assert.match(text, /let xs: \[i32; 3\] = \[10, 20, 30\];/u);
  assert.match(text, /tsonic_rust_node::crypto::random_bytes\(tsonic_rust_runtime::conversions::i32_to_usize\(16\)\?\)\s*\.map_err\(tsonic_rust_runtime::TsonicError::from\)\?/u);
  const run = validateGeneratedProject("r8-proof-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("dynamic fixed-array locations support checked read-modify-write", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "dynamic_fixed_array_update_proof" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

export function main(): void {
  let xs: [int32, int32] = [1, 2];
  const i: int32 = 1;
  xs[i] += 3;
  check(xs[i] === 5);
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(validateGeneratedProject("dynamic-fixed-array-update", result.artifacts, { run: true }).status, 0);
});

test("shared FixedArray length and indexing lower through exact source-core evidence", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "source_fixed_array_proof" },
    },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { FixedArray, int32 } from "@tsonic/core/types.js";

function selected(values: FixedArray<int32, 3>, index: int32): int32 {
  values[index] += 4;
  return values[0] + values.length;
}

export function main(): void {
  const values: FixedArray<int32, 3> = [2, 3, 4];
  check(selected(values, 0) === 9);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /fn selected\(mut values: \[i32; 3\], index: i32\) -> rt::TsonicResult<i32>/u);
  assert.match(text, /tsonic_rust_runtime::conversions::usize_to_i32\(values\.len\(\)\)\?/u);
  assert.equal(
    validateGeneratedProject("source-fixed-array", result.artifacts, { run: true }).status,
    0,
  );
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
      assertRustTargetRejection(options, [{
        code: "RUST_REGEXP_DYNAMIC_UNSUPPORTED",
        message: fixture.sourceMessage,
      }]);
      continue;
    }
    const { result } = compileRust(options);
    assert.equal(result.artifacts.length, 0, "unsupported RegExp must not emit artifacts");
    assert.ok(result.diagnostics.length > 0);
  }
});

test("discriminated object unions consume exact selected narrowing evidence", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export type Shape =
  | { kind: "circle"; radius: int32 }
  | { kind: "square"; size: int32 };

export function make(): Shape {
  return { kind: "circle", radius: 1 };
}

export function area(shape: Shape): int32 {
  if (shape.kind === "circle") {
    return shape.radius * 3;
  }
  return shape.size * shape.size;
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  const shapes = artifactText(result, "src/shapes.rs");
  assert.match(text, /pub enum Shape \{\n    Variant0\(rt::ObjectHandle<crate::shapes::KindRadiusShape>\),\n    Variant1\(rt::ObjectHandle<crate::shapes::KindSizeShape>\),\n\}/u);
  assert.match(shapes, /pub struct KindRadiusShape \{\s*pub kind: String,\s*pub radius: i32,/u);
  assert.match(shapes, /pub struct KindSizeShape \{\s*pub kind: String,\s*pub size: i32,/u);
  assert.match(
    text,
    /Shape::Variant0\(\{\s*let record_kind = String::from\("circle"\);\s*let record_radius = 1;\s*rt::ObjectHandle::new\(crate::shapes::KindRadiusShape \{\s*kind: record_kind,\s*radius: record_radius,/u,
  );
  assert.match(text, /match &shape/u);
  assert.match(text, /unreachable!\("TSTS-selected source refinement excluded this union variant"\)/u);
});

test("object union construction selects target-distinct same-key variants from exact discriminant types", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32, uint8 } from "@tsonic/core/types.js";

export type Event =
  | { kind: "added"; value: int32 }
  | { kind: "removed"; value: uint8 };

export function added(value: int32): Event {
  return { kind: "added", value };
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  const shapes = artifactText(result, "src/shapes.rs");
  assert.match(shapes, /pub struct KindValueShape \{\s*pub kind: String,\s*pub value: i32,/u);
  assert.match(shapes, /pub struct KindValueShape2 \{\s*pub kind: String,\s*pub value: u8,/u);
  assert.match(
    text,
    /Event::Variant0\(\{\s*let record_kind = String::from\("added"\);\s*let record_value = value;\s*rt::ObjectHandle::new\(crate::shapes::KindValueShape \{\s*kind: record_kind,\s*value: record_value,/u,
  );
  assert.doesNotMatch(text, /Event::Variant1\(rt::ObjectHandle::new\(crate::shapes::KindValueShape2/u);
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
