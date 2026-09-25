import assert from "node:assert/strict";
import test from "node:test";
import { nativeIntegerSelectionSource } from "../../../../tsonic/test/fixtures/native-integer-selection.mjs";
import { analyzeRust, artifactText, compileRust, nodejsCapability } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { rustSourceCallableReturnFactKey } from "../../../dist/analysis/facts/keys.js";

test("numeric analysis seals integer joins and native counters while retaining explicit and fractional numbers", () => {
  const { source, program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": nativeIntegerSelectionSource } });
  const returns = new Map();
  const counters = [];
  const visit = node => {
    if (source.ast.is.IsFunctionDeclaration(node)) {
      returns.set(source.ast.text(source.ast.name(node)), program.facts.getFact(node, rustSourceCallableReturnFactKey)?.returnCarrier);
    }
    if (source.ast.is.IsVariableDeclaration(node) && source.ast.text(source.ast.name(node)) === "index") {
      counters.push(program.facts.getRuntimeCarrierFact(node)?.carrier?.name);
    }
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.sourceFiles) visit(file);
  assert.deepEqual(counters, ["native-uint", "native-uint", "float64", "float64", "float64"]);
  for (const name of ["conditional", "conditionalLiteral", "nested"]) {
    assert.deepEqual(returns.get(name), { kind: "source-primitive", name: "int32" }, name);
  }
  for (const name of ["conditionalFraction", "explicitFloat", "fractionalFloor"]) {
    assert.deepEqual(returns.get(name), { kind: "source-primitive", name: "float64" }, name);
  }
});

test("native counters, conditional joins and integer floor preserve exact carriers and fractional controls", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "native_integer_selection" } },
    files: { "index.ts": nativeIntegerSelectionSource + '\nexport function main(): void { if (!run()) throw new Error("native numeric selection"); }' },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /fn conditional\([^)]*\) -> i32/u);
  assert.match(output, /fn conditional_literal\([^)]*\) -> i32/u);
  assert.match(output, /fn explicit_float\([^)]*\) -> f64/u);
  assert.match(output, /fn optional_branch\([^)]*\) -> Option<i32>/u);
  const counted = output.slice(output.indexOf("fn counted("), output.indexOf("fn growing("));
  assert.doesNotMatch(counted, /f64|number_to|float/u);
  const floor = output.slice(output.indexOf("fn integral_floor("), output.indexOf("fn fractional_floor("));
  assert.doesNotMatch(floor, /f64|\.floor\(/u);
  validateGeneratedProject("native-integer-selection", result.artifacts, { run: true });
});

test("floor retains a wide integer behind a provider's number declaration", { timeout: 300_000 }, async () => {
  const { result } = compileRust({ surfaces: ["js"], capabilities: [await nodejsCapability()],
    target: { id: "rust", options: { outputType: "bin", crateName: "wide_integer_floor" } },
    files: { "index.ts": `
      import { statSync } from "node:fs";
      export function main(): void {
        const size = statSync("Cargo.toml").size;
        const rounded = Math.floor(size);
        if (rounded !== size || rounded <= 0) throw new Error("wide integer floor");
      }
    ` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /let rounded: u64/u);
  assert.doesNotMatch(output, /f64|\.floor\(/u);
  validateGeneratedProject("wide-integer-floor", result.artifacts, { run: true });
});
