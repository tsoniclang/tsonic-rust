import assert from "node:assert/strict";
import test from "node:test";
import { rustCallableConversionPhysical, rustCallableConversionErrorArities, rustCallablePhysicalCarrier } from "../../dist/policy/conversions/callable-physical.js";
import { rustCallablePhysicalSignature } from "../../dist/target-model/conversions/callable-physical.js";
import { selectRustCallableConversion } from "../../dist/policy/conversions/callable.js";
import { selectRustExactIntegerConversion } from "../../dist/policy/conversions/exact-integer.js";
import { rustCallableTargetType, rustCallableInputTargetType } from "../../dist/target-model/types/carriers/callables.js";
import { rustNamedTargetType, rustNamedTypeCarrierValue, isRustNamedTypeTraitContract } from "../../dist/target-model/types/carriers/native.js";
import { rustInfallibleTargetId } from "../../dist/target-model/types/carriers/source-types.js";
import { rustFutureTargetType } from "../../dist/target-model/types/carriers/primitives.js";
import { rustNativeErrorJoinReference } from "../../dist/target-model/types/native-error-joins.js";
import { rustRuntimeCallableTargetType, rustRuntimeErrorTargetType } from "../../dist/target-model/types/carriers/runtime-carriers.js";
import { isRustCopyCarrier, rustCarrierSupportsClone, rustCarrierSupportsTrait } from "../../dist/policy/constraints/native-traits.js";
import { rustTargetTypeRefEquals } from "../../dist/target-model/types/equality.js";
import { rustNativeCompletionFutureType } from "../../dist/target-model/types/callable-completions.js";
import { rustProgramErrorTargetType } from "../../dist/target-model/types/carriers/js.js";

const integer = { kind: "source-primitive", name: "int32" };
const wide = { kind: "source-primitive", name: "int64" };
const infallible = { kind: "target-named", id: rustInfallibleTargetId };
const failure = rustNamedTargetType("fixture:Failure", "Failure");
const file = "/adapt.ts";
const select = (source, target) => selectRustCallableConversion(source, target, selectRustExactIntegerConversion);
const physicalCarrier = ({ parameters, result, error }) => rustRuntimeCallableTargetType({ kind: "static" }, parameters,
  rustNamedTargetType("rust.core.Result", "Result", [
    { kind: "type", type: result }, { kind: "type", type: error },
  ]));

test("logical callable implementation bindings retain one exact physical Result and error identity", () => {
  for (const lifetime of [{ kind: "static" }, { kind: "parameter", identity: "fixture:environment", name: "environment" }]) {
    for (const error of [infallible, failure, rustRuntimeErrorTargetType()]) {
      const logical = rustCallableTargetType([integer], wide, lifetime, error);
      const physical = rustCallablePhysicalCarrier(logical);
      assert.equal(physical !== undefined, true, "the logical callable has its canonical native implementation");
      const signature = rustCallablePhysicalSignature(physical);
      assert.equal(signature !== undefined, true, "the implementation is a physical callable, not the logical protocol");
      assert.equal(rustTargetTypeRefEquals(signature.parameters[0], integer), true, "the input carrier is unchanged");
      assert.equal(rustTargetTypeRefEquals(signature.result, wide), true, "the source result is not another Result wrapper");
      assert.equal(rustTargetTypeRefEquals(signature.error, error), true, "the exact native error identity is unchanged");
      const actualLifetime = rustNamedTypeCarrierValue(physical).genericArguments[0].lifetime;
      assert.equal(actualLifetime.kind, lifetime.kind, "the actual environment kind remains unchanged");
      if (lifetime.kind === "parameter") {
        assert.equal(actualLifetime.identity, lifetime.identity, "the actual environment identity remains unchanged");
        assert.equal(actualLifetime.name, lifetime.name, "the actual environment name remains unchanged");
      }
      assert.equal(rustCallablePhysicalCarrier(physical) === physical, true, "an existing physical implementation is not wrapped again");
      assert.equal(rustCallablePhysicalSignature(logical) === undefined, true, "the logical protocol cannot masquerade as an implementation");
    }
  }
  assert.equal(rustCallablePhysicalCarrier(integer) === undefined, true, "an unrelated native value is not a callable");
});

