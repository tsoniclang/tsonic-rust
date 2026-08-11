import { test } from "node:test";
import assert from "node:assert/strict";
import { acmeTestingPackage, artifactText, compileRust, nodejsCapability } from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

test("array callbacks lower to Rust closures over the canonical JS array carrier", async () => {
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
  assert.match(text, /xs\.map\(\|&x\| x \* 2\)/u);
  assert.match(text, /doubled\.filter\(\|&x\| x % 2 == 0\)/u);
  assert.match(text, /xs\.some\(\|&x\| x > 2\)/u);
  assert.match(text, /xs\.every\(\|&x\| x > 0\)/u);
  assert.match(text, /xs\.reduce\(0, \|acc, &x\| acc \+ x\)/u);
});

test("JSON round-trips through fallible rows in a throwing context", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
export function roundtrip(text: string): string {
  const value = JSON.parse(text);
  return JSON.stringify(value) ?? "";
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

test("node fs read lowers through the fallible provider row", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
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
  assert.match(text, /tsonic_rust_node::fs::read_file_sync_string\(&path, "utf8"\)/u);
  assert.doesNotMatch(text, /Ok\(tsonic_rust_node::fs::read_file_sync_string/u);
});

test("caught provider failures do not make project-source callers fallible", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
export function catches(text: string): string {
  let result = "";
  try {
    const value = JSON.parse(text);
    result = JSON.stringify(value) ?? "";
  } catch (error) {
    result = "invalid";
  }
  return result;
}

export function forwards(text: string): string {
  return catches(text);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub fn catches\(text: String\) -> String \{/u);
  assert.match(text, /pub fn forwards\(text: String\) -> String \{/u);
  assert.match(text, /catches\(text\)/u);
  assert.doesNotMatch(text, /pub fn (?:catches|forwards)[^{]+TsonicResult/u);
  assert.doesNotMatch(text, /catches\(text\)\?/u);
});

test("provider-result arguments close after later source operations without eager conversion rejection", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
export function inspectJson(): boolean {
  let ok = false;
  try {
    const value = JSON.parse("{\\"tag\\":\\"tsonic\\"}");
    const rendered = JSON.stringify(value) ?? "";
    ok = rendered.includes("tsonic");
  } catch (error) {
    ok = false;
  }
  return ok;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /let value = js_abi::json_parse\("\{\\"tag\\":\\"tsonic\\"\}"\)\?;/u);
  assert.match(text, /let rendered = js_abi::json_stringify\(&value\)\?\.unwrap_or\(String::from\(""\)\);/u);
  assert.match(text, /ok = js_string::includes\(&rendered, "tsonic", 0\);/u);
});

test("awaited fallible project-source calls apply try after await", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export async function risky(): Promise<string> {
  throw new Error("boom");
}

export async function forwards(): Promise<string> {
  return await risky();
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub async fn risky\(\) -> rt::TsonicResult<String>/u);
  assert.match(text, /pub async fn forwards\(\) -> rt::TsonicResult<String>/u);
  assert.match(text, /pub async fn forwards\(\) -> rt::TsonicResult<String> \{\n    risky\(\)\.await\n\}/u);
  assert.doesNotMatch(text, /risky\(\)\.await\?/u);
  assert.doesNotMatch(text, /risky\(\)\?\.await/u);
});

test("generated cargo binary proves callbacks, errors, JSON, and fs at runtime", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
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
    const text = JSON.stringify(value) ?? "";
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

test("static fallible methods propagate with ? through type paths", async () => {
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
  assert.match(text, /pub fn drive\(\) -> rt::TsonicResult<i32> \{\n    Machine::risky\(false\)\n\}/u);
  assert.doesNotMatch(text, /Ok\(Machine::risky\(false\)\?\)/u);
});

test("catch returns propagate through exact completion state in fallible functions", async () => {
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
  assert.match(text, /Ok\(rt::Completion::Return\(2\)\)/u);
  assert.match(text, /rt::Completion::Return\(value\) => return Ok\(value\)/u);
  assert.match(text, /return risky\(\);/u);
  assert.doesNotMatch(text, /return Ok\(risky\(\)\?\);/u);
});

test("nested arrow returns do not trip the try escape scan", async () => {
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
  assert.match(artifactText(result, "src/index.rs"), /xs\.map\(\|&x\| x \* 2\)/u);
});

test("fallible provider rows are restricted to method, constructor, and property operations", async () => {
  const { createRustProviderPackage } = await import("../dist/index.js");
  assert.throws(
    () => createRustProviderPackage({
      id: "bad",
      displayName: "Bad",
      version: "1.0.0",
      modules: [{
        moduleSpecifier: "@bad",
        providerModuleId: "bad",
        exports: [{
          id: "@bad::X",
          name: "X",
          kind: "class",
          members: [{
            id: "@bad::X.indexer",
            name: "indexer",
            kind: "indexer",
            signatures: [{
              id: "@bad::X.indexer(index)",
              parameters: [{ name: "index", type: { kind: "number" } }],
              returnType: { kind: "source-primitive", name: "int32" },
            }],
          }],
        }],
      }],
      operations: [{
        exportId: "@bad::X",
        memberId: "@bad::X.indexer",
        signatureId: "@bad::X.indexer(index)",
        operationKind: "indexer",
        target: { form: "index" },
        resultCarrier: { kind: "source-primitive", name: "int32" },
        parameterCarriers: [{ kind: "source-primitive", name: "float64" }],
        isFallible: true,
      }],
      crates: [],
    }),
    /isFallible is supported only on method, constructor, and property operations/u,
  );
});
