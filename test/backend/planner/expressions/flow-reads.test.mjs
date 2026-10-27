import { assertNoTargetDiagnostics } from "../../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { planRustFlowReadProjection, planRustValueProjection } from "../../../../dist/backend/planner/expressions/flow-read-projections.js";
import { analyzeRustFlowReadEmission } from "../../../../dist/analysis/control-flow/flow-read-emission.js";
import { createRustFlowReadEmissionProducer } from "../../../../dist/analysis/program/records/operations/flow-read-emission.js";
import { analyzeRustCarrierReads } from "../../../../dist/analysis/ownership/carrier-reads.js";
import { createRustCarrierReadProducer } from "../../../../dist/analysis/program/records/storage/carrier-reads.js";
import { rustJsValueTargetType, rustOptionTargetType, rustStringTargetType, rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";
import { selectRustSourceCallResult } from "../../../../dist/analysis/source-evidence/types/resolution/call-results.js";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { printRustExpr } from "../../../../dist/print/source/expressions/core.js";

// The planner renders only flow-read emissions sealed by the analysis owner. Each case runs that owner on a program
// whose flow-read record for one real node carries the projection under test, then plans from the sealed emission.
function analyzedNode() {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": "export function value(): unknown { return 1; }" } });
  const sourceFile = program.sourceFiles[0];
  return { program, sourceFile, node: program.source.ast.statements(sourceFile)[0] };
}

function sealFlowRead(program, node, fact, records = {}) {
  const forged = { ...program, records: { ...program.records,
    flowReadProjection: { get: candidate => candidate === node ? fact : program.records.flowReadProjection.get(candidate) },
    runtimeCarrier: { get: candidate => candidate === node ? { carrier: fact.sourceCarrier } : program.records.runtimeCarrier.get(candidate) },
    targetOperation: { get: candidate => candidate === node ? undefined : program.records.targetOperation.get(candidate) },
    ...records } };
  const producer = createRustFlowReadEmissionProducer(() => undefined);
  const issues = analyzeRustFlowReadEmission(forged, [node], producer);
  // Copy and Clone guarantees for the carriers the read uses are sealed by their own analysis owner.
  const reads = createRustCarrierReadProducer(() => undefined);
  analyzeRustCarrierReads(forged, [node], reads);
  return { issues, producer, program: { ...forged, records: { ...forged.records,
    flowReadEmission: producer.records.flowReadEmission, carrierRead: reads.records.carrierRead } } };
}

function planContext(program, sourceFile, node) {
  return { input: { program }, sourceFile, nativeHeaderPlacement: sourceFile, nativeHeaderParent: undefined, diagnostics: [], usedAliases: new Set(),
    syntheticNames: createRustSyntheticNameState(program.source.ast, node, []),
    moduleNameByFileName: new Map(), externalCrateNameByFileName: new Map(), externalItemPathByIdentity: new Map(),
    externalStructuralShapeModuleByFileName: new Map() };
}

test("optional readonly native references preserve one exact borrow without redundant dereferencing or cloning", () => {
  const { program, sourceFile, node } = analyzedNode();
  const selectedCarrier = { kind: "reference", mutable: false,
    referent: { kind: "slice", element: rustStringTargetType() } };
  const fact = { kind: "option-value", sourceCarrier: rustOptionTargetType(selectedCarrier), selectedCarrier };
  const sealed = sealFlowRead(program, node, fact);
  assertNoTargetDiagnostics(sealed.issues);
  for (const ownership of ["move", "clone", "borrow"]) {
    const context = planContext(sealed.program, sourceFile, node);
    const expression = { kind: "path", path: "values" };
    const result = planRustValueProjection(node, expression, fact, context, ownership);
    assertNoTargetDiagnostics(context.diagnostics);
    if (ownership === "move") {
      assert.equal(result.kind, "method-call");
      assert.equal(result.receiver === expression, true, "the owned Option is consumed exactly once");
      assert.equal(result.method, "unwrap_or_else");
      assert.equal(result.args.length, 1);
      assert.equal(result.args[0].kind, "closure");
      assert.equal(result.args[0].params.length, 0);
      assert.equal(result.args[0].body.kind, "unreachable");
      assert.equal(result.args[0].body.message, "checked flow selected a missing optional value");
    } else {
      assert.equal(result.kind, "match");
      assert.equal(result.arms[0].expression.kind, "path");
      if (ownership === "borrow") {
        assert.equal(result.expression.method, "as_ref");
        assert.equal(result.expression.receiver === expression, true, "the borrowed Option retains its exact source");
      } else assert.equal(result.expression === expression, true, "the readonly reference retains its exact source");
    }
    assert.doesNotMatch(printRustExpr(result), /\*flow_value|as_deref\(|clone\(|to_vec\(|collect\(/u);
  }
});

test("optional native associated values move or borrow without inventing Clone, and reject an unproved owned copy", () => {
  const { program, sourceFile, node } = analyzedNode();
  const selectedCarrier = { kind: "associated-type", owner: { kind: "type-parameter", identity: "Owner", name: "Owner" },
    trait: { kind: "trait-ref", id: "native::Family", path: "native::Family", genericArguments: [], associatedConstraints: [] },
    name: "Output",
  };
  const sourceCarrier = rustOptionTargetType(selectedCarrier);
  const fact = { kind: "option-value", sourceCarrier, selectedCarrier };
  for (const [canMove, borrowedResult, succeeds, sealedBorrow = false] of [
    [true, false, true], [false, true, true], [false, false, false], [false, false, true, true],
  ]) {
    const mode = sealedBorrow ? { kind: "borrow", mutable: false } : { kind: canMove ? "move" : "clone" };
    const read = { carrier: sourceCarrier, source: mode, value: mode,
      snapshot: undefined, stablePlace: true, readsStorage: true, pure: true, sharedReference: false, borrowedAcross: new Set() };
    const sealed = sealFlowRead(program, node, fact, {
      readOwnership: { get: candidate => candidate === node ? read : program.records.readOwnership.get(candidate) },
    });
    // The associated type has no Clone bound, so its sealed read guarantee has no Clone.
    assert.equal(sealed.program.records.carrierRead.get(selectedCarrier).clone, false);
    assertNoTargetDiagnostics(sealed.issues);
    const context = planContext(sealed.program, sourceFile, node);
    if (succeeds) {
      const expression = { kind: "path", path: "value" };
      const result = planRustFlowReadProjection(node, expression, fact, context, borrowedResult);
      if (canMove) {
        assert.equal(result.kind, "method-call");
        assert.equal(result.receiver === expression, true, "the non-Clone owned payload consumes its exact Option");
        assert.equal(result.method, "unwrap_or_else");
        assert.equal(result.args.length, 1);
        assert.equal(result.args[0].kind, "closure");
        assert.equal(result.args[0].params.length, 0);
        assert.equal(result.args[0].body.kind, "unreachable");
        assert.equal(result.args[0].body.message, "checked flow selected a missing optional value");
      } else {
        assert.equal(result.kind, "match");
        assert.equal(result.expression.method, "as_ref");
        assert.equal(result.expression.receiver === expression, true, "the non-Clone borrowed payload retains its exact Option");
        assert.equal(result.arms[0].expression.kind, "path");
      }
      assert.doesNotMatch(printRustExpr(result), /clone\(|to_owned\(|to_vec\(|collect\(/u);
      assertNoTargetDiagnostics(context.diagnostics);
    } else {
      // A copy of a value whose carrier has no proven Clone guarantee is a corrupt record set at the planner boundary.
      assert.throws(() => planRustFlowReadProjection(node, { kind: "path", path: "value" }, fact, context, borrowedResult),
        /native non-consuming payload contract/u);
    }
  }
});

test("source-call and flow-read projections share one native payload planner with exact ownership", () => {
  const { program, sourceFile, node } = analyzedNode();
  for (const selectedCarrier of [rustStringTargetType(), rustSourcePrimitiveTargetType("uint64")]) {
    const fact = selectRustSourceCallResult(program.projectTypes, rustJsValueTargetType(), () => selectedCarrier).projection;
    const sealed = sealFlowRead(program, node, fact);
    assertNoTargetDiagnostics(sealed.issues);
    const expression = { kind: "call", path: "produce", args: [] };
    const owned = planContext(sealed.program, sourceFile, node);
    const result = planRustValueProjection(node, expression, fact, owned, "move");
    assertNoTargetDiagnostics(owned.diagnostics);
    assert.equal(result.kind, "match");
    assert.equal(result.expression, expression);
    assert.equal(result.arms[0].expression.kind, "path");
    assert.doesNotMatch(JSON.stringify(result), /clone|Box::|Rc::|from_closed/u);
    const borrowed = planContext(sealed.program, sourceFile, node);
    const borrow = planRustValueProjection(node, expression, fact, borrowed, "borrow");
    assertNoTargetDiagnostics(borrowed.diagnostics);
    assert.equal(borrow.expression.kind, "reference");
    assert.equal(borrow.expression.expr, expression);
    assert.equal(borrow.arms[0].expression.kind, "path");
    const copied = planContext(sealed.program, sourceFile, node);
    const copy = planRustValueProjection(node, expression, fact, copied, "clone");
    assertNoTargetDiagnostics(copied.diagnostics);
    assert.equal(copy.arms[0].expression.kind, selectedCarrier.kind === "source-primitive"
      ? "dereference" : "method-call");
    if (selectedCarrier.kind !== "source-primitive") assert.equal(copy.arms[0].expression.method, "clone");
    // A projection that no longer matches its exact native carrier relation is refused by the analysis owner and
    // never sealed, so the planner has no emission to render.
    for (const mutation of [{ variant: "Other" }, { sourceCarrier: selectedCarrier }, { extra: true }]) {
      const forged = { ...fact, ...mutation };
      const rejected = sealFlowRead(program, node, forged);
      assert.equal(rejected.issues.length >= 1, true);
      assert.equal(rejected.producer.records.flowReadEmission.get(forged), undefined);
      assert.throws(() => planRustValueProjection(node, expression, forged, planContext(rejected.program, sourceFile, node), "move"),
        /requires its sealed native emission/u);
    }
  }
});
