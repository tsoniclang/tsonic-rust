import { test } from "node:test";
import assert from "node:assert/strict";
import { acmeTestingPackage, artifactText, compileRust } from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

test("array callbacks lower to Rust closures over dense helpers", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function stats(xs: int32[]): int32 {
  const doubled = xs.map((x) => x * 2);
  const evens = doubled.filter((x) => x % 2 === 0);
  const any_big = xs.some((x) => x > 2);
  const all_positive = xs.every((x) => x > 0);
  let bonus: int32 = 0;
  if (any_big && all_positive) {
    bonus = 1;
  }
  return xs.reduce((acc, x) => acc + x, 0) + evens.length + doubled.length + bonus;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /js_abi::array_dense_map\(&xs, \|&x\| x \* 2\)/u);
  assert.match(text, /js_abi::array_dense_filter\(&doubled, \|&x\| x % 2 == 0\)/u);
  assert.match(text, /js_abi::array_dense_some\(&xs, \|&x\| x > 2\)/u);
  assert.match(text, /js_abi::array_dense_every\(&xs, \|&x\| x > 0\)/u);
  assert.match(text, /js_abi::array_dense_reduce\(&xs, 0, \|acc, &x\| acc \+ x\)/u);
});

test("JSON round-trips through fallible rows in a throwing context", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
export function roundtrip(text: string): string {
  const value = JSON.parse(text);
  return JSON.stringify(value);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn roundtrip\(text: String\) -> rt::TsonicResult<String> \{/u);
  assert.match(text, /js_abi::json_parse\(&text\)\?/u);
  assert.match(text, /js_abi::json_stringify\(&value\)\?/u);
});

test("node fs read lowers through the fallible provider row", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packageIds: ["nodejs"],
    files: {
      "index.ts": `
import { readFileSync } from "node:fs";

export function load(path: string): string {
  return readFileSync(path, "utf8");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn load\(path: String\) -> rt::TsonicResult<String> \{/u);
  assert.match(text, /node_fs::read_file_sync_string\(&path, "utf8"\)\?/u);
});

test("generated cargo binary proves callbacks, errors, JSON, and fs at runtime", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packageIds: ["nodejs"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "final_proof" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { readFileSync } from "node:fs";
import { check } from "@acme/testing";

export function risky(flag: boolean): int32 {
  if (flag) {
    throw new Error("boom");
  }
  return 7;
}

export function main(): void {
  const xs: int32[] = [1, 2, 3];
  check(xs.map((x) => x * 2).length === 3);
  check(xs.reduce((acc, x) => acc + x, 0) === 6);
  check(xs.some((x) => x === 2));
  check(xs.every((x) => x > 0));
  check(xs.filter((x) => x > 1).length === 2);

  let outcome: int32 = 0;
  try {
    outcome = risky(true);
  } catch (error) {
    outcome = -1;
  }
  check(outcome === -1);
  try {
    outcome = risky(false);
  } catch (error) {
    outcome = -2;
  }
  check(outcome === 7);

  let json_ok = false;
  try {
    const value = JSON.parse("{\\"name\\": \\"tsonic\\", \\"count\\": 3}");
    const text = JSON.stringify(value);
    json_ok = text.includes("tsonic");
  } catch (error) {
    json_ok = false;
  }
  check(json_ok);

  let manifest = "";
  try {
    manifest = readFileSync("Cargo.toml", "utf8");
  } catch (error) {
    manifest = "";
  }
  check(manifest.includes("final_proof"));
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const run = validateGeneratedProject("final-proof-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("static fallible methods propagate with ? through type paths", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export class Machine {
  state: int32;

  constructor(state: int32) {
    this.state = state;
  }

  static risky(flag: boolean): int32 {
    if (flag) {
      throw new Error("nope");
    }
    return 3;
  }
}

export function drive(): int32 {
  return Machine.risky(false);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /fn risky\(flag: bool\) -> rt::TsonicResult<i32> \{/u);
  assert.match(text, /Ok\(Machine::risky\(false\)\?\)/u);
});

test("catch bodies with returns wrap Ok inside fallible functions", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function risky(): int32 {
  throw new Error("x");
}

export function fallback(flag: boolean): int32 {
  let value: int32 = 0;
  try {
    value = risky();
  } catch (error) {
    return 2;
  }
  if (flag) {
    return risky();
  }
  return value + 1;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn fallback\(flag: bool\) -> rt::TsonicResult<i32> \{/u);
  assert.match(text, /return Ok\(2\);/u);
  assert.match(text, /return Ok\(risky\(\)\?\);/u);
});

test("nested arrow returns do not trip the try escape scan", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function risky(): int32 {
  throw new Error("x");
}

export function safe(xs: int32[]): int32 {
  let doubled_len: int32 = 0;
  try {
    risky();
    doubled_len = xs.map((x) => x * 2).length;
  } catch (error) {
    doubled_len = -1;
  }
  return doubled_len;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /js_abi::array_dense_map/u);
});

test("fallible provider rows are restricted to method operations", async () => {
  const { createRustProviderPackage } = await import("../dist/index.js");
  assert.throws(
    () => createRustProviderPackage({
      id: "bad",
      displayName: "Bad",
      version: "1.0.0",
      modules: [],
      operations: [{
        exportId: "@bad::X",
        operationKind: "property",
        target: { form: "field", name: "x" },
        resultCarrier: { kind: "source-primitive", name: "int32" },
        isFallible: true,
      }],
      crates: [],
    }),
    /isFallible is supported only on method and constructor operations/u,
  );
});
