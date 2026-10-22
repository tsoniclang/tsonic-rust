import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeFunction, nativeNodes, nativeCalls, nativeType, nativeBorrow } from "../../helpers/native-ast.mjs";
import {
  acmeTestingPackage,
  artifactText,
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
main();
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const manifest = nativeFunction(result, "manifest_has");
  assert.equal(manifest.visibility, "public");
  assert.deepEqual(manifest.params.map(parameter => parameter.type), [nativeBorrow(nativeType("str")), nativeType("String")]);
  assert.deepEqual(manifest.returnType, nativeType("bool"));
  assert.equal(manifest.errorType.identity, "tsonic-rust-runtime:TsonicError");
  const main = nativeFunction(result, "main");
  const arrays = nativeNodes(main.body, node => node.kind === "let" && node.name === "xs");
  assert.equal(arrays.length, 1);
  assert.deepEqual(arrays[0].type, { kind: "fixed-array", element: nativeType("i32"), length: { kind: "integer", value: 3n } });
  assert.deepEqual(arrays[0].init.elements, ["10", "20", "30"].map(text => ({ kind: "int-literal", text })));
  const caught = nativeNodes(main.body, node => node.kind === "match" && node.expression.kind === "call" &&
    node.expression.path === "tsonic_rust_node::crypto::random_bytes");
  assert.equal(caught.length, 1);
  assert.deepEqual(caught[0].expression.args, [{ kind: "int-literal", text: "16_usize" }]);
  const rejected = caught[0].arms.find(arm => arm.pattern.path === "Err");
  assert.equal(rejected.expression.kind, "break-expression");
  assert.equal(rejected.expression.expr.path, "Err");
  assert.equal(nativeCalls(rejected.expression, "rt::TsonicError::from").length, 1);
  assert.equal(nativeNodes(main.body, node => node.kind === "try" &&
    nativeCalls(node.expr, "tsonic_rust_node::crypto::random_bytes").length !== 0).length, 0,
    "the random failure enters the source catch instead of escaping the function");
  const run = validateGeneratedProject("r8-proof-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("native path calls borrow class String snapshots without redundant references", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"], capabilities: [await nodejsCapability()], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "field_string_borrow" } },
    files: { "index.ts": `
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { check } from "@acme/testing";
class PathHolder {
  path: string;
  calls = 0;
  constructor(path: string) { this.path = path; }
  observed(): PathHolder { this.calls++; return this; }
}
export function main(): void {
  const manifest = new PathHolder("Cargo.toml");
  check(statSync(manifest.observed().path).isFile());
  check(manifest.calls === 1 && manifest.path === "Cargo.toml");
  const names = ["Cargo.toml"];
  check(names.includes(manifest.path));
  check(!names.includes("missing"));
  check(names.includes("Cargo.toml", 0));
  check(names.indexOf("Cargo.toml") === 0);
  check(names.indexOf("Cargo.toml", 1) === -1);
  check(names.lastIndexOf("Cargo.toml") === 0);
  check(names.lastIndexOf("Cargo.toml", -1) === 0);
  const directory = new PathHolder("field-string-borrow-proof");
  mkdirSync(directory.path, { recursive: true });
  check(statSync(directory.path).isDirectory());
  rmSync(directory.path, { recursive: true, force: true });
  check(!existsSync(directory.path));
}
main();
` },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(validateGeneratedProject("field-string-borrow", result.artifacts, { run: true }).status, 0);
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
main();
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
  return values[0] + (values.length as int32);
}

export function main(): void {
  const values: FixedArray<int32, 3> = [2, 3, 4];
  check(selected(values, 0) === 9);
}
main();
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /fn selected\(mut values: \[i32; 3\], index: i32\) -> Result<i32, rt::TsonicError>/u);
  assert.match(text, /rt::conversions::usize_to_i32\(values\.len\(\)\)\?/u);
  assert.equal(
    validateGeneratedProject("source-fixed-array", result.artifacts, { run: true }).status,
    0,
  );
});

test("discriminated object unions consume exact selected narrowing evidence", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    target: { id: "rust", options: { outputType: "bin" } },
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

export function main(): void {
  const square: Shape = { kind: "square", size: 4 };
  if (area(make()) !== 3 || area(square) !== 16) throw new Error("selected union fields");
}
main();
`,
    },
  });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.code).join(", "));
  const text = artifactText(result, "src/index.rs");
  const shapes = artifactText(result, "src/shapes.rs");
  assert.match(shapes, /pub enum Union2<Payload0, Payload1> \{\s*Variant0\(Payload0\),\s*Variant1\(Payload1\),\s*\}/u);
  assert.match(shapes, /pub struct KindRadiusShape \{\s*pub kind: String,\s*pub radius: i32,/u);
  assert.match(shapes, /pub struct KindSizeShape \{\s*pub kind: String,\s*pub size: i32,/u);
  assert.match(
    text,
    /crate::shapes::Union2::Variant1\(\{\s*let record_kind = String::from\("circle"\);\s*let record_radius = 1;\s*rt::ObjectHandle::new\(crate::shapes::KindRadiusShape \{\s*kind: record_kind,\s*radius: record_radius,/u,
  );
  assert.match(text, /match &shape/u);
  assert.match(text, /unreachable!\("The selected native union variant is absent"\)/u);
  validateGeneratedProject("selected-discriminated-fields", result.artifacts, { run: true });
});

test("object union construction selects target-distinct same-key variants from exact discriminant types", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    target: { id: "rust", options: { outputType: "bin" } },
    files: {
      "index.ts": `
import type { int32, uint8 } from "@tsonic/core/types.js";

export type Event =
  | { kind: "added"; value: int32 }
  | { kind: "removed"; value: uint8 };

export function added(value: int32): Event {
  return { kind: "added", value };
}

export function main(): void {
  const signed = added(-3);
  const unsigned: Event = { kind: "removed", value: 255 };
  if (signed.kind !== "added" || signed.value !== -3 || unsigned.kind !== "removed" || unsigned.value !== 255) {
    throw new Error("selected discriminant widths");
  }
}
main();
`,
    },
  });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.code).join(", "));
  const text = artifactText(result, "src/index.rs");
  const shapes = artifactText(result, "src/shapes.rs");
  assert.match(shapes, /pub struct KindValueShape \{\s*pub kind: String,\s*pub value: i32,/u);
  assert.match(shapes, /pub struct KindValueShape2 \{\s*pub kind: String,\s*pub value: u8,/u);
  assert.match(
    text,
    /crate::shapes::Union2::Variant0\(\{\s*let record_kind = String::from\("added"\);\s*let record_value = value;\s*rt::ObjectHandle::new\(crate::shapes::KindValueShape \{\s*kind: record_kind,\s*value: record_value,/u,
  );
  assert.doesNotMatch(text, /crate::shapes::Union2::Variant1\(rt::ObjectHandle::new\(crate::shapes::KindValueShape2/u);
  validateGeneratedProject("selected-discriminant-widths", result.artifacts, { run: true });
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
