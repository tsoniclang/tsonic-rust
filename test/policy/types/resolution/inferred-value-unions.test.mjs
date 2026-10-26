import { createRustOwnershipFixture } from "../../../helpers/ownership.mjs";
import { rustFlowReadProjectionEquals } from "../../../../dist/target-model/records/equality.js";
import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { assertNoTargetDiagnostics } from "../../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, acmeTestingPackage } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";
import { selectRustFlowReadProjection } from "../../../../dist/policy/conversions/value-carrier-reconciliation.js";
import { planRustFlowReadProjection } from "../../../../dist/backend/planner/expressions/flow-read-projections.js";
import { analyzeRustFlowReadEmission } from "../../../../dist/analysis/control-flow/flow-read-emission.js";
import { createRustFlowReadEmissionProducer } from "../../../../dist/analysis/program/records/flow-read-emission.js";
import { rustProgramPlanContext, rustProgramWithTypeEmissions } from "../../../helpers/plan-context.mjs";

import { createRustTypeDefinitionRegistry } from "../../../../dist/analysis/project-types/type-definitions.js";
import { rustOptionTargetType, rustSourcePrimitiveTargetType, rustSourceUnionTargetType } from "../../../../dist/target-model/types/index.js";

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

test("union flow projections retain exact optional dispatch and reject altered evidence", () => {
  const integer = rustSourcePrimitiveTargetType("int32");
  const boolean = rustSourcePrimitiveTargetType("bool");
  const union = rustSourceUnionTargetType("/src/index.ts", "Value");
  const registry = createRustTypeDefinitionRegistry();
  assert.equal(registry.registerSourceUnion({ carrier: union, variants: [
    { name: "Integer", carrier: integer }, { name: "Boolean", carrier: boolean },
  ] }, true), true);
  const definitions = registry.seal();
  const program = rustProgramWithTypeEmissions([union, rustOptionTargetType(union),
    integer, rustOptionTargetType(integer), boolean], {
    source: "type Value = number;\nexport function probe(): void {}\n",
    typeDefinitions: definitions,
  });
  const base = rustProgramPlanContext(program);
  const node = base.input.program.source.ast.statements(base.sourceFile).at(-1);
  const projectTypes = program.projectTypes;
  for (const [optional, retainedAbsence] of [[false, false], [true, false], [true, true]]) {
    const sourceCarrier = optional ? rustOptionTargetType(union) : union;
    const selectedCarrier = retainedAbsence ? rustOptionTargetType(integer) : integer;
    const selected = selectRustFlowReadProjection(sourceCarrier, selectedCarrier, projectTypes, definitions);
    assert.equal(selected.kind, "projection");
    assert.deepEqual(selected.fact, { kind: "source-union", sourceCarrier,
      dispatchCarrier: union, selectedCarrier, variant: "Integer" });
    for (const canMove of [false, true]) {
      const admitted = projectionContext(program, base, node, selected.fact, canMove ? "move" : "clone");
      assertNoTargetDiagnostics(admitted.issues);
      assert.equal(admitted.producer.records.flowReadEmission.get(selected.fact) !== undefined, true,
        "the exact authored union projection is admitted before rendering");
      const { context } = admitted;
      const input = { kind: "path", path: "selected" };
      const planned = planRustFlowReadProjection(node, input, selected.fact, context);
      assertNoTargetDiagnostics(context.diagnostics);
      assert.equal(planned.arms[0].pattern.path, optional ? "Some" : "Value::Integer");
      assert.deepEqual(planned.expression, canMove ? input : { kind: "reference", expr: input });
      const projected = retainedAbsence ? planned.arms[0].expression.args[0] : planned.arms[0].expression;
      assert.equal(projected.kind, canMove ? "path" : "dereference");
      if (retainedAbsence) {
        assert.equal(planned.arms[0].expression.path, "Some");
        assert.deepEqual(planned.arms[1], { pattern: { kind: "path", path: "None" }, expression: { kind: "path", path: "None" } });
      }
      for (const changed of [{ ...selected.fact, dispatchCarrier: sourceCarrier === union ? integer : sourceCarrier },
        { ...selected.fact, variant: "Missing" }, { ...selected.fact, selectedCarrier: boolean },
        ...(!optional ? [{ ...selected.fact, selectedCarrier: rustOptionTargetType(integer) }] : [])]) {
        assert.equal(rustFlowReadProjectionEquals(selected.fact, changed), false);
        const rejected = projectionContext(program, base, node, changed, canMove ? "move" : "clone");
        assert.equal(rejected.issues.length, 1, "altered authored union evidence is rejected at admission");
        assert.equal(rejected.issues[0].code, "RUST_MISSING_TARGET_FACT");
        assert.equal(rejected.producer.records.flowReadEmission.get(changed) === undefined, true,
          "rejected authored union evidence cannot reach the renderer");
        assert.throws(() => planRustFlowReadProjection(node, input, changed, rejected.context),
          /requires its sealed native emission/u);
        assert.equal(rejected.context.diagnostics.length, 0, "the renderer does not decide source rejection");
      }
    }
  }
  assert.equal(selectRustFlowReadProjection(union, rustOptionTargetType(integer), projectTypes, definitions).kind, "incompatible");
});

for (const surfaces of [[], ["js"]]) {
  test(`scalar, array and callable payloads use closed native unions on ${surfaces.length === 0 ? "native" : "js"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin", crateName: "inferred_value_unions" } },
      files: { "values.ts": `
        export function first(value: string | string[]): string {
          return typeof value === "string" ? value : value[0]!;
        }
        export function call(value: string | ((amount: number) => number) | undefined): number {
          if (value === undefined) return -1;
          return typeof value === "function" ? value(4) : value === "abc" ? 3 : 0;
        }
      `, "index.ts": `
        import { check } from "@acme/testing";
        import { first, call } from "./values.js";
        export function main(): void {
          check(first("left") === "left");
          check(first(["right"]) === "right");
          check(call("abc") === 3);
          check(call(amount => amount * 2) === 8);
          check(call(undefined) === -1);
        }
      main();
      ` },
    });
    assertNoTargetDiagnostics(result.diagnostics);
    const run = validateGeneratedProject("inferred-value-unions", result.artifacts, { run: true });
    assert.equal(run.status, 0, JSON.stringify(run));
  });
}

test("recursive array unions retain checker-selected inherited members", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "recursive_array_union" } },
    files: { "index.ts": `
      import { check } from "@acme/testing";
      type Paths = string | RegExp | readonly Paths[];
      function keep(value: Paths): Paths { return value; }
      export function main(): void {
        const value = keep("preserved");
        check(typeof value === "string" && value === "preserved");
      }
    main();
    ` },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  const run = validateGeneratedProject("recursive-array-unions", result.artifacts, { run: true });
  assert.equal(run.status, 0, JSON.stringify(run));
});
