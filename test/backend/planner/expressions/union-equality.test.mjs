import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustTargetOperationFactKey } from "../../../../dist/analysis/facts/keys.js";
import { planBinaryExpression } from "../../../../dist/backend/planner/expressions/binary.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";

test("union equality rejects stale carriers, paths, operations, coverage and polarity", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
class Token { value: number = 1; }
export function same(value: string | Token): boolean { return value === "a"; }
` } });
  const { ast } = program.source;
  const operations = [];
  const visit = node => {
    const fact = program.facts.getFact(node, rustTargetOperationFactKey);
    if (fact?.kind === "union-equality") operations.push({ node, fact });
    for (const child of ast.children(node)) visit(child);
  };
  for (const sourceFile of program.sourceFiles) visit(sourceFile);
  assert.equal(operations.length, 1);
  const { node, fact } = operations[0];
  assert.ok(Object.isFrozen(fact.arms) && fact.arms.every(Object.isFrozen));
  const context = selected => ({ input: { program: { ...program,
    facts: { ...program.facts, getFact: (subject, key) => subject === node && key === rustTargetOperationFactKey
      ? selected : program.facts.getFact(subject, key) } } }, diagnostics: [],
    sourceFile: ast.getSourceFile(node), usedAliases: new Set(),
    syntheticNames: createRustSyntheticNameState(ast, node, []),
    moduleName: "index", structuralShapesModuleName: "shapes",
    moduleNameByFileName: new Map([["/src/index.ts", "index"]]), externalCrateNameByFileName: new Map(),
    externalItemPathByIdentity: new Map(), externalStructuralShapeModuleByFileName: new Map(),
  });
  const valid = context(fact);
  assert.ok(planBinaryExpression(node, valid), JSON.stringify(valid.diagnostics));
  assert.deepEqual(valid.diagnostics, []);
  const arm = fact.arms[0];
  const mutations = [
    { arms: undefined }, { arms: [] }, { arms: [arm, arm] }, { arms: new Array(1) },
    { arms: [{ ...arm, left: { ...arm.left, path: [] } }] },
    { arms: [{ ...arm, operation: { ...arm.operation, rustOperator: "!=" } }] },
    { arms: [{ ...arm, right: { ...arm.right, carrier: rustSourcePrimitiveTargetType("int64") } }] },
    { exhaustive: true }, { negated: true }, { negated: "false" },
    { leftCarrier: undefined }, { rightCarrier: rustSourcePrimitiveTargetType("int64") },
    { resultCarrier: rustSourcePrimitiveTargetType("int64") }, { operationId: "changed" },
  ];
  for (const mutation of mutations) {
    const selected = context({ ...fact, ...mutation });
    assert.equal(planBinaryExpression(node, selected), undefined, JSON.stringify(mutation));
    assert.ok(selected.diagnostics.some(diagnostic => diagnostic.code === "RUST_MISSING_TARGET_FACT"));
  }
});
