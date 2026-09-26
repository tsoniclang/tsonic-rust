import assert from "node:assert/strict";
import test from "node:test";
import { selectRustFlowReadProjection } from "../../../dist/policy/types/value-carrier-reconciliation.js";
import { planRustFlowReadProjection } from "../../../dist/backend/planner/expressions/flow-reads.js";
import { rustOptionTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { fakeAstReader, fakeSourceFile, fakeStatement } from "../../helpers/fake-compile-input.mjs";

test("optional exclusive-reference projection is a native reborrow, never a Clone promise", () => {
  const node = fakeStatement({ kindName: "Identifier", pos: 0, end: 8 });
  const sourceFile = fakeSourceFile({ text: "selected", statements: [node] });
  const selectedCarrier = { kind: "reference", mutable: true, referent: rustSourcePrimitiveTargetType("int32") };
  const sourceCarrier = rustOptionTargetType(selectedCarrier);
  const selected = selectRustFlowReadProjection(sourceCarrier, selectedCarrier, {});
  assert.equal(selected.kind, "projection");
  assert.equal(selected.fact.kind, "option-reference");
  for (const canMove of [false, true]) {
    const context = { input: { program: {
      source: { ast: fakeAstReader([sourceFile]) },
      facts: { getRuntimeCarrierFact: () => ({ carrier: sourceCarrier }) },
      valueLifetimes: { canMove: () => canMove }, configuration: { edition: "2024" },
    } }, sourceFile, diagnostics: [] };
    const expression = { kind: "path", path: "selected" };
    const projected = planRustFlowReadProjection(node, expression, selected.fact, context);
    assert.deepEqual(context.diagnostics, []);
    assert.equal(projected.kind, "match");
    assert.deepEqual(projected.expression, canMove ? expression : {
      kind: "method-call", receiver: expression, method: "as_deref_mut", receiverMode: "mut-ref", args: [],
    });
    assert.equal(projected.arms[0].expression.kind, "path");
    for (const invalid of [{ ...selectedCarrier, mutable: false }, rustSourcePrimitiveTargetType("int32"),
      { ...selectedCarrier, referent: rustSourcePrimitiveTargetType("uint32") }]) {
      context.diagnostics.length = 0;
      assert.equal(planRustFlowReadProjection(node, expression, { ...selected.fact, selectedCarrier: invalid }, context), undefined);
      assert.equal(context.diagnostics.length, 1);
    }
  }
});
