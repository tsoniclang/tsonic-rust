import assert from "node:assert/strict";
import test from "node:test";
import { selectRustBinaryOperator } from "../../../dist/policy/operations/operators/rules.js";
import { rustSourceTypeCarrier } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustJsErrorTargetType, rustSourcePrimitiveTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";

test("source-object equality invokes the exact native PartialEq operation without assuming reflexivity", () => {
  const carrier = rustSourceTypeCarrier("index.ts", "Value", "object");
  for (const [operator, method] of [["===", "eq"], ["!==", "ne"]]) {
    const selected = selectRustBinaryOperator(operator, carrier, carrier);
    assert.equal(selected?.kind, "operator-call", operator);
    assert.equal(selected.path, `core::cmp::PartialEq::${method}`,
      `${operator}: preserve the native eq or independently implemented ne operation`);
    assert.equal(selected.rustOperator, operator === "===" ? "==" : "!=", operator);
    assert.equal(selected.operandModes.length, 2, operator);
    assert.equal(selected.operandModes.every(mode => mode === "ref"), true,
      `${operator}: borrow both original operands without consuming, copying or guessing equality`);
    assert.equal(selected.fallible, false, operator);
    assert.equal(selected.leftConversion === undefined && selected.rightConversion === undefined, true,
      `${operator}: the selected native operands require no compatibility conversion`);
  }
  const other = rustSourceTypeCarrier("index.ts", "Other", "object");
  assert.equal(selectRustBinaryOperator("===", carrier, other) === undefined, true,
    "distinct nominal objects acquire no new equality implementation");
  for (const value of [rustSourcePrimitiveTargetType("float64"), rustSourcePrimitiveTargetType("int32"),
    rustSourcePrimitiveTargetType("bool"), rustStringTargetType(), rustSourceTypeCarrier("index.ts", "Kind", "enum")]) {
    assert.equal(selectRustBinaryOperator("===", value, value)?.kind, "operator-token",
      "native numeric nonreflexivity, string, boolean and enum operator selection is unchanged");
  }
  assert.equal(selectRustBinaryOperator("===", rustJsErrorTargetType(), rustJsErrorTargetType())?.path,
    "rt::JsError::has_same_identity", "the existing native Error identity owner remains unchanged");
});

test("native Callable equality borrows exact argument, result and error storage across environment lifetimes", () => {
  const scalar = rustSourcePrimitiveTargetType("int32");
  const otherScalar = rustSourcePrimitiveTargetType("int64");
  const error = rustJsErrorTargetType();
  const argumentLifetime = { kind: "parameter", identity: "checked:argument", name: "argument" };
  const argument = { kind: "reference", mutable: false, lifetime: argumentLifetime, referent: scalar };
  const lifetimes = [
    { kind: "placeholder" },
    { kind: "static" },
    { kind: "parameter", identity: "checked:left", name: "left" },
    { kind: "parameter", identity: "checked:right", name: "right" },
  ];
  for (const leftLifetime of lifetimes) {
    for (const rightLifetime of lifetimes) {
      const left = rustCallableTargetType([argument], scalar, leftLifetime, error);
      const right = rustCallableTargetType([argument], scalar, rightLifetime, error);
      const leftBefore = JSON.stringify(left);
      const rightBefore = JSON.stringify(right);
      for (const operator of ["===", "!=="]) {
        const label = `${operator}: ${leftLifetime.kind}/${rightLifetime.kind}`;
        const selected = selectRustBinaryOperator(operator, left, right);
        assert.equal(selected?.kind, "operator-token", label);
        assert.equal(selected.rustOperator, operator === "===" ? "==" : "!=", label + ": native polarity");
        assert.equal(selected.operandModes.every(mode => mode === "ref"), true, label + ": both original values stay borrowed");
        assert.equal(selected.leftConversion === undefined && selected.rightConversion === undefined, true,
          label + ": no lifetime cast, wrapper, copied storage or erased callable");
        assert.equal(JSON.stringify(left), leftBefore, label + ": the original left lifetime remains authoritative");
        assert.equal(JSON.stringify(right), rightBefore, label + ": the original right lifetime remains authoritative");
      }
    }
  }
  const original = rustCallableTargetType([argument], scalar, lifetimes[1], error);
  const distinctArgument = { ...argument, lifetime: lifetimes[2] };
  const different = [
    rustCallableTargetType([scalar], scalar, lifetimes[0], error),
    rustCallableTargetType([argument, scalar], scalar, lifetimes[0], error),
    rustCallableTargetType([distinctArgument], scalar, lifetimes[0], error),
    rustCallableTargetType([{ ...argument, mutable: true }], scalar, lifetimes[0], error),
    rustCallableTargetType([argument], otherScalar, lifetimes[0], error),
    rustCallableTargetType([argument], scalar, lifetimes[0], rustStringTargetType()),
    { kind: "closure", args: [argument], result: scalar },
    { kind: "function-pointer", args: [argument], result: scalar },
    { ...original, id: "foreign:Callable" },
  ];
  for (const [index, candidate] of different.entries()) {
    for (const operator of ["===", "!=="]) {
      const label = `${operator}: exact callable storage inverse ${index}`;
      assert.equal(selectRustBinaryOperator(operator, original, candidate) === undefined, true, label);
      assert.equal(selectRustBinaryOperator(operator, candidate, original) === undefined, true, label + ": reversed");
    }
  }
});

test("checked receiver aliases retain actual native equality calls and sealed shared operands", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
class Value {
  readonly owner: Value = this;
  constructor(readonly count: number) {}
}
export function equal(value: Value): boolean { return value.owner === value; }
export function different(value: Value): boolean { return value.owner !== value; }
` } });
  const nodes = [];
  const ast = program.source.ast;
  const visit = node => {
    if (ast.is.IsBinaryExpression(node) && ["KindEqualsEqualsEqualsToken", "KindExclamationEqualsEqualsToken"].includes(ast.operatorKindName(node))) nodes.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(nodes.length, 2, "both authored alias comparisons reach the actual native producer");
  for (const [index, node] of nodes.entries()) {
    const operation = program.records.targetOperation.get(node);
    assert.equal(operation?.kind, "operator-call", "a readonly alias is not replaced with a Boolean constant");
    assert.equal(operation.path, `core::cmp::PartialEq::${index === 0 ? "eq" : "ne"}`);
    const emission = program.records.binaryEmission.get(node);
    assert.equal(emission?.fact === operation, true, "rendering retains the same admitted native operation");
    assert.equal(emission.leftShared && emission.rightShared, true,
      "the complete existing ownership owner retains both native borrows instead of adding clones");
  }
});
