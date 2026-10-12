import assert from "node:assert/strict";
import test from "node:test";
import { createRustTypeDefinitionRegistry } from "../../dist/analysis/project-types/type-definitions.js";
import { rustNativeCallableCompletion, instantiateRustNativeCompletion, rustNativeCompletionFutureType }
  from "../../dist/target-model/types/callable-completions.js";
import { rustSourcePrimitiveTargetType, rustSourceOptionalTargetType, rustSourceUnionTargetType,
  rustUnitTargetType, rustFutureTargetType } from "../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../dist/target-model/types/equality.js";

const integer = rustSourcePrimitiveTargetType("int32");
const unit = rustUnitTargetType();
const pending = rustFutureTargetType(unit);
const implementation = { kind: "type-parameter", identity: "callback-input", name: "Callback" };
const nativeError = { kind: "associated-type", owner: implementation, name: "AwaitError" };

test("native completion contracts retain finite immediate, absent and pending branches", () => {
  const definitions = createRustTypeDefinitionRegistry();
  const value = rustSourceUnionTargetType("/index.ts", "Union2", [integer, pending].map(type => ({ kind: "type", type })), "generated");
  assert.equal(definitions.registerSourceUnion({ carrier: value,
    variants: [{ name: "Variant0", carrier: integer }, { name: "Variant1", carrier: pending }] }, false), true);
  const result = rustSourceOptionalTargetType(value);
  const selected = rustNativeCallableCompletion(result, definitions);
  assert.equal(selected !== undefined, true);
  assert.equal(selected.selection.kind, "optional");
  assert.equal(selected.selection.present.kind, "union");
  assert.equal(selected.futures.length, 1);
  assert.equal(rustTargetTypeRefEquals(selected.futures[0].output, unit), true);
  const native = rustNativeCompletionFutureType({ identity: "callback-completion", output: unit,
    error: nativeError, captures: [{ kind: "type", type: implementation }] });
  const instantiated = instantiateRustNativeCompletion(selected, () => native);
  const expected = rustSourceOptionalTargetType(rustSourceUnionTargetType("/index.ts", "Union2",
    [integer, native].map(type => ({ kind: "type", type })), "generated"));
  assert.equal(rustTargetTypeRefEquals(instantiated, expected), true);
  assert.equal(Object.isFrozen(selected), true);
  assert.equal(Object.isFrozen(selected.futures), true);
});

test("native completion channels preserve different outputs and exact associated errors", () => {
  const definitions = createRustTypeDefinitionRegistry();
  const other = rustFutureTargetType(integer);
  const value = rustSourceUnionTargetType("/index.ts", "Union2", [pending, other].map(type => ({ kind: "type", type })), "generated");
  assert.equal(definitions.registerSourceUnion({ carrier: value,
    variants: [{ name: "Variant0", carrier: pending }, { name: "Variant1", carrier: other }] }, false), true);
  const selected = rustNativeCallableCompletion(value, definitions);
  assert.equal(selected.futures.length, 2);
  assert.deepEqual(selected.futures.map(future => future.ordinal), [0, 1]);
  const errors = [nativeError, { ...nativeError, name: "OtherError" }];
  const native = instantiateRustNativeCompletion(selected, future => rustNativeCompletionFutureType({
    identity: `future-${future.ordinal}`, output: future.output, error: errors[future.ordinal], captures: [],
  }));
  for (const [index, argument] of native.value.genericArguments.entries()) {
    const output = argument.type.bounds[0].associatedConstraints[0].type;
    assert.equal(rustTargetTypeRefEquals(output.value.genericArguments[1].type, errors[index]), true);
    assert.equal(Object.isFrozen(argument.type), true);
  }
});

test("native completion evidence rejects unknown, malformed and unresolved payloads", () => {
  for (const carrier of [integer, unit, { kind: "opaque", id: "unknown" },
    { kind: "target-named", id: "rust.core.Future", genericArguments: [] },
    rustSourceUnionTargetType("/missing.ts", "Missing", [], "generated")]) {
    assert.equal(rustNativeCallableCompletion(carrier) === undefined, true);
  }
  const selected = rustNativeCallableCompletion(pending);
  assert.equal(instantiateRustNativeCompletion(selected, () => undefined) === undefined, true);
  assert.equal(instantiateRustNativeCompletion(selected, () => ({ kind: "not-a-carrier" })) === undefined, true);
});
