import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { rustTargetOperationFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustTargetOperationResultCarrier } from "../../../dist/analysis/facts/operations/facts.js";
import { rustEffectiveValueCarrier } from "../../../dist/analysis/facts/value-carrier-queries.js";
import { rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { planBinaryExpression } from "../../../dist/backend/planner/expressions/binary.js";
import { nativeExpressionSequencesSource } from "../../../../tsonic/test/fixtures/native-expression-sequences.mjs";

test("checked value sequences seal independent operand carriers and the exact final completion", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": nativeExpressionSequencesSource } });
  const { ast } = program.source;
  let sequences = 0;
  const visit = node => {
    if (ast.is.IsBinaryExpression(node) && ast.operatorKindName(node) === "KindCommaToken") {
      const operation = program.facts.getFact(node, rustTargetOperationFactKey);
      assert.equal(operation?.kind, "sequence");
      const expression = ast.as.AsBinaryExpression(node);
      const right = rustEffectiveValueCarrier(program.facts, expression.Right);
      assert.equal(rustTargetTypeRefEquals(operation.rightCarrier, right), true);
      assert.equal(rustTargetTypeRefEquals(operation.resultCarrier, operation.rightCarrier), true);
      assert.equal(rustTargetTypeRefEquals(rustTargetOperationResultCarrier(operation), right), true);
      const selected = program.facts.getSelectedTargetOperator(node);
      assert.equal(selected.operationId, operation.operationId);
      assert.equal(selected.operationKind, "operator");
      assert.equal(rustTargetTypeRefEquals(selected.resultType, right), true);
      sequences++;
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(sequences, 9);
});

test("value sequence planning rejects altered sealed operands, completion and selected identity", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
function effect(): void {}
export function read(value: int32): int32 { return (effect(), value); }
` } });
  const { ast } = program.source;
  let subject;
  const visit = node => {
    if (ast.is.IsBinaryExpression(node) && ast.operatorKindName(node) === "KindCommaToken") subject = node;
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.ok(subject);
  const original = program.facts.getFact(subject, rustTargetOperationFactKey);
  const selected = program.facts.getSelectedTargetOperator(subject);
  const changed = rustSourcePrimitiveTargetType("uint64");
  for (const [label, operation, selection] of [
    ["left", { ...original, leftCarrier: changed }, selected],
    ["right", { ...original, rightCarrier: changed }, selected],
    ["completion", { ...original, resultCarrier: changed }, selected],
    ["operation", { ...original, operationId: "invalid" }, selected],
    ["missing selection", original, undefined],
    ["selection identity", original, { ...selected, operationId: "invalid" }],
    ["selection completion", original, { ...selected, resultType: changed }],
  ]) {
    const facts = { ...program.facts,
      getFact: (node, key) => node === subject && key === rustTargetOperationFactKey
        ? operation : program.facts.getFact(node, key),
      getSelectedTargetOperator: node => node === subject ? selection : program.facts.getSelectedTargetOperator(node),
    };
    const context = { input: { program: { ...program, facts } }, diagnostics: [], sourceFile: ast.getSourceFile(subject) };
    assert.equal(planBinaryExpression(subject, context) === undefined, true, label);
    assert.ok(context.diagnostics.some(diagnostic => diagnostic.code === "RUST_MISSING_TARGET_FACT"), label);
  }
});

for (const surfaces of [[], ["js"]]) {
  test(`value sequences emit canonical native completion on ${surfaces[0] ?? "native"}`, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": nativeExpressionSequencesSource },
    });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(diagnostic => diagnostic.message).join("\n"));
    const output = artifactText(result, "src/index.rs");
    assert.match(output, /value: u64/u);
    assert.doesNotMatch(output, /9007199254740993\.0|dyn Any|Box::pin/u);
  });
}
