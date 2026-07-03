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
