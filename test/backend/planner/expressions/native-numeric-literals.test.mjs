import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { assertNoTargetDiagnostics } from "../../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSourceLiteralValues } from "@tsonic/target-api/source";
import { planNumericLiteralWithCarrier, planBigIntLiteral } from "../../../../dist/backend/planner/expressions/fundamentals.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";
import { fakeAstReader, fakeSourceFile, fakeStatement } from "../../../helpers/fake-compile-input.mjs";

function contextFor(text, kindName, carrier, provenance = "authored") {
  const node = { ...fakeStatement({ kindName: `Kind${kindName}`, pos: 0, end: text.length }), text };
  const sourceFile = fakeSourceFile({ fileName: "/src/index.ts", text, statements: [node] });
  const ast = fakeAstReader([sourceFile]);
  const literals = { ...ast, is: { ...ast.is, IsPrefixUnaryExpression: () => false,
    IsStringLiteral: () => false, IsNoSubstitutionTemplateLiteral: () => false,
    IsNumericLiteral: candidate => candidate === node && kindName === "NumericLiteral",
    IsBigIntLiteral: candidate => candidate === node && kindName === "BigIntLiteral" },
    forEachChild: (candidate, visit) => { if (candidate === sourceFile) visit(node); },
    authoredRange: () => provenance === "synthetic" ? { kind: "synthetic" } : { kind: "authored", start: 0, end: text.length } };
  const literalValues = analyzeSourceLiteralValues(literals, [sourceFile]);
  return { node, context: { input: { program: { source: { ast: literals },
    records: { ...createRustRecordFixture({conversion: { get: () => undefined },
runtimeCarrier: { get: () => ({ carrier }) }}), literalValue: literalValues.literalValue } } }, sourceFile, diagnostics: [] } };
}

test("numeric literal producers preserve each exact native width independently of contextual inference", () => {
  for (const [name, suffix] of [["int8", "i8"], ["uint8", "u8"], ["int16", "i16"], ["uint16", "u16"],
    ["int32", undefined], ["uint32", "u32"], ["int64", "i64"], ["uint64", "u64"],
    ["native-int", "isize"], ["native-uint", "usize"]]) {
    const carrier = rustSourcePrimitiveTargetType(name);
    const { node, context } = contextFor("7", "NumericLiteral", carrier);
    assert.deepEqual(planNumericLiteralWithCarrier(node, carrier, context),
      { kind: "int-literal", text: suffix === undefined ? "7" : `7_${suffix}` });
    assertNoTargetDiagnostics(context.diagnostics);
  }
  for (const [name, text] of [["float32", "7.0_f32"], ["float64", "7.0"]]) {
    const carrier = rustSourcePrimitiveTargetType(name);
    const { node, context } = contextFor("7", "NumericLiteral", carrier);
    assert.deepEqual(planNumericLiteralWithCarrier(node, carrier, context), { kind: "float-literal", text });
  }
});

test("authored float32 rounding and actual checked float64 conversion remain distinct sealed inputs", () => {
  const carrier = rustSourcePrimitiveTargetType("float32");
  const authored = contextFor("1.00000005960464477539062500000001", "NumericLiteral", carrier);
  assert.deepEqual(planNumericLiteralWithCarrier(authored.node, carrier, authored.context),
    { kind: "float-literal", text: "1.00000005960464477539062500000001_f32" });
  const actual = contextFor("1.0000000596046448", "NumericLiteral", carrier, "synthetic");
  assert.deepEqual(planNumericLiteralWithCarrier(actual.node, carrier, actual.context),
    { kind: "numeric-cast", expression: { kind: "float-literal", text: "1.0000000596046448_f64" }, target: "f32" });
  const negativeZero = contextFor("-0", "NumericLiteral", carrier, "synthetic");
  assert.deepEqual(planNumericLiteralWithCarrier(negativeZero.node, carrier, negativeZero.context),
    { kind: "numeric-cast", expression: { kind: "unary", operator: "-", operand: { kind: "float-literal", text: "0.0_f64" } }, target: "f32" });
  assertNoTargetDiagnostics(authored.context.diagnostics);
  assertNoTargetDiagnostics(actual.context.diagnostics);
  assertNoTargetDiagnostics(negativeZero.context.diagnostics);
});

test("wide bigint literals retain their checked native signedness without rounding", () => {
  for (const [name, suffix] of [["uint64", "u64"], ["int64", "i64"]]) {
    const { node, context } = contextFor("9007199254740993n", "BigIntLiteral", rustSourcePrimitiveTargetType(name));
    assert.deepEqual(planBigIntLiteral(node, context), { kind: "int-literal", text: `9007199254740993_${suffix}` });
    assertNoTargetDiagnostics(context.diagnostics);
  }
});
