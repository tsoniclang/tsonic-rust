import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";

import { planRustValueProjection } from "../../../../dist/backend/planner/expressions/flow-read-projections.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";
import { analyzeRustFlowReadEmission } from "../../../../dist/analysis/control-flow/flow-read-emission.js";
import { createRustFlowReadEmissionProducer } from "../../../../dist/analysis/program/records/operations/flow-read-emission.js";

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
  program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile).forEach(visit);
  assert.equal(projections.length, 1);
  const { node, fact } = projections[0];
  const context = () => ({
    input: { program }, diagnostics: [], sourceFile: ast.getSourceFile(node), nativeHeaderPlacement: ast.getSourceFile(node), nativeHeaderParent: undefined, usedAliases: new Set(),
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
    const producer = createRustFlowReadEmissionProducer(() => {});
    const issues = analyzeRustFlowReadEmission({ ...program, records: { ...program.records,
      flowReadProjection: { get: subject => subject === node ? changed : undefined },
    } }, [node], producer);
    assert.equal(issues.some(row => row.code === "RUST_MISSING_TARGET_FACT" && row.sourceNode === node), true,
      "the admission owner rejects the identical forged native route");
    assert.equal(producer.records.flowReadEmission.get(changed) === undefined, true,
      "no forged projection reaches rendering");
  }
});
