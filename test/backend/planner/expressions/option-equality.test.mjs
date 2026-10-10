import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustTargetOperationFactKey } from "../../../../dist/analysis/facts/keys.js";
import { planBinaryExpression } from "../../../../dist/backend/planner/expressions/binary.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustOptionTargetType, rustStringTargetType, rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";

test("optional equality rejects forged native carriers, borrowed views, presence depths and operators", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
    export function equal(left: string | undefined, right: string): boolean { return left === right; }
    export function unequal(left: string | undefined, right: string | undefined): boolean { return left !== right; }
  ` } });
  const { ast } = program.source;
  const operations = [];
  const visit = node => {
    const fact = program.facts.getFact(node, rustTargetOperationFactKey);
    if (fact?.kind === "option-equality") operations.push({ node, fact });
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(operations.length, 2);
  for (const { node, fact } of operations) {
    const context = selected => ({ input: { program: { ...program,
      facts: { ...program.facts, getFact: (subject, key) => subject === node && key === rustTargetOperationFactKey
        ? selected : program.facts.getFact(subject, key) } } }, diagnostics: [],
      sourceFile: ast.getSourceFile(node), usedAliases: new Set(),
      syntheticNames: createRustSyntheticNameState(ast, node, []), moduleName: "index", structuralShapesModuleName: "shapes",
      moduleNameByFileName: new Map([["/src/index.ts", "index"]]), externalCrateNameByFileName: new Map(),
      externalItemPathByIdentity: new Map(), externalStructuralShapeModuleByFileName: new Map(),
    });
    const accepted = context(fact);
    assert.equal(planBinaryExpression(node, accepted) !== undefined, true, "unchanged exact fact plans");
    assert.equal(accepted.diagnostics.length, 0);
    for (const mutation of [
      { borrowString: false }, { leftLiftDepth: -1 }, { rightLiftDepth: fact.rightLiftDepth + 1 },
      { rightLiftDepth: Infinity }, { leftCarrier: rustSourcePrimitiveTargetType("int64") },
      { rightCarrier: rustSourcePrimitiveTargetType("int64") }, { comparisonCarrier: rustOptionTargetType(rustStringTargetType()) },
      { negated: !fact.negated }, { negated: "false" }, { operationId: "forged" }, { guessed: true },
    ]) {
      if (Object.keys(mutation).every(key => mutation[key] === fact[key])) continue;
      const rejected = context({ ...fact, ...mutation });
      assert.equal(planBinaryExpression(node, rejected) === undefined, true, Object.keys(mutation).join(","));
      assert.equal(rejected.diagnostics.some(diagnostic => diagnostic.code === "RUST_MISSING_TARGET_FACT"), true);
    }
  }
});
