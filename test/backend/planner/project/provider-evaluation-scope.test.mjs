import assert from "node:assert/strict";
import test from "node:test";
import { Node_Expression } from "@tsonic/target-api/source";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustSourceParameterAbiFactKey, rustTargetOperationFactKey } from "../../../../dist/analysis/facts/keys.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";
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
    const fact = program.facts.getFact(node, rustTargetOperationFactKey);
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
  const selected = program.facts.getFact(receiver, rustSourceParameterAbiFactKey);
  assert.equal(selected.mode, "ref");
  const plan = parameter => {
    const facts = { ...program.facts, getFact(subject, key) {
      return subject === receiver && key === rustSourceParameterAbiFactKey ? parameter : program.facts.getFact(subject, key);
    } };
    return planRustProviderEvaluationScope({ input: { program: { ...program, facts } },
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
