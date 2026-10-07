import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, acmeTestingPackage } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { selectRustFlowReadProjection } from "../../../dist/policy/types/value-carrier-reconciliation.js";
import { planRustFlowReadProjection } from "../../../dist/backend/planner/expressions/flow-reads.js";
import { rustFlowReadProjectionFactKey } from "../../../dist/analysis/facts/value-projections.js";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { rustOptionTargetType, rustSourcePrimitiveTargetType, rustSourceUnionTargetType } from "../../../dist/target-model/types/index.js";
import { fakeAstReader, fakeSourceFile, fakeStatement } from "../../helpers/fake-compile-input.mjs";

test("union flow projections retain exact optional dispatch and reject altered evidence", () => {
  const node = fakeStatement({ kindName: "Identifier", pos: 0, end: 8 });
  const sourceFile = fakeSourceFile({ fileName: "/src/index.ts", text: "selected", statements: [node] });
  const integer = rustSourcePrimitiveTargetType("int32");
  const boolean = rustSourcePrimitiveTargetType("bool");
  const union = rustSourceUnionTargetType("/src/index.ts", "Value");
  const registry = createRustTypeDefinitionRegistry();
  assert.equal(registry.registerSourceUnion({ carrier: union, variants: [
    { name: "Integer", carrier: integer }, { name: "Boolean", carrier: boolean },
  ] }, true), true);
  const definitions = registry.seal();
  const projectTypes = { definitionForCarrier: () => undefined };
  for (const [optional, retainedAbsence] of [[false, false], [true, false], [true, true]]) {
    const sourceCarrier = optional ? rustOptionTargetType(union) : union;
    const selectedCarrier = retainedAbsence ? rustOptionTargetType(integer) : integer;
    const selected = selectRustFlowReadProjection(sourceCarrier, selectedCarrier, projectTypes, definitions);
    assert.equal(selected.kind, "projection");
    assert.deepEqual(selected.fact, { kind: "source-union", sourceCarrier,
      dispatchCarrier: union, selectedCarrier, variant: "Integer" });
    for (const canMove of [false, true]) {
      const context = { input: { program: {
        source: { ast: fakeAstReader([sourceFile]) },
        facts: { getRuntimeCarrierFact: () => ({ carrier: sourceCarrier }) },
        names: { nameForSourceType: (_file, name) => name },
        valueLifetimes: { canMove: () => canMove },
        projectTypes, typeDefinitions: definitions, configuration: { edition: "2024" },
      } }, sourceFile, diagnostics: [], moduleName: "index",
        moduleNameByFileName: new Map([["/src/index.ts", "index"]]),
        externalCrateNameByFileName: new Map() };
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
        context.diagnostics.length = 0;
        assert.equal(rustFlowReadProjectionFactKey.equals(selected.fact, changed), false);
        assert.equal(planRustFlowReadProjection(node, input, changed, context), undefined);
        assert.equal(context.diagnostics.length, 1);
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
    ` },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  const run = validateGeneratedProject("recursive-array-unions", result.artifacts, { run: true });
  assert.equal(run.status, 0, JSON.stringify(run));
});
