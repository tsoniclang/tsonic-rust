import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustNativeCallableInvocationArguments } from "../../../dist/policy/types/callables/native-invocations.js";

function invocation(program) {
  const calls = [];
  const visit = node => {
    if (program.source.ast.is.IsCallExpression(node) && program.source.ast.text(node) === "callback(value)") calls.push(node);
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const artifact of program.records.sourceArtifacts.get()) visit(artifact.sourceFile);
  assert.equal(calls.length, 1, "the actual checked callback invocation is unique");
  return calls[0];
}

for (const surfaces of [[], ["js"]]) {
  for (const [label, parameter] of [["borrowed string", "value: string"], ["optional string", "value?: string"]]) {
    test(`${label} native input invocation consumes its physical formal ABI in ${surfaces[0] ?? "native"}`, () => {
      const { program } = analyzeRust({ surfaces, files: { "index.ts": `
function invoke(callback: (${parameter}) => number, ${parameter}): number { return callback(value); }
console.log(invoke((value) => value === undefined ? 0 : value.length, "native"));` } });
      const call = invocation(program);
      const operation = program.records.targetOperation.get(call);
      const selected = program.records.nativeInputInvocation.get(call);
      assert.equal(operation?.kind === "source-call", true, "the exact checked source invocation is retained");
      assert.equal(selected !== undefined, true, "the native input owner publishes its selected flat-argument call");
      assert.equal(selected.call.node === call, true, "the call record retains the original source invocation identity");
      assert.equal(selected.call.input.protocol.method.parameters.length, operation.parameters.length,
        "the native trait and source argument plan have the same value arity");
      assert.equal(rustNativeCallableInvocationArguments(selected.call.input, operation) !== undefined, true,
        "the actual physical formals instantiate the selected native method's complete generic and lifetime ABI");
      assert.equal(program.records.sourceCallEffects.get(call)?.nativeInput !== undefined, true,
        "the same selected input retains its native invocation error effects");
    });
  }

  test(`a concrete callable is not relabelled as a generic native input in ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
function invoke(value: string): number {
  const callback: (value: string) => number = value => value.length;
  return callback(value);
}
console.log(invoke("native"));` } });
    const call = invocation(program);
    assert.equal(program.records.targetOperation.get(call)?.kind === "source-call", true,
      "the ordinary callable still has its exact source operation");
    assert.equal(program.records.nativeInputInvocation.get(call) === undefined, true,
      "only an actual bound native input receives the flat native trait call selection");
  });
}
