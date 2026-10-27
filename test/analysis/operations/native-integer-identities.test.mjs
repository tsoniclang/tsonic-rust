import assert from "node:assert/strict";
import test from "node:test";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { analyzeRustNativeComparisons } from "../../../dist/analysis/operations/native-comparisons.js";
import { createRustNativeComparisonProducer } from "../../../dist/analysis/program/records/native/native-comparisons.js";

// The all-bits identity decision (`value & -1` on a signed integer keeps `value`) moved from the planner, which read
// generated literal syntax, to native comparison analysis over checked source literals. These cases carry over the
// planner test's assertions.
function select(operator, first, second, resultCarrier, conversions = {}, effects = {}) {
  const expression = {}, left = {}, right = {};
  const producer = createRustNativeComparisonProducer(() => {});
  const literals = new Map([[left, first], [right, second]]);
  const ast = { parent: () => undefined, is: { IsBinaryExpression: node => node === expression, IsParenthesizedExpression: () => false,
    IsIdentifier: () => false, IsStringLiteral: () => false, IsNoSubstitutionTemplateLiteral: () => false },
    as: { AsBinaryExpression: node => node === expression ? { Left: left, Right: right } : undefined } };
  analyzeRustNativeComparisons({ source: { ast }, sourceNavigation: {
    expressionEffects: () => ({ invokes: false, mutates: false, suspends: false, mayThrow: false, ...effects }),
  }, records: {
    literalValue: { get: node => {
      const integer = literals.get(node);
      return integer === undefined ? undefined : { form: "numeric", integer };
    } },
    ...createRustRecordFixture({
      targetOperation: { get: node => node === expression ? { kind: "operator-token", operator, resultCarrier, ...conversions } : undefined },
      valueRead: { get: () => ({ value: resultCarrier }) },
    }),
  }, ownership: { uses: new Map(), reads: { get: () => undefined } },
    safetyApplications: { operationForExpression: () => undefined } }, [expression], producer);
  return producer.records.nativeComparison.get(expression);
}

test("signed native all-bits identities retain the exact operand", () => {
  for (const name of ["int8", "int16", "int32", "int64", "native-int"]) {
    const carrier = { kind: "source-primitive", name };
    assert.deepEqual(select("&", undefined, -1n, carrier), { kind: "integer-identity", operand: "left" }, name);
    assert.deepEqual(select("&", -1n, undefined, carrier), { kind: "integer-identity", operand: "right" }, name);
  }
});

test("all-bits identity requires a signed integer, the & operator, an exact -1 literal and no operand conversion", () => {
  for (const carrier of [{ kind: "source-primitive", name: "uint32" },
    { kind: "source-primitive", name: "float64" }, { kind: "type-parameter", identity: "Custom", name: "Custom" }]) {
    assert.equal(select("&", undefined, -1n, carrier).kind, "ordinary", JSON.stringify(carrier));
  }
  const signed = { kind: "source-primitive", name: "int32" };
  assert.equal(select("|", undefined, -1n, signed).kind, "ordinary");
  assert.equal(select("&", undefined, -2n, signed).kind, "ordinary");
  assert.equal(select("&", undefined, undefined, signed).kind, "ordinary", "a non-literal mask is not an identity");
  assert.equal(select("&", undefined, -1n, signed, { rightConversion: { kind: "numeric" } }).kind, "ordinary",
    "a converted operand is not erased");
  for (const effect of ["invokes", "mutates", "suspends", "mayThrow"])
    assert.equal(select("&", undefined, -1n, signed, {}, { [effect]: true }).kind, "ordinary",
      `${effect}: an effectful mask is never discarded by a literal identity`);
});

test("signed identity records use the checked literal effects and native integer owner", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
export function left(value: int32): int32 { return value & -1; }
export function right(value: int32): int32 { return -1 & value; }
` } });
  const ast = program.source.ast;
  const selected = [];
  const visit = node => {
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind === "operator-token" && operation.operator === "&") selected.push({ node, operation });
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(selected.length, 2, "the two original exact signed native operations are admitted");
  for (const { node, operation } of selected) {
    const binary = ast.as.AsBinaryExpression(node);
    const left = program.records.literalValue.get(binary.Left)?.integer === -1n;
    const mask = left ? binary.Left : binary.Right;
    assert.equal(program.records.literalValue.get(mask)?.integer, -1n, "the discarded native mask is exactly all bits");
    const effects = program.sourceNavigation.expressionEffects(mask);
    assert.equal(effects.invokes || effects.mutates || effects.suspends || effects.mayThrow, false,
      "the checked native mask carries no discarded effect");
    assert.equal(operation.resultCarrier.kind === "source-primitive" && operation.resultCarrier.name === "int32", true,
      "the native integer width remains exact");
    assert.deepEqual(program.records.nativeComparison.get(node), { kind: "integer-identity", operand: left ? "right" : "left" },
      "the same source owner records the original kept operand, not a reconstructed expression");
  }
});
