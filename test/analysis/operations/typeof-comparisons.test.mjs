import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";

// Paired with the C# owner test test/analysis/operations/typeof-comparisons.test.mjs: the same sources.
// Rust recognizes typeof guards through the shared selectSourceNativeValueGuard, so every wrapped form
// must produce exactly the result of its unwrapped form. Rust keeps source operand order, so a reversed
// form is paired with the reversed unwrapped form.
const forms = [
  ["reversed parenthesized", `("string") === (typeof x)`, `"string" === typeof x`],
  ["parenthesized typeof", `(typeof x) === "string"`, `typeof x === "string"`],
  ["parenthesized operand", `typeof (x) === "string"`, `typeof x === "string"`],
  ["parenthesized literal", `typeof x === ("string")`, `typeof x === "string"`],
  ["parenthesized everywhere", `(typeof (x)) === ("string")`, `typeof x === "string"`],
  ["negated parenthesized typeof", `(typeof x) !== "number"`, `typeof x !== "number"`],
  ["loose parenthesized typeof", `(typeof x) == "string"`, `typeof x == "string"`],
];

const sourceText = condition => `export function f(x: string | number): number {\n  if (${condition}) return 1;\n  return 0;\n}\n`;

function compileComparison(surfaces, condition) {
  const { result } = compileRust({ ...(surfaces === undefined ? {} : { surfaces }), files: { "index.ts": sourceText(condition) } });
  return {
    diagnostics: result.diagnostics.map(diagnostic => diagnostic.code),
    rust: result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n"),
  };
}

for (const surfaces of [undefined, ["js"]]) {
  for (const [name, form, unwrapped] of forms) {
    test(`${name} typeof comparisons match the unwrapped form on Rust ${surfaces === undefined ? "native" : "js"}`, { timeout: 300_000 }, () => {
      const expected = compileComparison(surfaces, unwrapped);
      const actual = compileComparison(surfaces, form);
      assert.deepEqual(actual.diagnostics, expected.diagnostics);
      assert.equal(actual.rust, expected.rust);
    });
  }
}
