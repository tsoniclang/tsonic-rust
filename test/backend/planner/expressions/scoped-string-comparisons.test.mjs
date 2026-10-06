import assert from "node:assert/strict";
import test from "node:test";
import { BinaryExpression_Left, BinaryExpression_Right } from "@tsonic/target-api/source";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import {
  rustTargetOperationFactKey, rustFlowReadProjectionFactKey, rustProjectUpcastFactKey,
  rustProjectDowncastFactKey, rustCallScopedLifetimeReconciliationFactKey,
  rustContextualValueConversionFactKey, rustOptionProjectionFactKey,
} from "../../../../dist/analysis/facts/keys.js";
import { rustObjectReferenceViewKey } from "../../../../dist/analysis/facts/object-reference-views.js";
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
      const fact = program.facts.getFact(node, rustTargetOperationFactKey);
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
      const context = facts => ({ input: { program: { ...program, facts } }, diagnostics: [], usedAliases: new Set(),
        sourceFile: ast.getSourceFile(row.field), valueFieldLocations: new Map([[row.field, location]]) });
      const plan = (facts = program.facts, fact = row.fact) => planRustScopedStringComparison(row.left, row.right, fact, context(facts));
      const accepted = plan();
      assert.equal(accepted !== undefined, index < 5, `literal selection ${index}`);
      assert.equal(projected, index < 5 ? 1 : 0, `one scoped read ${index}`);
      if (accepted === undefined) continue;
      const printed = printRustExpr(accepted);
      assert.doesNotMatch(printed, /clone|String::|Box::|Rc::/u);
      assert.match(printed, index >= 3 ? /borrowed\.as_str\(\)\.is_empty\(\)/u : /borrowed\.as_str\(\)/u);
      assert.equal(plan(program.facts, { ...row.fact, leftConversion: {} }) === undefined, true, "converted left");
      assert.equal(plan(program.facts, { ...row.fact, rightConversion: {} }) === undefined, true, "converted right");
      assert.equal(plan(program.facts, { ...row.fact, operator: "+" }) === undefined, true, "noncomparison");
      const carrier = program.facts.getRuntimeCarrierFact(row.field).carrier;
      for (const key of [rustFlowReadProjectionFactKey, rustProjectUpcastFactKey, rustProjectDowncastFactKey,
        rustObjectReferenceViewKey, rustCallScopedLifetimeReconciliationFactKey,
        rustContextualValueConversionFactKey, rustOptionProjectionFactKey]) {
        const replacement = { selectedCarrier: carrier, targetCarrier: carrier, resultCarrier: carrier, elementCarrier: carrier };
        const facts = { ...program.facts, getFact: (subject, selectedKey) => subject === row.field && selectedKey === key
          ? replacement : program.facts.getFact(subject, selectedKey) };
        assert.equal(facts.getFact(row.field, key) === replacement, true, "projection mutation is effective");
        assert.equal(plan(facts) === undefined, true, "projected value retains its owning conversion");
      }
      const facts = { ...program.facts, getTargetConversionFact: subject => subject === row.field
        ? { convertedType: carrier } : program.facts.getTargetConversionFact(subject) };
      assert.equal(plan(facts) === undefined, true, "target-converted value");
      const noBorrow = context(program.facts);
      noBorrow.valueFieldLocations.set(row.field, { ...location, withRead: undefined });
      assert.equal(planRustScopedStringComparison(row.left, row.right, row.fact, noBorrow) === undefined, true,
        "an owned read cannot claim a scoped borrow");
    }
  });
}
