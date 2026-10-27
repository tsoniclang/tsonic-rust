import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { assertNoTargetDiagnostics } from "../../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSourceLiteralValues } from "@tsonic/target-api/source";
import { analyzeRustLiteralEmission } from "../../../../dist/analysis/operations/literals.js";
import { createRustLiteralEmissionProducer } from "../../../../dist/analysis/program/records/operations/literal-emission.js";
import { planNumericLiteralWithCarrier, planBigIntLiteral } from "../../../../dist/backend/planner/expressions/literal-conversions.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";
import { fakeAstReader, fakeCompileInput, fakeSourceFile, fakeStatement } from "../../../helpers/fake-compile-input.mjs";

// Literal recipes are sealed by analyzeRustLiteralEmission for the literal's contextual carrier; the planner reads
// the sealed recipe. Analysis refusals are the context's diagnostics.
function contextFor(text, kindName, carrier, provenance = "authored", sealedLiteralValues = true) {
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
  const records = { ...createRustRecordFixture({ conversion: { get: () => undefined },
    runtimeCarrier: { get: () => ({ carrier }) },
    valueRead: { get: candidate => candidate === node ? { contextualInput: carrier } : undefined } }),
  literalValue: sealedLiteralValues ? literalValues.literalValue : { get: () => undefined } };
  const producer = createRustLiteralEmissionProducer(() => {});
  const source = { ...fakeCompileInput({ sourceFiles: [sourceFile] }).source, ast: literals };
  const issues = analyzeRustLiteralEmission({ source, records, physicalEmissionContexts: { sourceOccurrences: [] },
    safetyApplications: { operationForExpression: () => undefined } }, [node], producer, source);
  return { node, context: { input: { program: { source,
    records: { ...records, literalEmission: producer.records.literalEmission } } }, sourceFile, diagnostics: [...issues] } };
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
  for (const [name, text] of [["float32", "7.0_f32"], ["float64", "7.0_f64"]]) {
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
  const actualCarrier = rustSourcePrimitiveTargetType("float64");
  const actual = contextFor("1.0000000596046448", "NumericLiteral", actualCarrier, "synthetic");
  assert.deepEqual(planNumericLiteralWithCarrier(actual.node, actualCarrier, actual.context),
    { kind: "float-literal", text: "1.0000000596046448_f64" });
  const negativeZero = contextFor("-0", "NumericLiteral", actualCarrier, "synthetic");
  assert.deepEqual(planNumericLiteralWithCarrier(negativeZero.node, actualCarrier, negativeZero.context),
    { kind: "unary", operator: "-", operand: { kind: "float-literal", text: "0.0_f64" } });
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

test("Rust owns floating grammar while shared source facts retain neutral decimal spelling", () => {
  for (const [source, neutral, floating] of [["1", "1", "1.0"], ["1.", "1", "1.0"], ["1.0", "1.0", "1.0"],
    ["1.00", "1.00", "1.00"], ["0", "0", "0.0"], ["0.000", "0.000", "0.0"],
    ["0e999999999999999999999", "0e+999999999999999999999", "0.0"], ["0xFF", "255", "255.0"]]) {
    for (const name of ["float32", "float64"]) {
      const carrier = rustSourcePrimitiveTargetType(name);
      const { node, context } = contextFor(source, "NumericLiteral", carrier);
      const literal = context.input.program.records.literalValue.get(node);
      assert.equal(literal?.numeric?.kind === "authored" && literal.numeric.token.decimalText === neutral, true,
        `${name} ${source}: shared spelling`);
      assert.deepEqual(planNumericLiteralWithCarrier(node, carrier, context),
        { kind: "float-literal", text: `${floating}_${name === "float32" ? "f32" : "f64"}` }, `${name} ${source}: native grammar`);
      assertNoTargetDiagnostics(context.diagnostics);
    }
  }
});

test("missing sealed numeric evidence is refused by literal emission analysis and never reaches the planner", () => {
  const carrier = rustSourcePrimitiveTargetType("float32");
  const { node, context } = contextFor("1", "NumericLiteral", carrier, "authored", false);
  assert.equal(context.diagnostics.length, 1);
  const [diagnostic] = context.diagnostics;
  assert.equal(diagnostic.message, "A floating literal requires its sealed source numeric evidence. Node kind: KindNumericLiteral.");
  assert.equal(diagnostic.code, "RUST_MISSING_TARGET_FACT");
  assert.equal(diagnostic.source, "tsonic-rust");
  assert.equal(diagnostic.sourceNode === node, true);
  assert.throws(() => planNumericLiteralWithCarrier(node, carrier, context), failure =>
    failure.message === "An admitted literal requires its exact source/native emission recipe." &&
    failure.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT" && failure.diagnostic?.sourceNode === node);
});
