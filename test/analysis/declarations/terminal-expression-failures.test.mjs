import assert from "node:assert/strict";
import test from "node:test";
import { resolveExpressionCarrier } from "../../../dist/analysis/expressions/carriers.js";
import { appendRustDiagnostic } from "../../../dist/analysis/program/walk.js";
import { compileRust } from "../../helpers/rust-session.mjs";

test("a diagnosed expression rejects repeated requests without selecting it again", () => {
  const expression = {};
  const dependent = {};
  const walk = { resolving: new Set([dependent]), rejectedExpressions: new WeakSet(), context: { diagnostics: [] } };
  appendRustDiagnostic(walk, "EXACT_FAILURE", "Selected operand is not representable", expression, []);
  for (let index = 0; index < 128; index += 1) {
    assert.equal(resolveExpressionCarrier(walk, expression, {}, undefined), undefined);
    assert.equal(resolveExpressionCarrier(walk, dependent, {}, undefined), undefined);
  }
  assert.equal(walk.context.diagnostics.length, 1);
  const independent = {};
  walk.resolving.clear();
  appendRustDiagnostic(walk, "EXACT_FAILURE", "Selected operand is not representable", independent, []);
  assert.equal(walk.context.diagnostics.length, 2);
  assert.equal(walk.rejectedExpressions.has({}), false);
});

test("independent signed/unsigned native failures survive nested call prerequisites once each", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
    import type { int64, uint64 } from "@tsonic/core/types.js";
    function carry(value: bigint): bigint { return value; }
    export function first(signed: int64, unsigned: uint64): bigint {
      return carry(carry(carry(signed + unsigned)));
    }
    export function second(signed: int64, unsigned: uint64): bigint {
      return carry(carry(carry(unsigned + signed)));
    }
  ` } });
  const failures = result.diagnostics.filter(entry => entry.code === "RUST_BINARY_OPERATOR_CARRIER_UNSUPPORTED");
  assert.equal(failures.length, 2, JSON.stringify(result.diagnostics));
  assert.equal(result.artifacts.length, 0);
});

test("unresolved contextual literals and generic callbacks are not terminal rejections", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
    import type { int64 } from "@tsonic/core/types.js";
    function identity<Value>(value: Value): Value { return value; }
    function apply<Value>(value: Value, callback: (value: Value) => Value): Value { return callback(value); }
    export function run(): int64 {
      const value: int64 = 9007199254740993n;
      return apply(identity(value), selected => selected);
    }
  ` } });
  assert.deepEqual(result.diagnostics, []);
  assert(result.artifacts.length > 0);
});
