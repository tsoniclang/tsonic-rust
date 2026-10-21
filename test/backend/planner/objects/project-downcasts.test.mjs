import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";

import { planRustValueProjection } from "../../../../dist/backend/planner/expressions/flow-read-projections.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";

test("owned optional project projections consume the proven payload without cloning", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
class Base { value = 1; }
class Child extends Base { extra = 2; }
export function select(value: Base | undefined): Child | undefined {
  return value instanceof Child ? value : undefined;
}
` } });
  const { ast } = program.source;
  const projections = [];
  const visit = node => {
    const fact = program.records.flowReadProjection.get(node);
    if (fact?.kind === "project-downcast") projections.push({ node, fact });
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(projections.length, 1);
  const { node, fact } = projections[0];
  const context = () => ({
    input: { program }, diagnostics: [], sourceFile: ast.getSourceFile(node), usedAliases: new Set(),
    syntheticNames: createRustSyntheticNameState(ast, node, []), moduleName: "index",
    moduleNameByFileName: new Map([[ast.getFileName(ast.getSourceFile(node)), "index"]]),
    externalCrateNameByFileName: new Map(), externalItemPathByIdentity: new Map(),
    externalStructuralShapeModuleByFileName: new Map(), structuralShapesModuleName: "shapes",
  });
  const value = { kind: "path", path: "input" };
  const selected = context();
  const owned = planRustValueProjection(node, value, fact, selected, "move");
  assert.equal(owned !== undefined, true);
  assert.equal(selected.diagnostics.length, 0);
  assert.equal(owned.method, "unwrap");
  assert.equal(owned.receiver.method, "try_from");
  assert.deepEqual(owned.receiver.args, [{ kind: "method-call", receiver: value, method: "unwrap", args: [] }]);
  assert.doesNotMatch(JSON.stringify(owned), /clone|Box|Rc|Arc/u);
  const borrowed = context();
  assert.equal(planRustValueProjection(node, value, fact, borrowed, "borrow") !== undefined, true);
  assert.equal(borrowed.diagnostics.length, 0);
  for (const changed of [
    { ...fact, sourceCarrier: rustSourcePrimitiveTargetType("bool") },
    { ...fact, dispatchCarrier: rustSourcePrimitiveTargetType("bool") },
    { ...fact, selectedCarrier: rustSourcePrimitiveTargetType("bool") },
    { ...fact, projection: { ...fact.projection, slot: "forged" } },
  ]) {
    const rejected = context();
    assert.equal(planRustValueProjection(node, value, changed, rejected, "move") === undefined, true);
    assert.equal(rejected.diagnostics.some(row => row.code === "RUST_MISSING_TARGET_FACT"), true);
  }
});
