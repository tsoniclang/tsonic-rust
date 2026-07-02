import { test } from "node:test";
import assert from "node:assert/strict";
import { artifactText, compileRust } from "./helpers/rust-session.mjs";

const denseSource = `
import type { int32 } from "@tsonic/core/types.js";

export function sum(): int32 {
  const xs: int32[] = [1, 2, 3];
  let total: int32 = 0;
  for (const value of xs) {
    total += value;
  }
  return total + xs.length;
}
`;

const sparseSource = `
export function tail_is_hole(): boolean {
  const values = [1, , 3];
  values.length = 5;
  values[3] = 4;
  return values.at(-1) === undefined;
}
`;

test("dense arrays lower to Vec with fact-backed iteration, length, and index", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": denseSource } });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /let xs: Vec<i32> = vec!\[1, 2, 3\];/u);
  assert.match(text, /for value in xs\.iter\(\)\.copied\(\) \{/u);
  assert.match(text, /total \+ xs\.len\(\) as i32/u);
});

test("sparse arrays lower to JsArray with holes, length writes, and at()", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": sparseSource } });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /let mut values: js_abi::JsArray<f64> = js_abi::JsArray::with_length\(3\);/u);
  assert.match(text, /values\.set\(0, 1\.0\);/u);
  assert.match(text, /values\.set\(2, 3\.0\);/u);
  assert.match(text, /values\.set_len\(5usize\);/u);
  assert.match(text, /values\.set\(3usize, 4\.0\);/u);
  assert.match(text, /values\.at\(-1isize\)\.copied\(\)\.is_none\(\)/u);
  assert.match(text, /use tsonic_rust_js::abi as js_abi;/u);
});

test("string members lower to the runtime string module by declaration identity", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
export function probe(name: string): boolean {
  const upper: string = name.toUpperCase();
  return upper.startsWith("A") && upper.includes("B") && name.length > 0;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /js_string::to_upper_case\(&name\)/u);
  assert.match(text, /js_string::starts_with\(&upper, "A", 0\)/u);
  assert.match(text, /js_string::includes\(&upper, "B", 0\)/u);
  assert.match(text, /js_string::js_len\(&name\) as i32 > 0/u);
});

test("Map and Set lower to runtime carriers with SameValueZero semantics", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function collections(): boolean {
  const m = new Map<int32, string>();
  m.set(1, "one");
  const s = new Set<int32>();
  s.add(4);
  return m.has(1) && m.get(2) === undefined && s.has(4) && m.size === 1 && !s.has(5);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /let mut m = js_abi::JsMap::new\(\);/u);
  assert.match(text, /m\.set\(1, String::from\("one"\)\);/u);
  assert.match(text, /m\.has\(&1\)/u);
  assert.match(text, /m\.get\(&2\)\.cloned\(\)\.is_none\(\)/u);
  assert.match(text, /s\.add\(4\);/u);
  assert.match(text, /m\.len\(\) as i32 == 1/u);
});

test("Date lowers to the UTC runtime carrier", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
export function timing(): boolean {
  const d = new Date(1000);
  return d.getTime() === 1000;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /js_abi::JsDate::from_millis\(1000\.0\)/u);
  assert.match(text, /d\.get_time\(\) == 1000\.0/u);
});

test("js surface contributes the rust-js cargo dependency", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": denseSource } });
  const manifest = artifactText(result, "Cargo.toml");
  assert.match(manifest, /tsonic_rust_js = \{ path = ".*rust-js\/crates\/tsonic_rust_js" \}/u);
});

test("strict-native without js surface rejects sparse arrays with a surface diagnostic", () => {
  const { result, extensionHost } = compileRust({ files: { "index.ts": sparseSource } });

  assert.equal(result.artifacts.length, 0);
  assert.ok(extensionHost.diagnostics.all().some((diagnostic) =>
    diagnostic.extensionCode === "RUST_JS_SURFACE_REQUIRED"));
  assert.ok(result.diagnostics.length > 0);
});

test("strict-native without js surface fails closed on JS member operations", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export function probe(name: string): boolean {
  return name.includes("a");
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "RUST_MISSING_TARGET_FACT"));
});

test("compat mode enables JS carrier lanes without explicit surface selection", () => {
  const { result } = compileRust({
    target: { id: "rust", options: { typescriptCompatibility: "compat" } },
    files: { "index.ts": sparseSource },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /js_abi::JsArray::with_length\(3\)/u);
  assert.match(artifactText(result, "Cargo.toml"), /tsonic_rust_js/u);
});

test("dynamic any member access fails closed even in compat mode", () => {
  const { result } = compileRust({
    target: { id: "rust", options: { typescriptCompatibility: "compat" } },
    files: {
      "index.ts": `
declare const value: any;

export function read(): string {
  return value.name;
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "RUST_MISSING_TARGET_FACT"));
});

test("RegExp remains unclaimed and fails closed", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
export function probe(text: string): boolean {
  const pattern = new RegExp("\\\\d+");
  return pattern.test(text);
}
`,
    },
  });

  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.length > 0);
});

test("readonly arrays lower to borrowed slice parameters with slice iteration", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function sum(xs: readonly int32[]): int32 {
  let total: int32 = 0;
  for (const x of xs) {
    total += x;
  }
  return total + xs.length;
}

export function caller(): int32 {
  const values: int32[] = [1, 2, 3];
  return sum(values);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn sum\(xs: &\[i32\]\) -> i32 \{/u);
  assert.match(text, /for x in xs\.iter\(\)\.copied\(\) \{/u);
  assert.match(text, /total \+ xs\.len\(\) as i32/u);
  assert.match(text, /sum\(&values\)/u);
});

test("undefined unions take the Option lane only under the js surface", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function value_or_zero(value: int32 | undefined): int32 {
  return value ?? 0;
}

export function caller(): int32 {
  return value_or_zero(undefined) + value_or_zero(7);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn value_or_zero\(value: Option<i32>\) -> i32/u);
  assert.match(text, /value_or_zero\(None\)/u);
  assert.match(text, /value_or_zero\(Some\(7\)\)/u);
});
