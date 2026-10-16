import { createRustRecordFixture } from "../../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { Node_Expression } from "@tsonic/target-api/source";
import { analyzeRust } from "../../../helpers/rust-session.mjs";


import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";
import { planExpression } from "../../../../dist/backend/planner/expressions/entry.js";
import { finalizeRustProviderOperationAbi } from "../../../../dist/analysis/operations/finalized-operation/finalize.js";
import { rustFutureTargetType } from "../../../../dist/target-model/types/index.js";
import { planRustProviderEvaluationScope } from "../../../../dist/backend/planner/project/provider-evaluation-scope.js";

test("provider evaluation retains exact existing borrows across readonly representation changes", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
function selected(fail: boolean): string { if (fail) throw new Error("selected"); return "a"; }
export function observed(source: string, fail: boolean): boolean {
  return source.includes(selected(fail)) && source.includes("a");
}
` } });
  const { ast } = program.source;
  const operations = [];
  const visit = node => {
    const fact = program.records.targetOperation.get(node);
    if (fact?.kind === "provider-operation" && ast.is.IsCallExpression(node) &&
      ast.arguments(node).some(argument => argument !== undefined && ast.is.IsCallExpression(argument))) {
      operations.push({ node, fact });
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(operations.length, 1);
  const { node, fact } = operations[0];
  const receiver = Node_Expression(ast, Node_Expression(ast, node));
  const selected = program.records.sourceParameterAbi.get(receiver);
  assert.equal(selected.mode, "ref");
  const plan = parameter => {
    const records = createRustRecordFixture({
sourceParameterAbi: { get: (subject) => {
    return subject === receiver ? parameter : program.records.sourceParameterAbi.get(subject);
} }}, program.records);
    return planRustProviderEvaluationScope({ input: { program: { ...program, records } },
      sourceFile: ast.getSourceFile(node), diagnostics: [] }, fact, node, receiver, ast.arguments(node),
    () => ({ kind: "path", path: "snapshot" }), () => undefined);
  };
  assert.equal(plan(selected).kind, "none");
  const other = rustSourcePrimitiveTargetType("bool");
  for (const changed of [
    undefined,
    { ...selected, mode: "mut-ref" },
    { ...selected, valueCarrier: other },
    { ...selected, parameterCarrier: { ...selected.parameterCarrier, referent: other } },
    { ...selected, parameterCarrier: { ...selected.parameterCarrier, mutable: true } },
    { ...selected, entryConversion: { kind: "semantic-conversion", id: "borrowed-str-from-owned-string" } },
  ]) {
    const scope = plan(changed);
    assert.equal(scope.kind, "selected", "unproved current storage still requires its snapshot");
    assert.equal(scope.steps.length, 1);
    assert.equal(scope.overrides.sourceValues.has(receiver), true);
  }
});

test("evaluation-only unit, absence and native-future operands retain canonical immediate effect handling", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
function first(): number { return 1; }
function second(): number { return 2; }
function target(left: number, right: number): number { return left + right; }
export function observed(): number { return target(first(), second()); }
` } });
  const { ast } = program.source;
  let node;
  const visit = current => {
    if (ast.is.IsCallExpression(current) && ast.arguments(current).length === 2) node = current;
    ast.forEachChild(current, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(node !== undefined, true, "checked call supplies the original occurrence identities");
  const argumentsList = ast.arguments(node);
  const number = { kind: "source-primitive", name: "float64" };
  for (const [label, carrier, expression, expectedDiscard] of [
    ["unit", { kind: "tuple", elements: [] }, { kind: "call", path: "fixture::unit", args: [] }, "unit"],
    ["absence", { kind: "target-named", id: "rust.native.absence" }, { kind: "call", path: "fixture::absence", args: [] }, "unit"],
    ["future", rustFutureTargetType(number), { kind: "call", path: "fixture::future", args: [] }, "unit"],
  ]) {
    const abi = finalizeRustProviderOperationAbi({ operationKind: "method",
      form: { form: "call", path: "fixture::consume", argModes: ["value"], argOrder: [1] },
      sourceArgumentCarriers: [carrier, number], declaredSourceArgumentCarriers: [number],
      evaluationOnlySourceArgumentIndexes: [0], resultCarrier: number, isAsync: false, isFallible: false });
    assert.equal(abi !== undefined, true, `${label}: existing canonical ABI admission`);
    const fact = { kind: "provider-operation", operationId: "fixture::consume", resultCarrier: number, abi };
    const context = { input: { program }, sourceFile: ast.getSourceFile(node), diagnostics: [],
      expressionOverrides: new Map([[argumentsList[0], { expression, carrier, valueForm: "value" }],
        [argumentsList[1], { expression: { kind: "call", path: "fixture::value", args: [] }, carrier: number, valueForm: "value" }]]) };
    const selected = planRustProviderEvaluationScope(context, fact, node, undefined, argumentsList, planExpression, () => undefined);
    assert.equal(selected.kind, "selected", `${label}: exact source scheduling`);
    assert.equal(selected.steps[0].kind, "effect", `${label}: no blind named value binding`);
    assert.equal(selected.steps[0].discard, expectedDiscard, `${label}: canonical discard mode`);
    assert.equal(selected.steps[0].value.kind, "call", `${label}: original effect remains`);
    assert.equal(selected.steps[0].value.path, label === "future" ? "core::mem::drop" : expression.path,
      `${label}: canonical native-future disposal is unchanged`);
    if (label === "future") assert.equal(selected.steps[0].value.args[0] === expression, true,
      "native future is disposed exactly once without awaiting or losing its expression");
    assert.equal(context.diagnostics.length, 0, `${label}: no extra planner diagnostic`);
  }
});
