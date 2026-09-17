import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustTargetOperationFactKey } from "../../../../dist/analysis/facts/keys.js";
import { planBinaryExpression } from "../../../../dist/backend/planner/expressions/binary.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";

test("sealed option checks reject missing, duplicate, unordered and impossible nullish depths", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
export function missing(values: (number | undefined)[]): boolean {
  return values[0] === undefined;
}
` } });
  const { ast } = program.source;
  const operations = [];
  const visit = node => {
    if (node === undefined) return;
    const fact = program.facts.getFact(node, rustTargetOperationFactKey);
    if (fact?.kind === "option-check") operations.push({ node, fact });
    for (const child of ast.children(node)) visit(child);
  };
  for (const sourceFile of program.sourceFiles) visit(sourceFile);
  assert.equal(operations.length, 1);
  const { node, fact } = operations[0];
  assert.deepEqual(fact.nullishDepths, [0, 1]);
  assert.ok(Object.isFrozen(fact.nullishDepths));
  const context = facts => ({
    input: { program: { ...program, facts } }, diagnostics: [],
    sourceFile: ast.getSourceFile(node), usedAliases: new Set(),
    syntheticNames: createRustSyntheticNameState(ast, node, []),
    moduleName: "index", structuralShapesModuleName: "shapes",
    moduleNameByFileName: new Map(), externalCrateNameByFileName: new Map(),
    externalItemPathByIdentity: new Map(), externalStructuralShapeModuleByFileName: new Map(),
  });
  const valid = context(program.facts);
  assert.ok(planBinaryExpression(node, valid));
  assert.deepEqual(valid.diagnostics, []);
  for (const nullishDepths of [undefined, [], [-1], [0.5], [NaN], [Infinity], [2], [0, 0], [1, 0]]) {
    const selected = context({ ...program.facts, getFact: (subject, key) =>
      subject === node && key === rustTargetOperationFactKey
        ? { ...fact, nullishDepths } : program.facts.getFact(subject, key) });
    assert.equal(planBinaryExpression(node, selected), undefined);
    assert.equal(selected.diagnostics.length, 1);
    assert.equal(selected.diagnostics[0].code, "RUST_MISSING_TARGET_FACT");
    assert.ok(selected.diagnostics[0].evidence.includes("target.capability=rust.backend.option-check-depths"));
  }
});
