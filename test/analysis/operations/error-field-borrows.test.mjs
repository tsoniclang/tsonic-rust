import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { BinaryExpression_Left, BinaryExpression_Right, Node_Expression } from "@tsonic/target-api/source";
import { rustSourceFilePlanContext } from "../../helpers/plan-context.mjs";
import { planBinaryExpression } from "../../../dist/backend/planner/expressions/binary.js";
import { printRustExpr } from "../../../dist/print/source/index.js";

for (const surfaces of [[], ["js"]]) {
  for (const property of ["name", "message", "stack"]) {
    const output = property === "stack" ? "string | undefined" : "string";
    for (const [form, source] of [
      ["parameter", `export function read(error: Error): ${output} { return error.${property}; }`],
      ["capture", `export function read(error: Error): ${output} { const observed = (): ${output} => error.${property}; return observed(); }`],
      ["closed", `export function read(error: Error | string): ${output} { if (typeof error === "string") return error; return error.${property}; }`],
    ]) {
      test(`Error ${property} ${form} observation keeps its exact native shared input on ${surfaces[0] ?? "native"}`, () => {
        const { program } = analyzeRust({ surfaces, files: { "index.ts": source } });
        const selected = [];
        const visit = node => {
          const field = program.records.errorFieldEmission.get(node);
          if (field?.kind === "property" && field.property === property) selected.push(field);
          program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
        };
        for (const artifact of program.records.sourceArtifacts.get()) visit(artifact.sourceFile);
        assert.equal(selected.length, 1, "the authored observation has one physical field owner");
        const field = selected[0];
        const read = program.records.readOwnership.get(field.receiver);
        assert.equal(read !== undefined, true, "the exact checked receiver has a sealed physical read");
        assert.equal(read.source.kind, "borrow", "ErrorObject observation shares its receiver without cloning or moving its owner");
        assert.equal(field.guarded, property === "stack" || field.shared, "the selected native field guard is preserved");
        assert.equal(field.expression !== undefined && field.receiver !== undefined, true,
          "the exact observation and original receiver remain in the one existing record family");
      });
    }
  }
}

test("native String comparison views preserve exact Error guards, required snapshots and single RHS evaluation", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
function read(error: Error): string { return error.message; }
function mutate(error: Error): string { error.message = "after"; return "before"; }
export function compare(error: Error): boolean {
  return error.message === read(error) && error.message === mutate(error) && error.message === "fixed";
}
` } });
  const ast = program.source.ast;
  const comparisons = [];
  const visit = node => {
    if (program.records.binaryEmission.get(node)?.operator === "==") comparisons.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(comparisons.length, 3, "all real native string comparisons reach their one pre-seal owner");
  for (const node of comparisons) {
    const left = BinaryExpression_Left(ast, node);
    const right = BinaryExpression_Right(ast, node);
    const call = ast.is.IsCallExpression(right);
    const label = ast.text(call ? Node_Expression(ast, right) : right);
    assert.equal(program.records.stringComparisonView.get(left)?.kind, "error", `${label}: the actual field guard is preserved`);
    assert.equal(program.records.stringComparisonView.get(right)?.kind, call ? "owned-string" : "literal",
      `${label}: exact native String and native literal representations remain distinct`);
    assert.equal(program.records.errorFieldSnapshot.get(left, right), label === "mutate",
      `${label}: only actual same-owner writes require an owned first-value snapshot`);
    const rendered = planBinaryExpression(node, rustSourceFilePlanContext(program, node));
    assert.equal(rendered !== undefined, true, `${label}: the admitted comparison renders without reselecting its view`);
    const printed = printRustExpr(rendered);
    if (call) {
      assert.match(printed, /\.as_str\(\)/u, `${label}: the native String result supplies its exact str view without allocation`);
      assert.equal((printed.match(new RegExp(`\\b${label}\\(`, "gu")) ?? []).length, 1,
        `${label}: the complete right-hand side is evaluated once`);
    }
    assert.equal(printed.includes("error_snapshot"), label === "mutate",
      `${label}: rendering retains the exact pre-seal snapshot decision`);
  }
});
