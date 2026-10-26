import { assertNoTargetDiagnostics } from "../../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { selectRustFlowReadProjection } from "../../../../dist/policy/conversions/value-carrier-reconciliation.js";
import { planRustFlowReadProjection } from "../../../../dist/backend/planner/expressions/flow-read-projections.js";
import { analyzeRustFlowReadEmission } from "../../../../dist/analysis/control-flow/flow-read-emission.js";
import { createRustFlowReadEmissionProducer } from "../../../../dist/analysis/program/records/flow-read-emission.js";
import { analyzeRustCarrierReads } from "../../../../dist/analysis/ownership/carrier-reads.js";
import { createRustCarrierReadProducer } from "../../../../dist/analysis/program/records/carrier-reads.js";
import { rustOptionTargetType, rustSourcePrimitiveTargetType, rustFutureTargetType, rustUnitTargetType } from "../../../../dist/target-model/types/index.js";
import { createRustSyntheticNameState } from "../../../../dist/backend/planner/names/synthetic.js";
import { analyzeRust } from "../../../helpers/rust-session.mjs";

// The planner renders only flow-read emissions sealed by the analysis owner. Each case runs that owner on a real
// analyzed node whose flow-read and read-ownership records carry the projection under test.
function analyzedNode() {
  const { program } = analyzeRust({ files: { "index.ts": "export function value(): number { return 1; }" } });
  const sourceFile = program.sourceFiles[0];
  return { program, sourceFile, node: program.source.ast.statements(sourceFile)[0] };
}

function readOwnership(carrier, kind) {
  return { carrier, source: { kind }, value: { kind }, snapshot: undefined, stablePlace: true, readsStorage: true,
    pure: true, sharedReference: false, borrowedAcross: new Set() };
}

function sealFlowRead(program, node, fact, ownership) {
  const forged = { ...program, records: { ...program.records,
    flowReadProjection: { get: candidate => candidate === node ? fact : program.records.flowReadProjection.get(candidate) },
    runtimeCarrier: { get: candidate => candidate === node ? { carrier: fact.sourceCarrier } : program.records.runtimeCarrier.get(candidate) },
    targetOperation: { get: candidate => candidate === node ? undefined : program.records.targetOperation.get(candidate) },
    readOwnership: { get: candidate => candidate === node ? readOwnership(fact.sourceCarrier, ownership)
      : program.records.readOwnership.get(candidate) } } };
  const producer = createRustFlowReadEmissionProducer(() => undefined);
  const issues = analyzeRustFlowReadEmission(forged, [node], producer);
  const reads = createRustCarrierReadProducer(() => undefined);
  analyzeRustCarrierReads(forged, [node], reads);
  return { issues, producer, program: { ...forged, records: { ...forged.records,
    flowReadEmission: producer.records.flowReadEmission, carrierRead: reads.records.carrierRead } } };
}

function planContext(program, sourceFile, node) {
  return { input: { program }, sourceFile, diagnostics: [], usedAliases: new Set(),
    syntheticNames: createRustSyntheticNameState(program.source.ast, node, []),
    moduleNameByFileName: new Map(), externalCrateNameByFileName: new Map(), externalItemPathByIdentity: new Map(),
    externalStructuralShapeModuleByFileName: new Map() };
}

test("optional exclusive-reference projection is a native reborrow, never a Clone promise", () => {
  const { program, sourceFile, node } = analyzedNode();
  const selectedCarrier = { kind: "reference", mutable: true, referent: rustSourcePrimitiveTargetType("int32") };
  const sourceCarrier = rustOptionTargetType(selectedCarrier);
  const selected = selectRustFlowReadProjection(sourceCarrier, selectedCarrier, program.projectTypes);
  assert.equal(selected.kind, "projection");
  assert.equal(selected.fact.kind, "option-reference");
  const expression = { kind: "path", path: "selected" };
  for (const canMove of [false, true]) {
    const sealed = sealFlowRead(program, node, selected.fact, canMove ? "move" : "clone");
    assertNoTargetDiagnostics(sealed.issues);
    const context = planContext(sealed.program, sourceFile, node);
    const projected = planRustFlowReadProjection(node, expression, selected.fact, context);
    assertNoTargetDiagnostics(context.diagnostics);
    if (canMove) {
      assert.equal(projected.kind, "method-call");
      assert.equal(projected.receiver === expression, true, "the owned native Option is evaluated once");
      assert.equal(projected.method, "unwrap_or_else");
      assert.deepEqual(projected.args, [{ kind: "closure", params: [],
        body: { kind: "unreachable", message: "checked flow selected a missing optional value" } }]);
    } else {
      assert.equal(projected.kind, "match");
      assert.deepEqual(projected.expression, {
        kind: "method-call", receiver: expression, method: "as_deref_mut", receiverMode: "mut-ref", args: [],
      });
      assert.equal(projected.arms[0].expression.kind, "path");
    }
  }
  // A reference projection that no longer matches its exact Option element is refused by the analysis owner and
  // never sealed, so the planner has no emission to render.
  for (const invalid of [{ ...selectedCarrier, mutable: false }, rustSourcePrimitiveTargetType("int32"),
    { ...selectedCarrier, referent: rustSourcePrimitiveTargetType("uint32") }]) {
    const forged = { ...selected.fact, selectedCarrier: invalid };
    const rejected = sealFlowRead(program, node, forged, "move");
    assert.equal(rejected.issues.length >= 1, true);
    assert.equal(rejected.producer.records.flowReadEmission.get(forged), undefined);
    assert.throws(() => planRustFlowReadProjection(node, expression, forged, planContext(rejected.program, sourceFile, node)),
      /requires its sealed native emission/u);
  }
});

test("optional non-Clone payloads may move or borrow but cannot acquire a clone contract", () => {
  const { program, sourceFile, node } = analyzedNode();
  const selectedCarrier = rustFutureTargetType(rustUnitTargetType());
  const sourceCarrier = rustOptionTargetType(selectedCarrier);
  const selected = selectRustFlowReadProjection(sourceCarrier, selectedCarrier, program.projectTypes);
  assert.equal(selected.kind, "projection");
  assert.equal(selected.fact.kind, "option-value");
  for (const [canMove, borrowed] of [[true, false], [false, true], [false, false]]) {
    const sealed = sealFlowRead(program, node, selected.fact, canMove ? "move" : "clone");
    assertNoTargetDiagnostics(sealed.issues);
    // A Future has no Clone, so its sealed read guarantee has none.
    assert.equal(sealed.program.records.carrierRead.get(selectedCarrier).clone, false);
    const context = planContext(sealed.program, sourceFile, node);
    if (canMove || borrowed) {
      const projected = planRustFlowReadProjection(node, { kind: "path", path: "selected" }, selected.fact, context, borrowed);
      if (canMove) {
        assert.equal(projected.kind, "method-call");
        assert.deepEqual(projected.receiver, { kind: "path", path: "selected" });
        assert.equal(projected.method, "unwrap_or_else");
        assert.deepEqual(projected.args, [{ kind: "closure", params: [],
          body: { kind: "unreachable", message: "checked flow selected a missing optional value" } }]);
      } else {
        assert.equal(projected.kind, "match");
        assert.equal(projected.arms[0].expression.kind, "path");
      }
      assertNoTargetDiagnostics(context.diagnostics);
    } else {
      // A copy of a payload without a proven Clone guarantee is a corrupt record set at the planner boundary.
      assert.throws(() => planRustFlowReadProjection(node, { kind: "path", path: "selected" }, selected.fact, context, borrowed),
        /native non-consuming payload contract/u);
    }
  }
});
