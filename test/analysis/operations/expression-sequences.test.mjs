import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, artifactText, compileRust } from "../../helpers/rust-session.mjs";

import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustTargetOperationResultCarrier } from "../../../dist/target-model/records/operations/operations.js";
import { rustEffectiveValueCarrier } from "../../../dist/analysis/conversions/value-carrier-queries.js";
import { rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { analyzeRustBinaryEmission } from "../../../dist/analysis/operations/binary-emission.js";
import { createRustBinaryEmissionProducer } from "../../../dist/analysis/program/records/operations/expression-binary.js";
import { nativeExpressionSequencesSource } from "../../../../tsonic/test/fixtures/native-expression-sequences.mjs";

test("checked value sequences seal independent operand carriers and the exact final completion", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": nativeExpressionSequencesSource } });
  const { ast } = program.source;
  let sequences = 0;
  const parameterByFunction = new Map();
  const visit = node => {
    if (ast.is.IsFunctionDeclaration(node)) parameterByFunction.set(ast.text(ast.name(node)), ast.parameters(node)[0]);
    if (ast.is.IsBinaryExpression(node) && ast.operatorKindName(node) === "KindCommaToken") {
      const operation = program.records.targetOperation.get(node);
      assert.equal(operation?.kind, "sequence");
      const expression = ast.as.AsBinaryExpression(node);
      const right = rustEffectiveValueCarrier(program.records, expression.Right);
      assert.equal(rustTargetTypeRefEquals(operation.rightCarrier, right), true);
      assert.equal(rustTargetTypeRefEquals(operation.resultCarrier, operation.rightCarrier), true);
      assert.equal(rustTargetTypeRefEquals(rustTargetOperationResultCarrier(operation), right), true);
      const selected = program.records.selectedOperation.get(node);
      assert.equal(selected.operationId, operation.operationId);
      assert.equal(selected.operationKind, "operator");
      assert.equal(rustTargetTypeRefEquals(selected.resultType, right), true);
      sequences++;
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile).forEach(visit);
  assert.equal(sequences, 9);
  for (const [name, expectedUnused] of [["direct", false], ["nested", false], ["stopped", true]]) {
    const parameter = parameterByFunction.get(name);
    assert.equal(parameter !== undefined, true, `${name}: retain the actual checked receiver parameter`);
    assert.equal(program.records.bindingLiveness.get(parameter)?.unused, expectedUnused,
      `${name}: only the right operand of a selected never-completing sequence is absent natively`);
  }
});

test("value sequence admission rejects altered operands, completion and selected identity before sealing", () => {
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
  program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile).forEach(visit);
  assert.ok(subject);
  const original = program.records.targetOperation.get(subject);
  const selected = program.records.selectedOperation.get(subject);
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
    const records = createRustRecordFixture({
targetOperation: { get: (node) => node === subject
    ? operation : program.records.targetOperation.get(node) },
selectedOperation: { get: (node) => node === subject ? selection : program.records.selectedOperation.get(node) }}, program.records);
    const producer = createRustBinaryEmissionProducer(() => {});
    const issues = analyzeRustBinaryEmission({ ...program, records }, [subject], producer);
    assert.equal(issues.length, 1, label + ": exact admission rejection");
    assert.equal(issues[0].code, "RUST_MISSING_TARGET_FACT", label);
    assert.equal(issues[0].sourceNode === subject, true, label + ": exact checked source identity");
    assert.equal(producer.records.binaryEmission.get(subject) === undefined, true, label + ": invalid sequence never reaches the planner");
  }
});

for (const surfaces of [[], ["js"]]) {
  test(`value sequences emit canonical native completion on ${surfaces[0] ?? "native"}`, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": (nativeExpressionSequencesSource + "\nawait main();\n") },
    });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(diagnostic => diagnostic.message).join("\n"));
    const output = artifactText(result, "src/index.rs");
    assert.match(output, /value: u64/u);
    assert.doesNotMatch(output, /9007199254740993\.0|dyn Any|Box::pin/u);
  });
}
