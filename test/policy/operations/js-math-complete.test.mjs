import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acmeTestingPackage,
  artifactText,
  compileRust,
} from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("the complete JavaScript Math profile lowers through declarative operation rows", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
export function unary(value: number): number {
  return Math.abs(value) + Math.acos(value) + Math.acosh(value) + Math.asin(value) +
    Math.asinh(value) + Math.atan(value) + Math.atanh(value) + Math.cbrt(value) +
    Math.ceil(value) + Math.cos(value) + Math.cosh(value) + Math.exp(value) +
    Math.expm1(value) + Math.floor(value) + Math.fround(value) + Math.log(value) +
    Math.log1p(value) + Math.log10(value) + Math.log2(value) + Math.round(value) +
    Math.sign(value) + Math.sin(value) + Math.sinh(value) + Math.sqrt(value) +
    Math.tan(value) + Math.tanh(value) + Math.trunc(value);
}

export function other(left: number, right: number): number {
  return Math.atan2(left, right) + Math.pow(left, right) + Math.hypot(left, right) +
    Math.imul(left, right) + Math.clz32(left) + Math.max(left, right) +
    Math.min(left, right) + Math.random();
}

export function constants(): number {
  return Math.E + Math.LN2 + Math.LN10 + Math.LOG2E + Math.LOG10E + Math.PI +
    Math.SQRT1_2 + Math.SQRT2;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  for (const method of [
    "abs", "acos", "acosh", "asin", "asinh", "atan", "atanh", "cbrt",
    "ceil", "cos", "cosh", "exp", "exp_m1", "floor", "ln", "ln_1p",
    "log10", "log2", "sin", "sinh", "sqrt", "tan", "tanh", "trunc",
  ]) {
    assert.ok(text.includes(`.${method}(`), method);
  }
  for (const helper of [
    "math_fround", "math_hypot", "math_imul", "math_pow", "math_round",
    "math_sign", "math_clz32", "math_max", "math_min", "math_random",
  ]) {
    assert.ok(text.includes(`js_abi::${helper}`), helper);
  }
  for (const constant of [
    "MATH_E", "MATH_LN2", "MATH_LN10", "MATH_LOG2E", "MATH_LOG10E",
    "MATH_PI", "MATH_SQRT1_2", "MATH_SQRT2",
  ]) {
    assert.ok(text.includes(`js_abi::${constant}`), constant);
  }
});

test("a generated Rust binary proves JavaScript Math edge semantics", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "math_complete_proof" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";

export function main(): void {
  check(Math.acosh(1) === 0);
  check(Math.asinh(0) === 0);
  check(Math.atanh(0) === 0);
  check(Math.cbrt(27) === 3);
  check(Math.cosh(0) === 1);
  check(Math.expm1(0) === 0);
  check(Math.log1p(0) === 0);
  check(Math.log10(100) === 2);
  check(Math.log2(8) === 3);
  check(Math.sinh(0) === 0);
  check(Math.tanh(0) === 0);
  check(Math.hypot(3, 4) === 5);
  check(Math.imul(2147483647, 2) === -2);
  check(Math.clz32(1) === 31);
  check(Math.fround(1.337) !== 1.337);
  check(Number.isNaN(Math.pow(1, Number.POSITIVE_INFINITY)));
  check(Math.E > 2 && Math.E < 3);
  check(Math.PI > 3 && Math.PI < 4);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const run = validateGeneratedProject("math-complete-proof", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});
