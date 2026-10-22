import assert from "node:assert/strict";
import test from "node:test";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { analyzeRustNativeComparisons } from "../../../dist/analysis/expressions/native-comparisons.js";
import { createRustNativeComparisonProducer } from "../../../dist/analysis/program/records/native-comparisons.js";
import { rustStringTargetType } from "../../../dist/target-model/types/index.js";

// Selection of a scoped native string comparison (borrow the field and compare its str view with the literal)
// moved from the planner to native comparison analysis. These cases carry over the planner test's assertions about
// literal sides, empty strings, conversions, projections and borrowability.
const string = rustStringTargetType();

function select({ operator = "==", literal = "abc", literalSide = "right", conversion = {}, fieldRecords = {},
  fieldValueReceiver = true } = {}) {
  const expression = {}, field = {}, other = {}, root = {};
  const literalNode = literal === undefined ? undefined : {};
  const left = literalSide === "left" && literalNode !== undefined ? literalNode : field;
  const right = literalSide === "left" || literalNode === undefined ? (literalNode === undefined ? other : field) : literalNode;
  const ast = {
    is: { IsBinaryExpression: node => node === expression, IsParenthesizedExpression: () => false, IsIdentifier: () => false,
      IsStringLiteral: node => node === literalNode, IsNoSubstitutionTemplateLiteral: () => false },
    as: { AsBinaryExpression: node => node === expression ? { Left: left, Right: right } : undefined },
  };
  // literalValue is the source literal index that sealed programs carry beside their record families.
  const records = { literalValue: { get: node => node === literalNode ? { form: "string", text: literal } : undefined },
    ...createRustRecordFixture({
    targetOperation: { get: node => node === expression ? { kind: "operator-token", operator, ...conversion }
      : node === field ? { kind: "source-field", receiverCarrier: { kind: "target-named", id: "fixture.Owner" }, storageIndex: 0 }
      : undefined },
    valueRead: { get: node => node === field || node === literalNode || node === other ? { value: string } : undefined },
    runtimeCarrier: { get: node => node === field || node === literalNode || node === other ? { carrier: string } : undefined },
    fieldValueReceiver: { get: node => node === field ? fieldValueReceiver : undefined },
    valueFieldProjection: { get: node => node === field ? { root } : undefined },
    directStorage: { get: node => node === root ? { kind: "local" } : undefined },
    ...Object.fromEntries(Object.entries(fieldRecords).map(([family, value]) =>
      [family, { get: node => node === field ? value : undefined }])),
  }) };
  const producer = createRustNativeComparisonProducer(() => {});
  analyzeRustNativeComparisons({ source: { ast }, records, ownership: { reads: { get: () => undefined } } }, [expression], producer);
  return { selected: producer.records.nativeComparison.get(expression), field };
}

test("scoped native string comparisons preserve exact borrow and literal boundaries", () => {
  for (const [options, expected] of [
    [{}, { value: "abc", reversed: false, operator: "==" }],
    [{ literalSide: "left" }, { value: "abc", reversed: true, operator: "==" }],
    [{ operator: "!=" }, { value: "abc", reversed: false, operator: "!=" }],
    [{ literal: "" }, { value: "", reversed: false, operator: "==" }],
    [{ literal: "", literalSide: "left", operator: "!=" }, { value: "", reversed: true, operator: "!=" }],
  ]) {
    const { selected, field } = select(options);
    assert.deepEqual(selected, { kind: "scoped-string", field, ...expected }, JSON.stringify(options));
  }
  assert.notEqual(select({ literal: undefined }).selected.kind, "scoped-string", "a non-literal operand is not scoped");
});

test("a converted, noncomparison, projected or owned operand does not claim a scoped borrow", () => {
  assert.notEqual(select({ conversion: { leftConversion: {} } }).selected.kind, "scoped-string", "converted left");
  assert.notEqual(select({ conversion: { rightConversion: {} } }).selected.kind, "scoped-string", "converted right");
  assert.notEqual(select({ operator: "+" }).selected.kind, "scoped-string", "noncomparison");
  const replacement = { selectedCarrier: string, targetCarrier: string, resultCarrier: string, elementCarrier: string, convertedType: string };
  for (const family of ["flowReadProjection", "projectUpcast", "projectDowncast", "objectReferenceView",
    "callScopedLifetimeReconciliation", "contextualValueConversion", "optionProjection", "conversion"]) {
    assert.notEqual(select({ fieldRecords: { [family]: replacement } }).selected.kind, "scoped-string",
      `${family}: a projected value retains its owning conversion`);
  }
  assert.notEqual(select({ fieldValueReceiver: false }).selected.kind, "scoped-string", "an owned read cannot claim a scoped borrow");
});