test("native retained Callable Clone and identity equality have no parameter, result or error trait bound", () => {
  const lifetime = { kind: "parameter", identity: "checked:retained-region", name: "region" };
  const parameter = { kind: "type-parameter", identity: "checked:Payload", name: "Payload" };
  const parameters = [parameter];
  const completion = rustNamedTargetType("rust.core.Result", "Result", [
    { kind: "type", type: parameter }, { kind: "type", type: failure },
  ]);
  const carrier = rustRuntimeCallableTargetType(lifetime, parameters, completion);
  assert.equal(isRustNamedTypeTraitContract(carrier.value.traits), true,
    "the producer publishes the exact native implementations in the canonical contract order");
  const named = rustNamedTypeCarrierValue(carrier);
  assert.equal(named !== undefined, true, "the actual physical carrier is admitted by its canonical native metadata reader");
  assert.equal(named.genericArguments[0].lifetime === lifetime, true, "the actual selected borrowed construction lifetime is unchanged");
  assert.equal(named.genericArguments[1].type.elements === parameters, true, "every native invocation parameter remains in the original tuple");
  assert.equal(named.genericArguments[2].type === completion, true, "the native return and exact error completion are unchanged");
  let obligations = 0;
  assert.equal(rustCarrierSupportsTrait(carrier, "core::clone::Clone", () => { obligations++; return false; }), true,
    "the native Callable Clone implementation clones only its existing Rc");
  assert.equal(obligations, 0, "no payload, result or error Clone requirement is invented");
  assert.equal(rustCarrierSupportsClone(carrier), true, "physical native metadata preserves the real Clone implementation");
  for (const trait of ["core::cmp::PartialEq", "core::cmp::Eq"]) {
    assert.equal(rustCarrierSupportsTrait(carrier, trait, () => { obligations++; return false; }), true,
      `the actual native Callable implements ${trait} on its complete Self carrier`);
    assert.equal(rustCarrierSupportsTrait(completion, trait), false, `${trait} is not imposed on the actual completion`);
    assert.equal(rustCarrierSupportsTrait(failure, trait), false, `${trait} is not invented for an unrelated native carrier`);
  }
  assert.equal(obligations, 0, "native handle identity adds no parameter, result or error equality obligation");
  assert.equal(rustCarrierSupportsTrait(carrier, "core::hash::Hash"), false, "native identity equality does not invent Hash");
  assert.equal(isRustCopyCarrier(carrier), false, "the native retained handle is not Copy");
  assert.equal(rustCarrierSupportsClone(completion), false, "cloning a handle does not make its actual completion Clone");
  assert.equal(rustCarrierSupportsClone(failure), false, "unrelated move-only native carriers remain move-only");
  const signature = rustCallablePhysicalSignature(carrier);
  assert.equal(signature.parameters[0] === parameter && signature.result === parameter && signature.error === failure, true,
    "the same physical callable ABI remains available without a compatibility representation");
});

test("physical adapters preserve source error and native Future payload without ambient substitution", () => {
  const future = rustFutureTargetType(integer);
  const selected = select(rustCallableTargetType([], future), rustCallableTargetType([integer], future));
  const native = rustNativeCompletionFutureType({ identity: "fixture:Future", output: integer, error: failure, captures: [] });
  for (const error of [infallible, failure]) {
    const physical = rustCallableConversionPhysical(selected, { parameters: [], result: native, error }, file);
    assert.equal(physical !== undefined, true);
    assert.equal(rustTargetTypeRefEquals(physical.result, native), true);
    assert.equal(rustTargetTypeRefEquals(physical.error, error), true);
    assert.equal(rustTargetTypeRefEquals(rustCallablePhysicalSignature(physical.carrier).result, native), true);
    assert.equal(physical.errors.length, 1);
    assert.equal(Object.isFrozen(physical.arguments), true);
    assert.equal(Object.isFrozen(physical.source), true);
    assert.equal(Object.isFrozen(physical.result.bounds), true);
  }
  assert.deepEqual(rustCallableConversionErrorArities(selected), []);
});

test("physical adapters eliminate uninhabited invocation errors only for concrete target error contracts", () => {
  const actual = { parameters: [], result: integer, error: infallible };
  for (const error of [rustRuntimeErrorTargetType(),
    rustProgramErrorTargetType({ kind: "physical", domain: "project", componentId: "fixture:component" })]) {
    const target = rustCallableTargetType([integer], integer, { kind: "static" }, error);
    const selected = select(physicalCarrier(actual), target);
    assert.equal(selected !== undefined, true, "the exact native source admits uninhabited-error elimination");
    const physical = rustCallableConversionPhysical(selected, actual, file);
    assert.equal(physical !== undefined, true, "the selected concrete destination error is representable");
    assert.equal(physical.eliminatedInvokeError, true);
    assert.equal(rustTargetTypeRefEquals(physical.error, error), true);
    assert.equal(rustTargetTypeRefEquals(rustCallablePhysicalSignature(physical.carrier).error, error), true);
    assert.equal(select(physicalCarrier({ ...actual, error: failure }), target), undefined,
      "an inhabited native error cannot be eliminated or silently replaced");
  }
});

