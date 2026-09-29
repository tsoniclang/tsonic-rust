import assert from "node:assert/strict";
import test from "node:test";
import { selectRustFlowReadProjection } from "../../../dist/policy/types/value-carrier-reconciliation.js";
import { planRustFlowReadProjection } from "../../../dist/backend/planner/expressions/flow-reads.js";
import { rustFlowReadProjectionFactKey } from "../../../dist/analysis/facts/value-projections.js";
import { rustRuntimeUnionContract } from "../../../dist/target-model/types/carriers/runtime-unions.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustOptionTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { rustJsIntlGroupingTargetId, rustJsNumericTargetId, rustJsStringNumberTargetId } from "../../../dist/target-model/types/carriers/source-types.js";
import { fakeAstReader, fakeSourceFile, fakeStatement } from "../../helpers/fake-compile-input.mjs";

test("runtime union projections retain exact variants, absence and ownership", () => {
  const node = fakeStatement({ kindName: "Identifier", pos: 0, end: 8 });
  const sourceFile = fakeSourceFile({ fileName: "/src/index.ts", text: "selected", statements: [node] });
  for (const id of [rustJsIntlGroupingTargetId, rustJsNumericTargetId, rustJsStringNumberTargetId]) {
    const dispatchCarrier = { kind: "target-named", id };
    for (const alternative of rustRuntimeUnionContract(dispatchCarrier).alternatives) {
      for (const [optional, retainsAbsence] of [[false, false], [true, false], [true, true]]) {
        const sourceCarrier = optional ? rustOptionTargetType(dispatchCarrier) : dispatchCarrier;
        const selectedCarrier = retainsAbsence ? rustOptionTargetType(alternative.carrier) : alternative.carrier;
        const selected = selectRustFlowReadProjection(sourceCarrier, selectedCarrier, {});
        assert.deepEqual(selected, { kind: "projection", fact: { kind: "runtime-union", sourceCarrier,
          dispatchCarrier, selectedCarrier, variant: alternative.variant.name } });
        for (const owns of [false, true]) {
          const context = { input: { program: {
            source: { ast: fakeAstReader([sourceFile]) },
            facts: { getRuntimeCarrierFact: () => ({ carrier: sourceCarrier }) },
            valueLifetimes: { canMove: () => owns },
            typeDefinitions: emptyRustTypeDefinitions, configuration: { edition: "2024" },
          } }, sourceFile, diagnostics: [] };
          const input = { kind: "path", path: "selected" };
          const planned = planRustFlowReadProjection(node, input, selected.fact, context);
          assert.deepEqual(context.diagnostics, []);
          assert.equal(planned.kind, "match");
          assert.deepEqual(planned.expression, owns ? input : { kind: "reference", expr: input });
          const pattern = optional ? planned.arms[0].pattern.elements[0] : planned.arms[0].pattern;
          assert.ok(pattern.path.endsWith(`::${alternative.variant.name}`));
          const value = retainsAbsence ? planned.arms[0].expression.args[0] : planned.arms[0].expression;
          if (alternative.variant.kind === "constant") {
            assert.equal(pattern.kind, "path");
            assert.deepEqual(value, { kind: "bool-literal", value: alternative.variant.value });
          } else {
            assert.equal(pattern.kind, "tuple-variant");
            assert.equal(value.kind, owns ? "path" : alternative.carrier.kind === "source-primitive" ? "dereference" : "method-call");
            if (value.kind === "method-call") assert.equal(value.method, "clone");
          }
          if (retainsAbsence) assert.deepEqual(planned.arms[1], {
            pattern: { kind: "path", path: "None" }, expression: { kind: "path", path: "None" },
          });
          for (const changed of [
            { ...selected.fact, dispatchCarrier: alternative.carrier },
            { ...selected.fact, variant: "Missing" },
            { ...selected.fact, selectedCarrier: rustSourcePrimitiveTargetType("int32") },
            ...(!optional ? [{ ...selected.fact, selectedCarrier: rustOptionTargetType(alternative.carrier) }] : []),
          ]) {
            context.diagnostics.length = 0;
            assert.equal(rustFlowReadProjectionFactKey.equals(selected.fact, changed), false);
            assert.equal(planRustFlowReadProjection(node, input, changed, context), undefined);
            assert.equal(context.diagnostics.length, 1);
          }
        }
      }
      assert.equal(selectRustFlowReadProjection(dispatchCarrier, rustOptionTargetType(alternative.carrier), {}).kind, "incompatible");
    }
  }
});
