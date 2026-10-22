import { createRustRecordFixture } from "../../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";

import { planBinaryExpression } from "../../../../dist/backend/planner/expressions/binary.js";
import { analyzeRustOptionEquality } from "../../../../dist/analysis/operations/option-equality.js";
import { createRustOptionEqualityProducer } from "../../../../dist/analysis/program/records/option-equality.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustOptionTargetType, rustStringTargetType, rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";

test("optional equality rejects forged native carriers, borrowed views, presence depths and operators", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
    export function equal(left: string | undefined, right: string): boolean { return left === right; }
    export function unequal(left: string | undefined, right: string | undefined): boolean { return left !== right; }
    export function identity(left: string[] | undefined, right: string[]): boolean { return left === right; }
  ` } });
  const { ast } = program.source;
  const operations = [];
  const visit = node => {
    const fact = program.records.targetOperation.get(node);
    if (fact?.kind === "option-equality") operations.push({ node, fact });
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile).forEach(visit);
  assert.equal(operations.length, 3);
  for (const { node, fact } of operations) {
    const context = selected => ({ input: { program: { ...program,
      records: createRustRecordFixture({
targetOperation: { get: (subject) => subject === node
    ? selected : program.records.targetOperation.get(subject) }}, program.records) } }, diagnostics: [],
      sourceFile: ast.getSourceFile(node), usedAliases: new Set(),
      syntheticNames: createRustSyntheticNameState(ast, node, []), moduleName: "index", structuralShapesModuleName: "shapes",
      moduleNameByFileName: new Map([["/src/index.ts", "index"]]), externalCrateNameByFileName: new Map(),
      externalItemPathByIdentity: new Map(), externalStructuralShapeModuleByFileName: new Map(),
    });
    const accepted = context(fact);
    assert.equal(planBinaryExpression(node, accepted) !== undefined, true, "unchanged exact fact plans");
    assert.equal(accepted.diagnostics.length, 0);
    for (const mutation of [
      { view: "value" }, { view: "shared" }, { view: "forged" }, { borrowString: true },
      { leftLiftDepth: -1 }, { rightLiftDepth: fact.rightLiftDepth + 1 },
      { rightLiftDepth: Infinity }, { leftCarrier: rustSourcePrimitiveTargetType("int64") },
      { rightCarrier: rustSourcePrimitiveTargetType("int64") }, { comparisonCarrier: rustOptionTargetType(rustStringTargetType()) },
      { negated: !fact.negated }, { negated: "false" }, { operationId: "forged" }, { guessed: true },
    ]) {
      if (Object.keys(mutation).every(key => mutation[key] === fact[key])) continue;
      // A forged operation record stops at the analysis owner's invariant before any emission plan is sealed
      // (RULINGS 2026-10-22: forged-record rejection is asserted at the invariant).
      const forged = { ...program, records: { ...program.records,
        targetOperation: { get: subject => subject === node ? { ...fact, ...mutation } : program.records.targetOperation.get(subject) } } };
      assert.throws(() => analyzeRustOptionEquality(forged, [node], createRustOptionEqualityProducer(() => undefined)),
        /Option equality conflicts with its exact native operand carriers, borrowed view, presence depth or selected operation/u,
        Object.keys(mutation).join(","));
    }
  }
});

// Nested optional payload views (Option<Option<Option<T>>>) are not produced by any compiled program: optional
// storage of an optional generic stays generic (rt::OptionalStorage) and the native lane never nests absence
// (native-absence.test.mjs asserts no JsArray<Option<Option<..>>>). The two rendering tests for three-level views
// planned hand-built carriers the analysis never seals, so they were removed as unreachable (RULINGS 2026-10-22).