test("fallible argument and result adapters expose canonical distinct exact error channels", () => {
  const selected = select(rustCallableTargetType([integer], wide), rustCallableTargetType([wide], integer));
  const physical = rustCallableConversionPhysical(selected, { parameters: [integer], result: wide, error: failure }, file);
  assert.equal(physical !== undefined, true);
  assert.deepEqual(physical.errors.map(error => error.identity), ["invoke", "parameter:0", "result"]);
  assert.deepEqual(rustCallableConversionErrorArities(selected), [3]);
  const joined = rustNativeErrorJoinReference(physical.error);
  assert.equal(joined.errors.length, 3);
  assert.equal(rustTargetTypeRefEquals(joined.errors[0], failure), true);
  assert.equal(joined.errors.slice(1).every(error => rustTargetTypeRefEquals(error, rustRuntimeErrorTargetType())), true);
  assert.equal(physical.arguments[0].errorIdentity, "parameter:0");
  assert.equal(physical.resultPlan.errorIdentity, "result");
  assert.equal(rustTargetTypeRefEquals(rustCallablePhysicalSignature(physical.carrier).error, physical.error), true);
});

test("nested result adaptation reuses its own exact physical payload not the outer callable", () => {
  const original = rustCallableTargetType([], wide);
  const target = rustCallableTargetType([], integer);
  const selected = select(rustCallableTargetType([], original), rustCallableTargetType([], target));
  const nested = { parameters: [], result: wide, error: failure };
  const physical = rustCallableConversionPhysical(selected,
    { parameters: [], result: physicalCarrier(nested), error: infallible }, file);
  assert.equal(physical !== undefined, true);
  assert.equal(physical.resultPlan.kind, "callable");
  assert.equal(rustTargetTypeRefEquals(physical.error, infallible), true, "constructing the nested adapter is infallible");
  assert.equal(rustTargetTypeRefEquals(physical.resultPlan.conversion.source.error, failure), true);
  assert.equal(rustNativeErrorJoinReference(rustCallablePhysicalSignature(physical.result).error).errors.length, 2);
  assert.deepEqual(rustCallableConversionErrorArities(selected), [2]);
});

test("borrowed input adapters expose native tuple closure and exact Result without owning storage", () => {
  const selected = select(rustCallableTargetType([], integer), rustCallableInputTargetType([integer], integer));
  const physical = rustCallableConversionPhysical(selected, { parameters: [], result: integer, error: failure }, file);
  assert.equal(physical !== undefined, true);
  assert.equal(physical.carrier.kind, "closure");
  assert.equal(rustTargetTypeRefEquals(rustCallablePhysicalSignature(physical.carrier).error, failure), true);
});

test("physical adapter validation rejects malformed selections and inconsistent exact inputs", () => {
  const selected = select(rustCallableTargetType([integer], wide), rustCallableTargetType([wide], integer));
  const actual = { parameters: [integer], result: wide, error: failure };
  for (const [label, source] of [["arity", { ...actual, parameters: [] }], ["sparse", { ...actual, parameters: new Array(1) }],
    ["input", { ...actual, parameters: [wide] }], ["result", { ...actual, result: integer }],
    ["missing error", { ...actual, error: undefined }], ["extra", { ...actual, extra: true }]])
    assert.equal(rustCallableConversionPhysical(selected, source, file) === undefined, true, label);
  for (const changed of [null, undefined, { ...selected, extra: true }, { ...selected, result: { kind: "borrow" } },
    { ...selected, parameters: [] }]) {
    assert.equal(rustCallableConversionPhysical(changed, actual, file) === undefined, true);
    assert.equal(rustCallableConversionErrorArities(changed) === undefined, true);
  }
  assert.equal(rustCallablePhysicalSignature(selected.source) === undefined, true, "logical source cannot masquerade as physical");
  const invalid = { ...physicalCarrier(actual), value: { ...physicalCarrier(actual).value, id: "fixture:Other" } };
  assert.equal(rustCallablePhysicalSignature(invalid) === undefined, true);
});
