import { createRustRecordFixture } from "../../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { BinaryExpression_Left, BinaryExpression_Right } from "@tsonic/target-api/source";
import { analyzeRust } from "../../../helpers/rust-session.mjs";



import { planRustScopedStringComparison } from "../../../../dist/backend/planner/expressions/scoped-comparisons.js";
import { printRustExpr } from "../../../../dist/print/source/expressions/core.js";

const sourceText = `
export function compare(value: string, other: string): boolean {
  return value === "abc" && "abc" === value && value !== "abc" &&
    value === "" && "" !== value && value !== other;
}
`;

for (const surfaces of [[], ["js"]]) {
  test(`scoped native string comparisons preserve exact borrow and literal boundaries in ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": sourceText } });
    const { ast } = program.source;
    const selected = [];
    const visit = node => {
      const fact = program.records.targetOperation.get(node);
      if (fact?.kind === "operator-token" && (fact.operator === "==" || fact.operator === "!=")) {
        const left = BinaryExpression_Left(ast, node);
        const right = BinaryExpression_Right(ast, node);
        const field = ast.is.IsIdentifier(left) ? left : right;
        selected.push({ left, right, field, fact });
      }
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.equal(selected.length, 6);
    for (const [index, row] of selected.entries()) {
      let projected = 0;
      const location = { bindings: [], read: { kind: "path", path: "snapshot" },
        withRead: project => { projected += 1; return project({ kind: "path", path: "borrowed" }); } };
      const context = records => ({ input: { program: { ...program, records } }, diagnostics: [], usedAliases: new Set(),
        sourceFile: ast.getSourceFile(row.field), valueFieldLocations: new Map([[row.field, location]]) });
      const plan = (records = program.records, fact = row.fact) => planRustScopedStringComparison(row.left, row.right, fact, context(records));
      const accepted = plan();
      assert.equal(accepted !== undefined, index < 5, `literal selection ${index}`);
      assert.equal(projected, index < 5 ? 1 : 0, `one scoped read ${index}`);
      if (accepted === undefined) continue;
      const printed = printRustExpr(accepted);
      assert.doesNotMatch(printed, /clone|String::|Box::|Rc::/u);
      assert.match(printed, index >= 3 ? /borrowed\.as_str\(\)\.is_empty\(\)/u : /borrowed\.as_str\(\)/u);
      assert.equal(plan(program.records, { ...row.fact, leftConversion: {} }) === undefined, true, "converted left");
      assert.equal(plan(program.records, { ...row.fact, rightConversion: {} }) === undefined, true, "converted right");
      assert.equal(plan(program.records, { ...row.fact, operator: "+" }) === undefined, true, "noncomparison");
      const carrier = program.records.runtimeCarrier.get(row.field).carrier;
      for (const key of ["flowReadProjection", "projectUpcast", "projectDowncast",
        "objectReferenceView", "callScopedLifetimeReconciliation",
        "contextualValueConversion", "optionProjection"]) {
        const replacement = { selectedCarrier: carrier, targetCarrier: carrier, resultCarrier: carrier, elementCarrier: carrier };
        const records = { ...program.records, [key]: {
          get: subject => subject === row.field ? replacement : program.records[key].get(subject),
        } };
        assert.equal(records[key].get(row.field) === replacement, true, "projection mutation is effective");
        assert.equal(plan(records) === undefined, true, "projected value retains its owning conversion");
      }
      const records = createRustRecordFixture({
conversion: { get: (subject) => subject === row.field
    ? { convertedType: carrier } : program.records.conversion.get(subject) }}, program.records);
      assert.equal(plan(records) === undefined, true, "target-converted value");
      const noBorrow = context(program.records);
      noBorrow.valueFieldLocations.set(row.field, { ...location, withRead: undefined });
      assert.equal(planRustScopedStringComparison(row.left, row.right, row.fact, noBorrow) === undefined, true,
        "an owned read cannot claim a scoped borrow");
    }
  });
}
