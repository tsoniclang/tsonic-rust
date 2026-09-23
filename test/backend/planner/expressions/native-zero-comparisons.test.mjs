import assert from "node:assert/strict";
import test from "node:test";
import { planRustNativeZeroComparison } from "../../../../dist/backend/planner/expressions/native-zero-comparisons.js";
import { propagateRustBottomOperand } from "../../../../dist/backend/planner/expressions/bottom-operands.js";
import { artifactText, compileRust } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

const zero = { kind: "int-literal", text: "0usize" };
const subject = {};
const literal = {};
const length = { kind: "method-call", receiver: { kind: "path", path: "values" }, method: "len", args: [] };
function context(carrier, fact) {
  return {
    expressionOverrides: new Map([[subject, { carrier }]]),
    input: { program: { facts: { getFact: () => fact } } },
  };
}
const nativeUint = { kind: "source-primitive", name: "native-uint" };
const lengthFact = {
  kind: "provider-operation",
  abi: {
    operationKind: "property", effects: { invocation: "infallible", evaluation: "pure" },
    result: { kind: "sync", conversion: { kind: "identity" } },
    target: { form: "receiver-method", name: "len", emptyTestMethod: "is_empty" },
    sourceReceiver: { kind: "receiver", carrier: { kind: "array", element: nativeUint } },
  },
};

test("native array emptiness uses exact selected operations in both operand orders", () => {
  for (const [operator, reversed, empty] of [["==", "==", true], ["!=", "!=", false], [">", "<", false], ["<=", ">=", true]]) {
    const selected = context(nativeUint, lengthFact);
    const call = { ...length, method: "is_empty" };
    const expected = empty ? call : { kind: "unary", operator: "!", operand: call };
    assert.deepEqual(planRustNativeZeroComparison(operator, length, zero, subject, literal, selected), expected);
    assert.deepEqual(planRustNativeZeroComparison(reversed, zero, length, literal, subject, selected), expected);
  }
  for (const mutation of [
    { ...lengthFact, abi: { ...lengthFact.abi, effects: { invocation: "fallible" } } },
    { ...lengthFact, abi: { ...lengthFact.abi, target: { form: "receiver-method", name: "len" } } },
    { ...lengthFact, abi: { ...lengthFact.abi, effects: { invocation: "infallible", evaluation: "observable" } } },
    undefined,
  ]) {
    assert.equal(planRustNativeZeroComparison("==", length, zero, subject, literal, context(nativeUint, mutation)), undefined);
  }
});

test("unsigned zero-bound folding preserves evaluation and never folds signed or floating carriers", () => {
  const effect = { kind: "call", path: "next", args: [] };
  for (const [operator, value] of [["<", false], [">=", true]]) {
    assert.deepEqual(planRustNativeZeroComparison(operator, effect, zero, subject, literal, context(nativeUint)), {
      kind: "evaluate-then", effect, discard: "value", value: { kind: "bool-literal", value },
    });
    for (const name of ["int32", "int64", "float64"]) {
      assert.equal(planRustNativeZeroComparison(operator, effect, zero, subject, literal,
        context({ kind: "source-primitive", name })), undefined);
    }
  }
});

test("bottom arguments retain receiver and earlier temporary owners without executing later arguments", () => {
  const names = { reserved: new Set(), nextSuffixByBase: new Map() };
  const receiver = { kind: "call", path: "receiver", args: [] };
  const first = { kind: "call", path: "first", args: [] };
  const stop = { kind: "bottom", expression: { kind: "call", path: "stop", args: [] } };
  const later = { kind: "call", path: "later", args: [] };
  const result = propagateRustBottomOperand({ kind: "method-call", receiver, method: "apply", args: [first, stop, later] }, names);
  assert.equal(result.kind, "bottom");
  assert.deepEqual(result.expression.bindings.map(binding => binding.value), [receiver, first]);
  assert.deepEqual(result.expression.value, stop.expression);
  const nested = propagateRustBottomOperand({ kind: "call", path: "apply", args: [{ kind: "tuple-literal", elements: [first, stop, later] }] }, names);
  assert.equal(nested.kind, "bottom");
  assert.deepEqual(nested.expression.bindings.map(binding => binding.value), [first]);
  const conditional = { kind: "conditional", condition: { kind: "bool-literal", value: false }, whenTrue: stop, whenFalse: zero };
  assert.equal(propagateRustBottomOperand(conditional, names), conditional);
});

test("native zero comparisons preserve runtime effects and compile without warning suppressions", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
import type { int32, nativeUint } from "@tsonic/core/types.js";
let calls: int32 = 0;
function next(): nativeUint { calls++; return 3; }
function signed(value: int32): boolean { return value < 0; }
function floating(value: number): boolean { return value < 0; }
export function main(): void {
  const values: int32[] = [];
  if (values.length !== 0 || !(0 >= values.length)) throw new Error("empty");
  values.push(3);
  if (!(values.length > 0) || values.length <= 0 || !(0 < values.length)) throw new Error("nonempty");
  if (next() < 0 || !(next() >= 0) || calls !== 2) throw new Error("effects");
  if (!signed(-1) || !floating(-0.5)) throw new Error("signed controls");
}
` } });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /values\.is_empty\(\)/u);
  assert.doesNotMatch(output, /allow\([^)]*(?:len_zero|unused_comparisons|absurd_extreme)/u);
  validateGeneratedProject("native-zero-comparisons", result.artifacts, { run: true });
});
