import assert from "node:assert/strict";
import test from "node:test";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { analyzeRustNativeComparisons } from "../../../dist/analysis/operations/native-comparisons.js";
import { createRustNativeComparisonProducer } from "../../../dist/analysis/program/records/native/native-comparisons.js";
import { rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { analyzeRust } from "../../helpers/rust-session.mjs";

// Selection of a scoped native string comparison (borrow the field and compare its str view with the literal)
// moved from the planner to native comparison analysis. These cases carry over the planner test's assertions about
// literal sides, empty strings, conversions, projections and borrowability.
const string = rustStringTargetType();

function select({ operator = "==", literal = "abc", literalSide = "right", conversion = {}, fieldRecords = {},
  fieldValueReceiver = true } = {}) {
  const expression = {}, field = {}, other = {}, root = {};
  // `literal: null` means no literal operand (a default parameter would turn undefined back into "abc").
  const literalNode = literal === null ? undefined : {};
  const left = literalSide === "left" && literalNode !== undefined ? literalNode : field;
  const right = literalSide === "left" || literalNode === undefined ? (literalNode === undefined ? other : field) : literalNode;
  const ast = {
    parent: () => undefined,
    is: { IsBinaryExpression: node => node === expression, IsParenthesizedExpression: () => false, IsIdentifier: () => false,
    IsStringLiteral: node => node === literalNode, IsNoSubstitutionTemplateLiteral: () => false,
    IsAsExpression: () => false, IsSatisfiesExpression: () => false, IsNonNullExpression: () => false, IsTypeAssertion: () => false },
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
  analyzeRustNativeComparisons({ source: { ast }, records, ownership: { uses: new Map(), reads: { get: () => undefined } },
    safetyApplications: { operationForExpression: () => undefined } }, [expression], producer);
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
    assert.deepEqual(selected, { kind: "scoped-string", source: { kind: "field", field }, ...expected }, JSON.stringify(options));
  }
  assert.notEqual(select({ literal: null }).selected.kind, "scoped-string", "a non-literal operand is not scoped");
});

test("native index comparisons retain the existing receiver scope around the literal consumer", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
function replace(values: string[][]): int32 { values[0] = ["after"]; return 0; }
export function observe(values: string[][]): boolean { return values[0]![replace(values)]! === "before"; }
export function reversed(values: string[][]): boolean { return "before" !== values[0]![replace(values)]!; }
export function owned(values: string[][]): string { return values[0]![replace(values)]!; }
` } });
  const { ast } = program.source;
  const comparisons = [];
  const visit = node => {
    const comparison = program.records.nativeComparison.get(node);
    if (comparison?.kind === "scoped-string" && comparison.source.kind === "provider") comparisons.push(comparison);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(comparisons.length, 2, "both literal sides select the same existing native provider source");
  assert.equal(comparisons.some(comparison => comparison.reversed), true, "the reversed literal order remains explicit data");
  for (const comparison of comparisons) {
    const { source } = comparison;
    assert.equal(program.records.targetOperation.get(source.node) === source.operation, true, "the exact admitted operation is transported, not reselected");
    const evaluation = program.records.providerEvaluation.get(source.node, source.operation);
    assert.equal(evaluation !== undefined, true, "the existing provider recipe precedes comparison selection");
    const receiver = evaluation.slots.find(row => row.slot.source.kind === "receiver");
    const index = evaluation.slots.find(row => row.slot.source.kind === "argument");
    assert.equal(receiver?.slot.node === source.receiver, true, "the first inner allocation retains its original identity");
    assert.equal(index?.slot.node === source.arguments[0], true, "the same effectful index is evaluated once");
    assert.equal(receiver.borrowAcross.has(index.slot.key), true, "the necessary old-allocation snapshot is not removed");
    assert.equal(evaluation.effects.has(index.slot.key), true, "the actual allocation replacement is not treated as pure");
  }
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
