import assert from "node:assert/strict";
import test from "node:test";
import { createRustNativeCallableProtocolRegistry } from "../../../dist/analysis/callables/native/native-protocols.js";
import { rustNativeCallableErrorChannel, rustNativeCallableErrorType } from "../../../dist/policy/types/callables/native-protocols.js";
import { rustCallableTargetType, rustFutureTargetType, rustJsPromiseTargetType, rustJsValueTargetType, rustSourcePrimitiveTargetType }
  from "../../../dist/target-model/types/index.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

const integer = rustSourcePrimitiveTargetType("int32");
const implementation = { kind: "type-parameter", identity: "input:left", name: "Left" };
const create = () => createRustNativeCallableProtocolRegistry({ definitions: emptyRustTypeDefinitions, usedNames: new Set(),
  structuralShapes: { instantiateSourceCarrier() { assert.fail("these scalar protocol fixtures have no structural output"); } } });

test("equal native signatures share one protocol while implementation and associated errors stay distinct", () => {
  const registry = create();
  const carrier = rustCallableTargetType([integer], integer);
  const left = registry.bind("/source.ts", carrier);
  const right = registry.bind("/source.ts", carrier);
  assert.equal(left !== undefined && right !== undefined, true);
  assert.equal(left.protocol === right.protocol, true);
  assert.equal(left.protocol.result === right.protocol.result, true, "one admitted protocol owns one exact result object");
  assert.equal(Object.isFrozen(left.protocol.result), true, "the complete required result is sealed with the protocol");
  assert.equal(registry.definitions().length, 1);
  assert.equal(left.trait.sourceItem.typeName, left.protocol.targetName);
  assert.equal(isRustTargetTypeRef(left.trait), true);
  const other = { kind: "type-parameter", identity: "input:right", name: "Right" };
  const error = rustNativeCallableErrorType(left, implementation, "invocation", []);
  const otherError = rustNativeCallableErrorType(right, other, "invocation", []);
  assert.equal(isRustTargetTypeRef(error) && isRustTargetTypeRef(otherError), true);
  assert.equal(error.owner === implementation && otherError.owner === other, true);
  assert.equal(rustTargetTypeRefEquals(error, otherError), false);
  assert.equal(error.trait === left.trait, true);
  assert.equal(error.name, "InvocationError");
  assert.equal(rustNativeCallableErrorType(left, implementation, 0, []) === undefined, true);
  assert.equal(left.protocol.completion === undefined, true);
  assert.equal(Object.isFrozen(left.protocol.signature) && Object.isFrozen(left.environment), true);
});

test("native future definitions alpha normalize source environments without merging selected arguments", () => {
  const registry = create();
  const value = { kind: "type-parameter", identity: "source:Value", name: "Value" };
  const other = { kind: "type-parameter", identity: "other:Item", name: "Item" };
  const selected = registry.bind("/source.ts", rustCallableTargetType([value], rustFutureTargetType(value)));
  const second = registry.bind("/source.ts", rustCallableTargetType([other], rustFutureTargetType(other)));
  assert.equal(selected !== undefined && second !== undefined, true);
  assert.equal(selected.protocol === second.protocol, true);
  assert.equal(selected.protocol.signature.typeParameters.length, 0);
  assert.equal(selected.protocol.signature.environmentParameters.length, 1);
  assert.equal(selected.environment[0].kind === "type" && rustTargetTypeRefEquals(selected.environment[0].type, value), true);
  assert.equal(second.environment[0].kind === "type" && rustTargetTypeRefEquals(second.environment[0].type, other), true);
  assert.equal(rustTargetTypeRefEquals(selected.trait, second.trait), false);
  const result = selected.protocol.result;
  assert.equal(result !== undefined, true);
  const invocation = result.value.genericArguments[1].type;
  assert.equal(invocation.name, "InvocationError");
  const future = result.value.genericArguments[0].type;
  const output = future.bounds[0].associatedConstraints[0].type;
  assert.equal(output.value.genericArguments[1].type.name, "AwaitError0");
  assert.equal(rustTargetTypeRefEquals(output.value.genericArguments[0].type,
    selected.protocol.signature.environmentParameters[0]), true);
  assert.deepEqual(future.captures.map(argument => argument.type.name), ["Self", "EnvironmentType0"]);
  for (const channel of [-1, 1, 0.5, NaN, Infinity])
    assert.equal(rustNativeCallableErrorType(selected, implementation, channel, []) === undefined, true);
  assert.equal(rustNativeCallableErrorType(selected, implementation, 0, []).name, "AwaitError0");
});

