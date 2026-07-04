import { test } from "node:test";
import assert from "node:assert/strict";
import { acmeTestingPackage, artifactText, compileRust } from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

test("Math closed subset lowers to exact f64 methods", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
export function f(x: number, y: number): number {
  return Math.floor(x) + Math.ceil(y) + Math.trunc(x) + Math.abs(y) + Math.sqrt(x) + Math.pow(x, y);
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  for (const method of ["floor", "ceil", "trunc", "abs", "sqrt", "powf"]) {
    assert.ok(text.includes(`.${method}(`), method);
  }
});

test("Math members outside the exact subset fail closed", async () => {
  for (const call of ["Math.round(x)", "Math.min(x, 1)", "Math.random()"]) {
    const { result } = compileRust({
      surfaces: ["js"],
      files: { "index.ts": `export function f(x: number): number {\n  return ${call};\n}\n` },
    });
    assert.equal(result.artifacts.length, 0, `${call} must fail closed`);
    assert.ok(result.diagnostics.length > 0);
  }
});

test("generated cargo binary proves the Math lane at runtime", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "math_proof" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";

export function main(): void {
  check(Math.floor(2.7) === 2);
  check(Math.ceil(2.1) === 3);
  check(Math.trunc(-2.7) === -2);
  check(Math.abs(-5) === 5);
  check(Math.sqrt(9) === 3);
  check(Math.pow(2, 10) === 1024);
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const run = validateGeneratedProject("math-proof-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("util.inspect accepts closed JsValue and rejects other carriers", async () => {
  const { nodejsCapability } = await import("./helpers/rust-session.mjs");
  const capability = await nodejsCapability();
  const good = compileRust({
    surfaces: ["js"],
    capabilities: [capability],
    files: {
      "index.ts": `
import { inspect } from "node:util";

export function f(text: string): string {
  const value = JSON.parse(text);
  return inspect(value);
}
`,
    },
  });
  assert.deepEqual(good.result.diagnostics, []);
  assert.match(artifactText(good.result, "src/index.rs"), /node_util::inspect\(&value\)/u);

  const bad = compileRust({
    surfaces: ["js"],
    capabilities: [capability],
    files: {
      "index.ts": `
import { inspect } from "node:util";

export function f(name: string): string {
  return inspect(name);
}
`,
    },
  });
  assert.equal(bad.result.artifacts.length, 0);
  assert.ok(bad.result.diagnostics.length > 0);
});

test("RegExp oracle subset lowers constants, test, replace, split, search", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function scrub(text: string): int32 {
  const spaces = /\\s+/g;
  const joined = text.replace(spaces, "-");
  const parts = joined.split(/[-]/);
  const at: int32 = joined.search(/x/);
  if (spaces.test(text) && parts.length > 0) {
    return at;
  }
  return -1;
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /js_abi::JsRegExp::new\("\\\\s\+", "g"\)\?/u);
  assert.match(text, /spaces\.replace\(&text, "-"\)/u);
  assert.match(text, /\.split\(&joined\)\?/u);
  assert.match(text, /\.search\(&joined\)/u);
  assert.match(text, /spaces\.test\(&text\)/u);

  const constructed = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
export function probe(text: string): boolean {
  const pattern = new RegExp("\\\\d+", "g");
  return pattern.test(text);
}
`,
    },
  });
  assert.deepEqual(constructed.result.diagnostics, []);
  assert.match(artifactText(constructed.result, "src/index.rs"), /js_abi::JsRegExp::new\("\\\\d\+", "g"\)\?/u);
});

test("RegExp constructs outside the oracle subset fail closed", async () => {
  const cases = [
    "/a(?=b)/",
    "/(a)\\\\1/",
    "/a*?/",
    "/\\\\bword\\\\b/",
    "new RegExp(pattern)",
    "/a/y",
  ];
  for (const construct of cases) {
    const { result } = compileRust({
      surfaces: ["js"],
      files: { "index.ts": `export function f(pattern: string, s: string): boolean {\n  const re = ${construct};\n  return re.test(s);\n}\n` },
    });
    assert.equal(result.artifacts.length, 0, `${construct} must fail closed`);
    assert.ok(result.diagnostics.length > 0, construct);
  }
});

test("generated cargo binary proves the RegExp subset against oracle expectations", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "regexp_proof" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";

export function main(): void {
  let ok = false;
  try {
    check(/ab+c/.test("xabbc"));
    check(!/ab+c/i.test("XYZ"));
    check(/AB/i.test("ab"));
    const doubled = "a1b2".replace(/[0-9]/g, "#");
    check(doubled === "a#b#");
    const first = "a1b2".replace(/[0-9]/, "#");
    check(first === "a#b2");
    const parts = "a-b-c".split(/-/);
    check(parts.length === 3);
    check((parts[0] ?? "") === "a");
    check("hello world".search(/world/) === 6);
    check("hello".search(/z/) === -1);
    const digits = new RegExp("\\\\d+", "g");
    check(digits.lastIndex === 0);
    check(digits.test("a1b2"));
    check(digits.lastIndex === 2);
    check(digits.test("a1b2"));
    check(digits.lastIndex === 4);
    check(!digits.test("a1b2"));
    check(digits.lastIndex === 0);
    const pretty = JSON.stringify(JSON.parse("{\\"a\\":1}"), null, 2);
    check(pretty.includes("\\n"));
    check(Date.parse("2026-07-03") > 0);
    check(Date.UTC(2026, 0, 1, 0, 0, 0, 0) > 0);
    const swapped = "john smith".replace(/(\\w+) (\\w+)/, "$2 $1");
    check(swapped === "smith john");
    ok = true;
  } catch (error) {
    ok = false;
  }
  check(ok);
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const run = validateGeneratedProject("regexp-proof-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("grand proof: js surface, node, third-party, async, JSON, RegExp, multi-module in one binary", { timeout: 300_000 }, async () => {
  const { nodejsCapability, acmeSuperbunapiCapability } = await import("./helpers/rust-session.mjs");
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    packages: [acmeSuperbunapiCapability(), acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "grand_proof" } },
    files: {
      "text.ts": `
export function slug(value: string): string {
  const joined = value.replace(/\\s+/g, "-");
  return joined.toLowerCase();
}
`,
      "index.ts": `
import { slug } from "./text.js";
import { serve } from "superbunapi";
import { writeFile, readFile, rm } from "node:fs/promises";
import { platform } from "node:process";
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

export async function roundtrip(name: string): Promise<int32> {
  await writeFile(name, "grand proof", "utf8");
  const text = await readFile(name, "utf8");
  await rm(name);
  return text.length;
}

export function main(): void {
  let ok = false;
  try {
    check(slug("Grand  Proof") === "grand-proof");
    check(serve(4000) === "superbunapi:4000");
    check(platform.length > 0);
    const value = JSON.parse("{\\"tag\\": \\"tsonic\\"}");
    const rendered = JSON.stringify(value);
    check(rendered.includes("tsonic"));
    check(Math.floor(11.9) === 11);
    const xs: int32[] = [1, 2, 3];
    const doubled = xs.map((x) => x * 2);
    check(doubled.reduce((acc, x) => acc + x, 0) === 12);
    ok = true;
  } catch (error) {
    ok = false;
  }
  check(ok);
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const run = validateGeneratedProject("grand-proof-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});
