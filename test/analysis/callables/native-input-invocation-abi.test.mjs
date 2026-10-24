import assert from "node:assert/strict";
import test from "node:test";
import { sourceEnclosingCallable, sourceNodeIdentity } from "@tsonic/target-api/source";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustNativeCallableInvocationArguments } from "../../../dist/policy/types/callables/native-invocations.js";

function invocation(program) {
  const calls = [];
  const ast = program.source.ast;
  const visit = node => {
    if (ast.is.IsCallExpression(node)) {
      const expression = ast.as.AsCallExpression(node).Expression;
      const arguments_ = ast.arguments(node);
      if (ast.is.IsIdentifier(expression) && ast.text(expression) === "callback" && arguments_.length === 1 &&
        ast.is.IsIdentifier(arguments_[0]) && ast.text(arguments_[0]) === "value") calls.push(node);
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
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
invoke((value) => value === undefined ? 0 : value === "native" ? 6 : 0, "native");` } });
      const call = invocation(program);
      const operation = program.records.targetOperation.get(call);
      const selected = program.records.nativeInputInvocation.get(call);
      assert.equal(operation?.kind === "source-call", true, "the exact checked source invocation is retained");
      const callIdentity = sourceNodeIdentity(program.source.ast, call);
      assert.equal(callIdentity !== undefined, true, "the actual invocation has its original checked source identity");
      const owner = sourceEnclosingCallable(call, program.source.ast);
      const inputs = owner === undefined ? [] : program.callableValues.native.inputsFor(owner);
      const describe = carrier => [carrier.kind, carrier.id ?? "", carrier.mutable ?? "",
        carrier.lifetime?.kind ?? "implicit", carrier.referent?.kind ?? "", carrier.referent?.id ?? ""];
      const evidence = JSON.stringify({ inputs: inputs.length,
        protocol: inputs[0]?.protocol.method.parameters.map(describe),
        physical: operation.parameters.map(parameter => describe(parameter.parameterCarrier)),
        binders: inputs[0]?.protocol.method.binder.parameters.map(parameter => parameter.lifetime.kind),
        arguments: operation.targetGenericArguments?.map(argument => argument.kind) ?? [],
        matched: inputs.length === 1 && rustNativeCallableInvocationArguments(inputs[0], operation, callIdentity) !== undefined });
      assert.equal(selected !== undefined, true,
        `the native input owner publishes its selected flat-argument call; ${evidence}`);
      assert.equal(selected.call.node === call, true, "the call record retains the original source invocation identity");
      assert.equal(selected.call.input.protocol.method.parameters.length, operation.parameters.length,
        "the native trait and source argument plan have the same value arity");
      assert.equal(rustNativeCallableInvocationArguments(selected.call.input, operation, callIdentity) !== undefined, true,
        "the actual physical formals instantiate the selected native method's complete generic and lifetime ABI");
      assert.equal(program.records.sourceCallEffects.get(call)?.nativeInput !== undefined, true,
        "the same selected input retains its native invocation error effects");
    });
  }

  test(`a concrete callable is not relabelled as a generic native input in ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
function invoke(value: string): number {
  const callback: (value: string) => number = value => value === "native" ? 6 : 0;
  return callback(value);
}
invoke("native");` } });
    const call = invocation(program);
    assert.equal(program.records.targetOperation.get(call)?.kind === "source-call", true,
      "the ordinary callable still has its exact source operation");
    assert.equal(program.records.nativeInputInvocation.get(call) === undefined, true,
      "only an actual bound native input receives the flat native trait call selection");
  });
}
