import { createRustRecordFixture } from "../../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";

import { planBinaryExpression } from "../../../../dist/backend/planner/expressions/binary.js";
import { analyzeRustOptionEquality } from "../../../../dist/analysis/operations/option-equality.js";
import { createRustOptionEqualityProducer } from "../../../../dist/analysis/program/records/option-equality.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { rustOptionTargetType, rustStringTargetType, rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";
import { optionalArrayComparisonSource } from "../../../../../tsonic/test/fixtures/optional-array-comparisons.mjs";

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
      sourceFile: ast.getSourceFile(node), nativeHeaderPlacement: ast.getSourceFile(node), nativeHeaderParent: undefined, usedAliases: new Set(),
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

test("optional comparison acquisition preserves actual snapshots, moves and stable borrows", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": optionalArrayComparisonSource } });
  const { ast } = program.source;
  const selected = new Map();
  const visit = node => {
    const equality = program.records.optionEquality.get(node);
    if (equality !== undefined && ast.is.IsIdentifier(equality.left)) {
      const name = ast.text(equality.left);
      if (["optional", "inline", "text", "stable"].includes(name) && !selected.has(name)) selected.set(name, { node, equality });
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(selected.size, 4, "all actual effectful and disjoint source comparisons are retained");
  for (const [name, kind] of [["optional", "clone"], ["inline", "move"], ["text", "move"], ["stable", undefined]]) {
    const { equality } = selected.get(name);
    const read = program.records.readOwnership.get(equality.left);
    assert.equal(equality.precedingAcquisition?.kind, kind, name + ": the completed native read owns acquisition");
    assert.equal(kind === undefined || Object.isFrozen(equality.precedingAcquisition), true,
      name + ": the acquisition is immutable sealed data");
    if (kind !== undefined) assert.equal(equality.precedingAcquisition === (read.source.kind === "borrow" ? read.snapshot : read.source), true,
      name + ": no renderer or comparison owner recomputes move or Clone");
  }
  const { node, equality } = selected.get("optional");
  const producer = createRustOptionEqualityProducer(() => undefined);
  const records = { ...program.records, readOwnership: { get: subject => {
    const read = program.records.readOwnership.get(subject);
    return subject === equality.left ? { ...read, snapshot: undefined } : read;
  } } };
  const issues = analyzeRustOptionEquality({ ...program, records }, [node], producer);
  assert.deepEqual(issues.map(issue => issue.code), ["RUST_OPTION_EQUALITY_ACQUISITION_NOT_PROVEN"],
    "a missing native snapshot refuses the comparison rather than borrowing across mutation");
  assert.equal(issues[0].sourceNode === equality.left, true, "the refusal retains the actual first native read");
  assert.equal(producer.records.optionEquality.get(node) === undefined, true, "a refused comparison publishes no emission recipe");
});

// Nested optional payload views (Option<Option<Option<T>>>) are not produced by any compiled program: optional
// storage of an optional generic stays generic (rt::OptionalStorage) and the native lane never nests absence
// (native-absence.test.mjs asserts no JsArray<Option<Option<..>>>). The two rendering tests for three-level views
// planned hand-built carriers the analysis never seals, so they were removed as unreachable (RULINGS 2026-10-22).
