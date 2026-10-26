import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { BinaryExpression_Left, BinaryExpression_Right, Node_Expression, sourceEnclosingCallable } from "@tsonic/target-api/source";
import { rustSourceFilePlanContext } from "../../helpers/plan-context.mjs";
import { planBinaryExpression } from "../../../dist/backend/planner/expressions/binary.js";
import { printRustExpr } from "../../../dist/print/source/index.js";
import { planRustErrorRegion } from "../../../dist/backend/planner/program/error-regions.js";
import { rustStrTargetType } from "../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustErrorFieldComparisonView } from "../../../dist/backend/planner/expressions/error-field-borrows.js";
import { borrowedComparisonMutationSource, closedUnionEqualitySource } from "../../../../tsonic/test/fixtures/closed-union-equality.mjs";

const nativeClosedUnionComparisonSource = `
import type { int32 } from "@tsonic/core/types.js";
class Token { value: int32 = 3; }
type TextOrToken = string | Token;
export function path(value: TextOrToken): boolean { return value === "/" && "/" === value; }
`;

test("native category views preserve exact transparent source and an already acquired override", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
export function observe(value: unknown): boolean { return (typeof value) === "string"; }
export function owned(value: unknown): string { return typeof value; }
` } });
  const { ast } = program.source;
  let comparison;
  let owning;
  const visit = node => {
    const view = program.records.stringComparisonView.get(node);
    if (view?.kind === "runtime-category") comparison = { node, view };
    if (ast.kindName(node) === "KindTypeOfExpression" && ast.is.IsReturnStatement(ast.parent(node))) owning = node;
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(comparison !== undefined && owning !== undefined, true, "both actual observing and owning categories retain their source occurrences");
  assert.equal(program.records.targetOperation.get(comparison.view.expression)?.kind, "typeof",
    "the view names the selected actual typeof expression through its transparent parenthesis");
  assert.equal(program.records.stringComparisonView.get(owning)?.kind, "value", "an owning source result does not acquire a comparison-only borrow");
  const acquired = { kind: "path", path: "acquired_category" };
  const context = { ...rustSourceFilePlanContext(program, comparison.node), expressionOverrides: new Map([
    [comparison.view.expression, { expression: acquired, valueForm: "value" }],
  ]) };
  assert.equal(rustErrorFieldComparisonView(comparison.node, acquired, undefined, context) === acquired, true,
    "an already acquired native result is reused exactly, never replayed from its operand");
});

for (const [label, expression, view] of [
  ["parenthesized", '((("17")))', "value"],
  ["asserted", '((("17" as string)))', "literal"],
  ["satisfied", '((("17" satisfies string)))', "value"],
  ["non-null", '((("17" as string)!))', "literal"],
]) test(`native literal argument views preserve exact transparent ${label} source`, () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
export function inspect(): number { return parseInt(${expression}, 10); }
export function converted(): unknown { return (("17" as unknown)); }
` } });
  const ast = program.source.ast;
  const arguments_ = [];
  const converted = [];
  const visit = node => {
    if (ast.is.IsCallExpression(node) && ast.text(ast.as.AsCallExpression(node).Expression) === "parseInt")
      arguments_.push(ast.arguments(node)[0]);
    if (ast.is.IsAsExpression(node) && sourceEnclosingCallable(node, ast) !== undefined &&
      ast.text(ast.name(sourceEnclosingCallable(node, ast))) === "converted") converted.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(arguments_.length, 1, "the actual selected provider input is present exactly once");
  const selected = program.records.stringComparisonView.get(arguments_[0]);
  assert.equal(selected?.kind, view, "only an actually widened native String needs the literal borrowing recipe");
  if (view === "literal") assert.equal(selected.value, "17", "the exact checked literal content is retained");
  else {
    const carrier = program.records.valueRead.get(arguments_[0])?.value;
    assert.equal(carrier?.kind === "reference" && rustTargetTypeRefEquals(carrier.referent, rustStrTargetType()), true,
      "an already-borrowed native str retains its existing exact carrier rather than acquiring an owned String view");
  }
  assert.equal(converted.length, 1, "the nonidentity native source conversion remains in the same checked program");
  assert.equal(program.records.stringComparisonView.get(converted[0])?.kind, "value",
    "a real closed-value conversion cannot be replaced by its inner literal storage");
});

