import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";

const cases = [
  ["ordinary deferred input", `import type { int32 } from "@tsonic/core/types.js";
    export function retain(callback: () => Promise<int32>): Promise<int32> { return callback(); }
    export function forward(callback: () => Promise<int32>): Promise<int32> { return retain(callback); }
  `, ["retain", "forward"]],
  ["generic deferred input", `
    export async function source<Value>(callback: () => Promise<Value>) { return await callback(); }
    export function retain<Other>(callback: () => Promise<Other>) { return source(callback); }
    export async function consumer<Actual>(callback: () => Promise<Actual>) { return await retain(callback); }
  `, ["source", "retain", "consumer"]],
  ["quantified input", `
    type Identity = <Value>(value: Value) => Value;
    export function retain(callback: Identity): Identity { return callback; }
    export function forward<Value>(callback: Identity, value: Value): Value { return retain(callback)<Value>(value); }
  `, ["retain", "forward"]],
  ["quantified forwarded result", `
    type Identity = <Value>(value: Value) => Value;
    export function retain(callback: Identity): Identity { return callback; }
    export function forward(callback: Identity): Identity { return retain(callback); }
    export function invoke<Value>(callback: Identity, value: Value): Value { return forward(callback)<Value>(value); }
  `, ["retain", "forward", "invoke"]],
];

for (const [name, source, names] of cases) for (const surfaces of [[], ["js"]]) {
  test(`native input obligations preserve ${name} without a finite producer family (${surfaces[0] ?? "native"})`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": source } });
    assert.equal(program.callableValues.generic.definitions.length, 0, "no invented concrete family");
    const ast = program.source.ast;
    const inputs = program.callableValues.native.inputs;
    for (const name of names) {
      const selected = inputs.find(input => ast.name(input.owner) !== undefined && ast.text(ast.name(input.owner)) === name);
      assert.equal(selected !== undefined, true, name);
      assert.equal(program.declarationGenericRequirements.contractFor(selected.owner) !== undefined, true, name);
    }
    assert.equal(program.callableValues.native.calls.length > 0, true, "actual abstract invocation has exact protocol evidence");
    for (const call of program.callableValues.native.calls) {
      assert.equal(program.callableValues.native.callFor(call.node) === call, true);
      assert.equal(inputs.includes(call.input), true, "call retains the actual formal, not a matching signature");
    }
  });
}