test("native protocol identity retains unequal types, lifetime binders and component ownership", () => {
  const registry = create();
  const value = registry.bind("/source.ts", rustCallableTargetType([integer], integer));
  const unsigned = registry.bind("/source.ts", rustCallableTargetType([rustSourcePrimitiveTargetType("uint32")], integer));
  const borrowed = registry.bind("/source.ts", rustCallableTargetType([
    { kind: "reference", referent: integer, mutable: false },
  ], { kind: "reference", referent: integer, mutable: false }));
  const mutable = registry.bind("/source.ts", rustCallableTargetType([
    { kind: "reference", referent: integer, mutable: true },
  ], integer));
  const dependency = registry.bind("/dependency.ts", rustCallableTargetType([integer], integer));
  assert.equal([value, unsigned, borrowed, mutable, dependency].every(binding => binding !== undefined), true);
  assert.equal(new Set([value, unsigned, borrowed, mutable, dependency].map(binding => binding.protocol)).size, 5);
  assert.equal(borrowed.protocol.method.binder.parameters.length, 1);
  assert.equal(borrowed.protocol.method.result.lifetime.identity,
    borrowed.protocol.method.parameters[0].lifetime.identity);
  const repeat = registry.bind("/source.ts", rustCallableTargetType([
    { kind: "reference", referent: integer, mutable: false },
  ], { kind: "reference", referent: integer, mutable: false }));
  assert.equal(repeat.protocol === borrowed.protocol, true);
});

test("JS Promise input completions use the same rejection carrier across distinct implementations", () => {
  const registry = create();
  const selected = registry.bind("/source.ts", rustCallableTargetType([integer], rustJsPromiseTargetType(integer)));
  const other = { kind: "type-parameter", identity: "other:implementation", name: "Other" };
  for (const producer of [implementation, other]) {
    const error = rustNativeCallableErrorType(selected, producer, 0, []);
    assert.equal(rustTargetTypeRefEquals(error, rustJsValueTargetType()), true);
  }
  const result = selected.protocol.result;
  assert.equal(rustTargetTypeRefEquals(result.value.genericArguments[0].type, rustJsPromiseTargetType(integer)), true);
  assert.equal(rustNativeCallableErrorType(selected, implementation, 1, []) === undefined, true);
});

test("native protocol registry rejects invalid carriers and ambiguous borrowed result relationships", () => {
  const registry = create();
  assert.equal(registry.bind("/source.ts", integer) === undefined, true);
  const reference = { kind: "reference", referent: integer, mutable: false };
  assert.equal(registry.bind("/source.ts", rustCallableTargetType([reference, reference], reference)) === undefined, true);
  assert.equal(registry.definitions().length, 0);
});

test("native protocol publication rejects mutation without replacing the admitted result", () => {
  const registry = create();
  const selected = registry.bind("/source.ts", rustCallableTargetType([integer], integer));
  assert.equal(selected !== undefined, true, "the original source protocol is admitted");
  const result = selected.protocol.result;
  const repeated = registry.bind("/source.ts", rustCallableTargetType([integer], integer));
  assert.equal(repeated.protocol === selected.protocol, true, "the original protocol is reused");
  assert.equal(selected.protocol.result === result, true, "successful checking never replaces the original result");
  assert.equal(Reflect.set(selected.protocol, "result", integer), false,
    "the published record cannot accept an unequal result");
  assert.equal(selected.protocol.result === result && Object.isFrozen(result), true,
    "a rejected corrupt copy cannot mutate the canonical original");
});

test("native error channel proof requires the exact implementation, protocol, environment and method arguments", () => {
  const registry = create();
  const value = { kind: "type-parameter", identity: "source:Value", name: "Value" };
  const selected = registry.bind("/source.ts", rustCallableTargetType([value], rustFutureTargetType(value)));
  const invocation = rustNativeCallableErrorType(selected, implementation, "invocation", []);
  const awaited = rustNativeCallableErrorType(selected, implementation, 0, []);
  assert.equal(rustNativeCallableErrorChannel(selected, implementation, invocation), "invocation");
  assert.equal(rustNativeCallableErrorChannel(selected, implementation, awaited), 0);
  const other = { kind: "type-parameter", identity: "input:other", name: "Other" };
  const wrongEnvironment = { ...invocation.trait, genericArguments: [{ kind: "type", type: integer }] };
  for (const invalid of [
    { ...invocation, owner: other },
    { ...invocation, trait: { ...invocation.trait, path: "OtherProtocol" } },
    { ...invocation, trait: wrongEnvironment },
    { ...invocation, name: "AwaitError1" },
    { ...invocation, genericArguments: [{ kind: "type", type: integer }] },
    { ...invocation, trait: { ...invocation.trait, associatedConstraints: [{ name: "Extra", type: integer }] } },
  ]) assert.equal(rustNativeCallableErrorChannel(selected, implementation, invalid) === undefined, true);
  const js = registry.bind("/source.ts", rustCallableTargetType([integer], rustJsPromiseTargetType(integer)));
  assert.equal(rustNativeCallableErrorChannel(js, implementation,
    rustNativeCallableErrorType(js, implementation, 0, [])) === undefined, true);
  const borrowed = registry.bind("/source.ts", rustCallableTargetType([
    { kind: "reference", referent: integer, mutable: false },
  ], integer));
  const arguments_ = borrowed.protocol.method.binder.parameters.map(parameter => ({ kind: "lifetime", lifetime: parameter.lifetime }));
  const borrowedError = rustNativeCallableErrorType(borrowed, implementation, "invocation", arguments_);
  assert.equal(rustNativeCallableErrorChannel(borrowed, implementation, borrowedError), "invocation");
  assert.equal(rustNativeCallableErrorChannel(borrowed, implementation,
    { ...borrowedError, genericArguments: [{ kind: "type", type: integer }] }) === undefined, true);
});
