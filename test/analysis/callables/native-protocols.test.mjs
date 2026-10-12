import assert from "node:assert/strict";
import test from "node:test";
import { createRustNativeCallableProtocol, rustNativeCallableErrorType, rustNativeCallableProtocolResult }
  from "../../../dist/analysis/callables/native-protocols.js";
import { rustCallableTargetType, rustFutureTargetType, rustSourcePrimitiveTargetType }
  from "../../../dist/target-model/types/index.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

const integer = rustSourcePrimitiveTargetType("int32");
const implementation = { kind: "type-parameter", identity: "input:left", name: "Left" };
const input = { ownerFileName: "/source.ts", definitions: emptyRustTypeDefinitions };
const create = (identity, carrier, usedNames = new Set()) => createRustNativeCallableProtocol({
  ...input, identity, carrier, usedNames,
});

test("native callable protocols keep exact input identities independent of equal signatures", () => {
  const carrier = rustCallableTargetType([integer], integer);
  const usedNames = new Set();
  const left = create("left", carrier, usedNames);
  const right = create("right", carrier, usedNames);
  assert.equal(left !== undefined && right !== undefined, true);
  assert.equal(left.identity === right.identity, false);
  assert.equal(left.targetName === right.targetName, false);
  assert.equal(left.trait.sourceItem.typeName, left.targetName);
  assert.equal(isRustTargetTypeRef(left.trait), true);
  const error = rustNativeCallableErrorType(left, implementation, "invocation", []);
  assert.equal(isRustTargetTypeRef(error), true);
  assert.equal(error.owner === implementation, true);
  assert.equal(error.trait === left.trait, true);
  assert.equal(error.name, "InvocationError");
  assert.equal(rustNativeCallableErrorType(left, implementation, 0, []) === undefined, true);
  assert.equal(left.completion === undefined, true);
  assert.equal(Object.isFrozen(left.binding.signature), true);
});

test("native future protocols preserve source generics separately from implementation and error types", () => {
  const value = { kind: "type-parameter", identity: "source:Value", name: "Value" };
  const carrier = rustCallableTargetType([value], rustFutureTargetType(value));
  const selected = create("async-input", carrier);
  assert.equal(selected !== undefined, true);
  assert.equal(selected.binding.signature.typeParameters.length, 0);
  assert.equal(selected.binding.signature.environmentParameters.length, 1);
  assert.equal(rustTargetTypeRefEquals(selected.binding.environment[0], value), true);
  const result = rustNativeCallableProtocolResult(selected);
  assert.equal(result !== undefined, true);
  const invocation = result.value.genericArguments[1].type;
  assert.equal(invocation.name, "InvocationError");
  const future = result.value.genericArguments[0].type;
  const output = future.bounds[0].associatedConstraints[0].type;
  assert.equal(output.value.genericArguments[1].type.name, "AwaitError0");
  assert.equal(rustTargetTypeRefEquals(output.value.genericArguments[0].type,
    selected.binding.signature.environmentParameters[0]), true);
  assert.deepEqual(future.captures.map(argument => argument.type.name), ["Self", "EnvironmentType0"]);
  for (const channel of [-1, 1, 0.5, NaN, Infinity])
    assert.equal(rustNativeCallableErrorType(selected, implementation, channel, []) === undefined, true);
  assert.equal(rustNativeCallableErrorType(selected, implementation, 0, []).name, "AwaitError0");
});

test("native callable protocols reject non-callable carriers without creating a guessed signature", () => {
  assert.equal(create("invalid", integer) === undefined, true);
});