for (const surfaces of [[], ["js"]]) {
  for (const [label, source] of [["borrowed union payload", surfaces.length === 0 ? nativeClosedUnionComparisonSource : closedUnionEqualitySource],
    ["owned effect snapshot", borrowedComparisonMutationSource]]) {
    test(`native String input forms reuse the completed comparison decision for ${label} on ${surfaces[0] ?? "native"}`, () => {
      const { program } = analyzeRust({ surfaces, files: { "index.ts": source } });
      const { ast } = program.source;
      let views = 0;
      let borrowedProjection = 0;
      let snapshots = 0;
      const visit = node => {
        const binary = program.records.binaryEmission.get(node);
        if (binary?.operator === "==" || binary?.operator === "!=") {
          for (const [operand, shared] of [[binary.left, binary.leftShared], [binary.right, binary.rightShared]]) {
            const view = program.records.stringComparisonView.get(operand);
            if (view?.kind !== "native-str-reference") continue;
            views += 1;
            assert.equal(view.inputForm, shared ? "shared-reference" : "value",
              `${label}: the view copies its exact completed operand decision without new ownership arbitration`);
            const read = program.records.readOwnership.get(operand);
            if (program.records.flowReadProjection.get(operand) !== undefined && shared) {
              borrowedProjection += 1;
              assert.equal(read?.value.kind, "borrow", "the original narrowed payload is genuinely shared");
            }
            if (read?.value.kind === "clone") {
              snapshots += 1;
              assert.equal(view.inputForm, "value", "an owned first-value snapshot cannot be turned back into a shared source read");
              assert.equal(shared, false, "the completed later-effect decision stays authoritative");
            }
          }
        }
        ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
      };
      program.sourceFiles.forEach(visit);
      assert.equal(views > 0, true, `${label}: the actual source exercises the native String view owner`);
      if (label === "borrowed union payload") assert.equal(borrowedProjection > 0, true,
        "the retained native borrow_deref_ref witness reaches its actual shared flow payload");
      else assert.equal(snapshots > 0, true, "the actual same-owner RHS replacement still requires its first-value snapshot");
    });
  }
  test(`native empty-string recipes retain their receiver input without an unused comparison view on ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
export function empty(value: string): boolean { return value === ""; }
export function nonempty(value: string): boolean { return "" !== value; }
` } });
    const { ast } = program.source;
    const selected = [];
    const visit = node => {
      const comparison = program.records.nativeComparison.get(node);
      if (comparison?.kind === "empty-string") {
        const binary = program.records.binaryEmission.get(node);
        assert.equal(binary?.fact.kind, "operator-token", "the actual selected native method retains its finalized binary evidence");
        const operand = comparison.operand === "left" ? binary.left : binary.right;
        assert.equal(program.records.stringComparisonView.get(operand)?.kind, "value",
          "a native is_empty receiver is not given an unused AsRef comparison input");
        assert.equal(comparison.operand === "left" ? binary.leftShared : binary.rightShared, true,
          "the actual native method observation retains its original shared ownership decision");
        selected.push(`${comparison.operand}:${comparison.negated}`);
      }
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.deepEqual(selected.sort(), ["left:false", "right:true"],
      "both real empty-string polarities retain their exact admitted operand without reselecting a view");
  });
}

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
    assert.equal(program.records.stringComparisonView.get(right)?.kind, call ? "native-str-reference" : "literal",
      `${label}: native String or str reference and native literal representations remain distinct`);
    assert.equal(program.records.errorFieldSnapshot.get(left, right), label === "mutate",
      `${label}: only actual same-owner writes require an owned first-value snapshot`);
    const rendered = planBinaryExpression(node, rustSourceFilePlanContext(program, node));
    assert.equal(rendered !== undefined, true, `${label}: the admitted comparison renders without reselecting its view`);
    const printed = printRustExpr(rendered);
    if (call) {
      assert.match(printed, /core::convert::AsRef::<str>::as_ref/u,
        `${label}: the actual native String or str reference supplies its view without ownership conversion`);
      assert.equal(printed.includes(".as_str()"), false, `${label}: a native borrowed str is not treated as an owned String`);
      assert.equal((printed.match(new RegExp(`\\b${label}\\(`, "gu")) ?? []).length, 1,
        `${label}: the complete right-hand side is evaluated once`);
    }
    assert.equal(printed.includes("error_snapshot"), label === "mutate",
      `${label}: rendering retains the exact pre-seal snapshot decision`);
  }
});

test("native comparison views cover parameter, borrowed result, capture, owned local and indexed String reads", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
function read(value: string): string { return value; }
export function compare(values: readonly string[], expected: string): boolean {
  let owned = "owned";
  owned += expected;
  const captured = (): boolean => expected === read(expected);
  return values[0]! === expected && read(expected) === expected && owned === expected && captured();
}
` } });
  const ast = program.source.ast;
  const comparisons = [];
  const visit = node => {
    if (program.records.binaryEmission.get(node)?.operator === "==") comparisons.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(comparisons.length, 4, "every captured, borrowed, indexed and owned comparison is admitted");
  for (const node of comparisons) {
    const operands = [BinaryExpression_Left(ast, node), BinaryExpression_Right(ast, node)];
    for (const operand of operands) {
      const label = ast.kindName(operand);
      assert.equal(program.records.stringComparisonView.get(operand)?.kind, "native-str-reference",
        `${label}: native String and str-backed reads have one pre-seal AsRef view`);
    }
    const context = rustSourceFilePlanContext(program, node);
    const declaration = sourceEnclosingCallable(node, ast);
    assert.equal(declaration !== undefined, true, "the comparison has its actual checked callable owner");
    const region = planRustErrorRegion(declaration, context);
    assert.equal(region !== undefined, true, "indexed conversion uses its completed native error region");
    const rendered = planBinaryExpression(node, { ...context, callableDeclaration: declaration,
      fallibleBoundary: region.boundary });
    assert.equal(rendered !== undefined, true, "the exact admitted comparison renders");
    const printed = printRustExpr(rendered);
    assert.equal((printed.match(/core::convert::AsRef::<str>::as_ref/gu) ?? []).length, 2,
      "both native operands get their independently selected str view");
    assert.equal(printed.includes(".as_str()"), false, "borrowed str never requires unstable str_as_str");
    assert.equal(printed.includes("to_string"), false, "a native comparison does not manufacture an owned String");
    const consumingCalls = operands.filter(operand => ast.is.IsCallExpression(operand));
    for (const call of consumingCalls) {
      const argument = ast.arguments(call)[0];
      assert.equal(program.records.argumentPassing.get(argument)?.mode, "by-value",
        "the actual selected String-returning call consumes its argument");
    }
    assert.equal((printed.match(/\.clone\(\)/gu) ?? []).length, consumingCalls.length,
      "only a genuine owning call needs its one retained-input or first-value snapshot");
    if (consumingCalls.length === 0) assert.equal(printed.includes(".clone()"), false,
      "pure native string observation does not copy its owner");
  }
});
