import assert from "node:assert/strict";
import test from "node:test";
import { planNumericLiteralWithCarrier, planBigIntLiteral } from "../../../../dist/backend/planner/expressions/fundamentals.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";
import { fakeAstReader, fakeSourceFile, fakeStatement } from "../../../helpers/fake-compile-input.mjs";

function contextFor(text, kindName, carrier) {
  const node = { ...fakeStatement({ kindName: `Kind${kindName}`, pos: 0, end: text.length }), text };
  const sourceFile = fakeSourceFile({ fileName: "/src/index.ts", text, statements: [node] });
  const ast = fakeAstReader([sourceFile]);
  const literals = { ...ast, is: { ...ast.is, IsPrefixUnaryExpression: () => false },
    authoredRange: () => ({ kind: "authored", start: 0, end: text.length }) };
  return { node, context: { input: { program: { source: { ast: literals },
    facts: { getFact: () => undefined, getTargetConversionFact: () => undefined,
      getRuntimeCarrierFact: () => ({ carrier }) } } }, sourceFile, diagnostics: [] } };
}

test("numeric literal producers preserve each exact native width independently of contextual inference", () => {
  for (const [name, suffix] of [["int8", "i8"], ["uint8", "u8"], ["int16", "i16"], ["uint16", "u16"],
    ["int32", undefined], ["uint32", "u32"], ["int64", "i64"], ["uint64", "u64"],
    ["native-int", "isize"], ["native-uint", "usize"]]) {
    const carrier = rustSourcePrimitiveTargetType(name);
    const { node, context } = contextFor("7", "NumericLiteral", carrier);
    assert.deepEqual(planNumericLiteralWithCarrier(node, carrier, context),
      { kind: "int-literal", text: suffix === undefined ? "7" : `7_${suffix}` });
    assert.deepEqual(context.diagnostics, []);
  }
  for (const [name, text] of [["float32", "7.0_f32"], ["float64", "7.0"]]) {
    const carrier = rustSourcePrimitiveTargetType(name);
    const { node, context } = contextFor("7", "NumericLiteral", carrier);
    assert.deepEqual(planNumericLiteralWithCarrier(node, carrier, context), { kind: "float-literal", text });
  }
});

test("wide bigint literals retain their checked native signedness without rounding", () => {
  for (const [name, suffix] of [["uint64", "u64"], ["int64", "i64"]]) {
    const { node, context } = contextFor("9007199254740993n", "BigIntLiteral", rustSourcePrimitiveTargetType(name));
    assert.deepEqual(planBigIntLiteral(node, context), { kind: "int-literal", text: `9007199254740993_${suffix}` });
    assert.deepEqual(context.diagnostics, []);
  }
});
