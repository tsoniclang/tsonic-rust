import assert from "node:assert/strict";
import test from "node:test";
import { createRustTypeDefinitionRegistry } from "../../dist/analysis/project-types/type-definitions.js";
import { rustNativeCallableCompletion } from "../../dist/policy/types/callables/native-completion.js";
import { instantiateRustNativeCompletion, rustNativeCompletionFutureType } from "../../dist/target-model/types/callable-completions.js";
import { rustSourcePrimitiveTargetType, rustSourceOptionalTargetType, rustSourceUnionTargetType,
  rustUnitTargetType, rustFutureTargetType } from "../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../dist/target-model/types/equality.js";
import { emptyRustTypeDefinitions } from "../../dist/target-model/types/source-union-definitions.js";
import { rustJsPromiseResolutionTargetType, rustJsPromiseTargetType } from "../../dist/target-model/types/carriers/promises.js";

const integer = rustSourcePrimitiveTargetType("int32");
const unit = rustUnitTargetType();
const pending = rustFutureTargetType(unit);
const implementation = { kind: "type-parameter", identity: "callback-input", name: "Callback" };
const nativeError = { kind: "associated-type", owner: implementation, name: "AwaitError" };

test("native completion contracts retain finite immediate, absent and pending branches", () => {
  const definitions = createRustTypeDefinitionRegistry();
  const value = rustSourceUnionTargetType("/index.ts", "Union2", [], "generated", { kind: "physical", types: [integer, pending] });
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
  const instantiated = instantiateRustNativeCompletion(selected, () => native, definitions);
  const expected = rustSourceOptionalTargetType(rustSourceUnionTargetType("/index.ts", "Union2",
    [], "generated", { kind: "physical", types: [integer, native] }));
  assert.equal(rustTargetTypeRefEquals(instantiated, expected), true);
  assert.equal(Object.isFrozen(selected), true);
  assert.equal(Object.isFrozen(selected.futures), true);
});

test("native completion channels preserve different outputs and exact associated errors", () => {
  const definitions = createRustTypeDefinitionRegistry();
  const other = rustFutureTargetType(integer);
  const value = rustSourceUnionTargetType("/index.ts", "Union2", [], "generated", { kind: "physical", types: [pending, other] });
  assert.equal(definitions.registerSourceUnion({ carrier: value,
    variants: [{ name: "Variant0", carrier: pending }, { name: "Variant1", carrier: other }] }, false), true);
  const selected = rustNativeCallableCompletion(value, definitions);
  assert.equal(selected.futures.length, 2);
  assert.deepEqual(selected.futures.map(future => future.ordinal), [0, 1]);
  const errors = [nativeError, { ...nativeError, name: "OtherError" }];
  const native = instantiateRustNativeCompletion(selected, future => rustNativeCompletionFutureType({
    identity: `future-${future.ordinal}`, output: future.output, error: errors[future.ordinal], captures: [],
  }), definitions);
  for (const [index, payload] of native.value.payloads.types.entries()) {
    const output = payload.bounds[0].associatedConstraints[0].type;
    assert.equal(rustTargetTypeRefEquals(output.value.genericArguments[1].type, errors[index]), true);
    assert.equal(Object.isFrozen(payload), true);
  }
});

test("native completion evidence rejects unknown, malformed and unresolved payloads", () => {
  for (const carrier of [integer, unit, { kind: "opaque", id: "unknown" },
    { kind: "target-named", id: "rust.core.Future", genericArguments: [] },
    rustSourceUnionTargetType("/missing.ts", "Missing", [], "generated")]) {
    assert.equal(rustNativeCallableCompletion(carrier) === undefined, true);
  }
  const selected = rustNativeCallableCompletion(pending);
  assert.equal(instantiateRustNativeCompletion(selected, () => undefined, emptyRustTypeDefinitions) === undefined, true);
  assert.equal(instantiateRustNativeCompletion(selected, () => ({ kind: "not-a-carrier" }), emptyRustTypeDefinitions) === undefined, true);
});

test("authored completion payloads preserve nominal and source generic identity", () => {
  const definitions = createRustTypeDefinitionRegistry();
  const parameter = { kind: "type-parameter", identity: "authored:Value", name: "Value" };
  const declaration = rustSourceUnionTargetType("/completion.ts", "Completion", [{ kind: "type", type: parameter }]);
  assert.equal(definitions.registerSourceUnion({ carrier: declaration, variants: [
    { name: "Ready", carrier: parameter }, { name: "Pending", carrier: rustFutureTargetType(parameter) },
  ] }, true), true);
  const selectedCarrier = rustSourceUnionTargetType("/completion.ts", "Completion", [{ kind: "type", type: integer }]);
  const logical = rustSourceOptionalTargetType(selectedCarrier);
  const completion = rustNativeCallableCompletion(logical, definitions);
  assert.equal(completion !== undefined, true);
  const future = rustNativeCompletionFutureType({ identity: "authored-completion", output: integer, error: nativeError, captures: [] });
  const physical = instantiateRustNativeCompletion(completion, () => future, definitions);
  assert.equal(physical.sourceAbsence, logical.sourceAbsence);
  const union = physical.genericArguments[0].type;
  assert.equal(union.value.typeName, "Completion");
  assert.equal(union.value.fileName, "/completion.ts");
  assert.equal(rustTargetTypeRefEquals(union.value.genericArguments[0].type, integer), true);
  const variants = definitions.sourceUnionVariants(union);
  assert.deepEqual(variants.map(variant => variant.name), ["Ready", "Pending"]);
  assert.equal(rustTargetTypeRefEquals(variants[0].carrier, integer), true);
  assert.equal(rustTargetTypeRefEquals(variants[1].carrier, future), true);
  assert.equal(instantiateRustNativeCompletion(completion, () => future, emptyRustTypeDefinitions) === undefined, true);
});

test("runtime completion unions retain their one-argument Promise layout", () => {
  const carrier = rustJsPromiseResolutionTargetType(integer);
  const completion = rustNativeCallableCompletion(carrier);
  assert.equal(completion !== undefined, true);
  const promise = rustJsPromiseTargetType(integer);
  const selected = instantiateRustNativeCompletion(completion, () => promise, emptyRustTypeDefinitions);
  assert.equal(selected.genericArguments.length, 1);
  assert.equal(rustTargetTypeRefEquals(selected.genericArguments[0].type, integer), true);
  for (const incompatible of [rustFutureTargetType(integer), rustJsPromiseTargetType(unit),
    { ...promise, genericArguments: [...promise.genericArguments, { kind: "type", type: nativeError }] }])
    assert.equal(instantiateRustNativeCompletion(completion, () => incompatible, emptyRustTypeDefinitions) === undefined, true);
});
