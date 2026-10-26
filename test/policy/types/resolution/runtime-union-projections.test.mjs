import { createRustOwnershipFixture } from "../../../helpers/ownership.mjs";
import { rustFlowReadProjectionEquals } from "../../../../dist/target-model/records/equality.js";
import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { assertNoTargetDiagnostics } from "../../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { selectRustFlowReadProjection } from "../../../../dist/policy/conversions/value-carrier-reconciliation.js";
import { planRustFlowReadProjection } from "../../../../dist/backend/planner/expressions/flow-read-projections.js";
import { analyzeRustFlowReadEmission } from "../../../../dist/analysis/control-flow/flow-read-emission.js";
import { createRustFlowReadEmissionProducer } from "../../../../dist/analysis/program/records/flow-read-emission.js";
import { rustProgramPlanContext, rustProgramWithTypeEmissions } from "../../../helpers/plan-context.mjs";

import { rustRuntimeUnionContract } from "../../../../dist/target-model/types/carriers/runtime-unions.js";
import { rustOptionTargetType, rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";
import { rustJsIntlGroupingTargetId, rustJsNumericTargetId, rustJsStringNumberTargetId } from "../../../../dist/target-model/types/carriers/source-types.js";

function projectionContext(program, base, node, fact, ownership) {
  const reads = createRustOwnershipFixture(node, fact.sourceCarrier, ownership);
  const selected = { ...program, records: createRustRecordFixture({
    flowReadProjection: { get: candidate => candidate === node ? fact : program.records.flowReadProjection.get(candidate) },
    runtimeCarrier: { get: candidate => candidate === node ? { carrier: fact.sourceCarrier } : program.records.runtimeCarrier.get(candidate) },
    readOwnership: { get: candidate => candidate === node ? reads.reads.get(node) : program.records.readOwnership.get(candidate) },
    targetOperation: { get: candidate => candidate === node ? undefined : program.records.targetOperation.get(candidate) },
  }, program.records) };
  const producer = createRustFlowReadEmissionProducer(() => undefined);
  const issues = analyzeRustFlowReadEmission(selected, [node], producer);
  return { issues, producer, context: { ...base, diagnostics: [], input: { ...base.input, program: { ...base.input.program,
    records: createRustRecordFixture(producer.records, selected.records) } } } };
}

test("runtime union projections retain exact variants, absence and ownership", () => {
  const dispatchCarriers = [rustJsIntlGroupingTargetId, rustJsNumericTargetId, rustJsStringNumberTargetId]
    .map(id => ({ kind: "target-named", id }));
  const carriers = dispatchCarriers.flatMap(carrier => [carrier, rustOptionTargetType(carrier),
    ...rustRuntimeUnionContract(carrier).alternatives.flatMap(alternative =>
      [alternative.carrier, rustOptionTargetType(alternative.carrier)])]);
  const program = rustProgramWithTypeEmissions(carriers);
  const base = rustProgramPlanContext(program);
  const node = base.input.program.source.ast.statements(base.sourceFile)[0];
  const projectTypes = program.projectTypes;
  for (const dispatchCarrier of dispatchCarriers) {
    for (const alternative of rustRuntimeUnionContract(dispatchCarrier).alternatives) {
      for (const [optional, retainsAbsence] of [[false, false], [true, false], [true, true]]) {
        const sourceCarrier = optional ? rustOptionTargetType(dispatchCarrier) : dispatchCarrier;
        const selectedCarrier = retainsAbsence ? rustOptionTargetType(alternative.carrier) : alternative.carrier;
        const selected = selectRustFlowReadProjection(sourceCarrier, selectedCarrier, projectTypes);
        assert.deepEqual(selected, { kind: "projection", fact: { kind: "runtime-union", sourceCarrier,
          dispatchCarrier, selectedCarrier, variant: alternative.variant.name } });
        for (const owns of [false, true]) {
          const admitted = projectionContext(program, base, node, selected.fact, owns ? "move" : "clone");
          assertNoTargetDiagnostics(admitted.issues);
          assert.equal(admitted.producer.records.flowReadEmission.get(selected.fact) !== undefined, true,
            "the exact runtime union projection is admitted before rendering");
          const { context } = admitted;
          const input = { kind: "path", path: "selected" };
          const planned = planRustFlowReadProjection(node, input, selected.fact, context);
          assertNoTargetDiagnostics(context.diagnostics);
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
            assert.equal(rustFlowReadProjectionEquals(selected.fact, changed), false);
            const rejected = projectionContext(program, base, node, changed, owns ? "move" : "clone");
            assert.equal(rejected.issues.length, 1, "altered runtime union evidence is rejected at admission");
            assert.equal(rejected.issues[0].code, "RUST_MISSING_TARGET_FACT");
            assert.equal(rejected.producer.records.flowReadEmission.get(changed) === undefined, true,
              "rejected runtime union evidence cannot reach the renderer");
            assert.throws(() => planRustFlowReadProjection(node, input, changed, rejected.context),
              /requires its sealed native emission/u);
            assert.equal(rejected.context.diagnostics.length, 0, "the renderer does not decide source rejection");
          }
        }
      }
      assert.equal(selectRustFlowReadProjection(dispatchCarrier, rustOptionTargetType(alternative.carrier), projectTypes).kind, "incompatible");
    }
  }
});
