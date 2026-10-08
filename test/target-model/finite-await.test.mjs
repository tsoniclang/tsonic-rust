import assert from "node:assert/strict";
import test from "node:test";
import { rustAwaitSelection, rustAwaitSelectionLeaves, rustAwaitSelectionResultCarrier } from "../../dist/target-model/types/await.js";
import { rustAbsenceTargetType, rustFutureTargetType, rustJsPromiseTargetType,
  rustOptionTargetType, rustSourceOptionalTargetType, rustSourcePrimitiveTargetType,
  rustSourceUnionTargetType, rustUnitTargetType, rustJsPromiseTargetTypeWithLifetime } from "../../dist/target-model/types/index.js";
import { finalizeRustAwaitValueFact, rustAwaitValueMatchesCarrier, rustAwaitValueRequirements } from "../../dist/analysis/facts/await-values.js";
import { rustFutureValueForSourceStorage, rustFutureValuesForSourceStorage } from "../../dist/analysis/facts/future-values.js";
import { selectRustSourceValueConversion } from "../../dist/policy/conversions/selection.js";
import { rustTargetTypeRefEquals } from "../../dist/target-model/types/equality.js";

const integer = rustSourcePrimitiveTargetType("uint64");
const boolean = rustSourcePrimitiveTargetType("bool");
const unit = rustUnitTargetType();
const promise = rustJsPromiseTargetType(integer);
const union = rustSourceUnionTargetType("/src/finite.ts", "Completion");
const variants = [ { name: "Direct", carrier: integer }, { name: "Deferred", carrier: promise } ];
const definitions = { programErrorOrigin: () => undefined, sourceUnionVariants: carrier => rustTargetTypeRefEquals(carrier, union) ? variants : undefined };
const select = (source, target) => selectRustSourceValueConversion(source, target, definitions);
const factFor = (carrier, result, resolve = rustFutureValueForSourceStorage, owner = definitions) =>
  finalizeRustAwaitValueFact(carrier, result, resolve,
    (source, target) => selectRustSourceValueConversion(source, target, owner), owner);

test("await requirements retain the exact promise lifetime without constraining native futures or values", () => {
  const staticPromise = rustJsPromiseTargetTypeWithLifetime(integer, { kind: "static" });
  const namedPromise = rustJsPromiseTargetTypeWithLifetime(integer, { kind: "parameter", identity: "await/input", name: "input" });
  for (const [carrier, expected] of [[staticPromise, ["clone", "static"]], [namedPromise, ["clone"]],
    [promise, ["clone"]], [integer, []]]) {
    const fact = factFor(carrier, integer);
    assert.equal(fact !== undefined, true, "validated await fact");
    assert.deepEqual(rustAwaitValueRequirements(fact.selection.value), expected);
  }
  const native = rustFutureTargetType(integer);
  const future = { outputCarrier: integer, awaitedConversion: { kind: "identity", sourceCarrier: integer,
    targetCarrier: integer, fallible: false }, awaiting: "infallible", errorBoundary: "none" };
  const fact = factFor(native, integer, () => future);
  assert.equal(fact !== undefined, true, "validated native future fact");
  assert.deepEqual(rustAwaitValueRequirements(fact.selection.value), []);
});

test("finite await selects exact value/future native branches and preserves native integer output", () => {
  const selection = rustAwaitSelection(union, definitions);
  assert.equal(selection.kind, "union");
  assert.deepEqual(rustAwaitSelectionResultCarrier(selection), integer);
  assert.deepEqual(rustAwaitSelectionLeaves(selection).map(leaf => leaf.future !== undefined), [false, true]);
  const fact = factFor(union, integer);
  assert.ok(fact);
  assert.equal(rustAwaitValueMatchesCarrier(fact, union, integer, definitions), true);
  assert.equal(fact.selection.alternatives[0].selection.value.future, undefined);
  assert.equal(fact.selection.alternatives[1].selection.value.future.awaiting, "fallible");
  assert.deepEqual(fact.selection.alternatives[1].selection.value.future.outputCarrier, integer);
  assert.equal(Object.isFrozen(fact.selection.alternatives[1].selection.value), true);
  assert.equal(rustFutureValuesForSourceStorage(union, definitions).length, 1);
});

test("non-future native carriers remain one identity value, including required Option and closed unions", () => {
  const nativeOption = rustOptionTargetType(integer);
  const syncDefinitions = { programErrorOrigin: () => undefined, sourceUnionVariants: carrier => rustTargetTypeRefEquals(carrier, union)
    ? [ { name: "Wide", carrier: integer }, { name: "Flag", carrier: boolean } ] : undefined };
  for (const [carrier, owner] of [ [integer, definitions], [nativeOption, definitions], [union, syncDefinitions] ]) {
    const selection = rustAwaitSelection(carrier, owner);
    assert.deepEqual(selection, { kind: "leaf", value: { carrier } });
    assert.deepEqual(rustAwaitSelectionResultCarrier(selection), carrier);
    assert.equal(factFor(carrier, carrier, () => undefined, owner).selection.value.completion.kind, "value");
  }
});

test("optional future/value branches emit one native absence and preserve unit effects", () => {
  const optional = rustSourceOptionalTargetType(union);
  const output = rustSourceOptionalTargetType(integer);
  assert.deepEqual(rustAwaitSelectionResultCarrier(rustAwaitSelection(optional, definitions)), output);
  assert.ok(factFor(optional, output));
  assert.equal(factFor(optional, integer), undefined);
  const unitPromise = rustJsPromiseTargetType(unit);
  const unitOptional = rustSourceOptionalTargetType(unitPromise);
  const fact = factFor(unitOptional, unit);
  assert.ok(fact);
  assert.equal(fact.selection.present.value.completion.kind, "value");
  assert.equal(fact.selection.present.value.future.awaiting, "fallible");
  assert.deepEqual(rustAwaitSelectionResultCarrier(rustAwaitSelection(unitOptional)), unit);
  const unitDefinitions = { programErrorOrigin: () => undefined, sourceUnionVariants: carrier => rustTargetTypeRefEquals(carrier, union)
    ? [ { name: "Direct", carrier: unit }, { name: "Deferred", carrier: promise } ] : undefined };
  assert.deepEqual(rustAwaitSelectionResultCarrier(rustAwaitSelection(union, unitDefinitions)), output);
  assert.ok(factFor(union, output, rustFutureValueForSourceStorage, unitDefinitions));
  assert.ok(factFor(rustAbsenceTargetType(), output));
});

test("future native effect evidence is required independently of its syntactic output carrier", () => {
  const native = rustFutureTargetType(integer);
  const exact = { outputCarrier: integer, awaitedConversion: { kind: "identity", sourceCarrier: integer,
    targetCarrier: integer, fallible: false }, awaiting: "infallible", errorBoundary: "none" };
  assert.equal(factFor(native, integer), undefined);
  assert.ok(factFor(native, integer, () => exact));
  assert.equal(factFor(native, integer, () => ({ ...exact, awaiting: "fallible" })), undefined);
  assert.equal(factFor(native, integer, () => ({ ...exact, errorCarrier: boolean })), undefined);
  for (const carrier of [undefined, { kind: "opaque", id: "unresolved-future" },
    null, true, { kind: "source-primitive", name: "invented" },
    { kind: "type-parameter", identity: "open/Value", name: "Value" },
    { ...promise, genericArguments: [] }, { ...native, genericArguments: [] }]) {
    assert.equal(rustAwaitSelection(carrier), undefined);
  }
});

test("finalized await contracts reject mutated coverage, widths, effects, absence and conversion rows", () => {
  const fact = factFor(union, integer);
  const direct = fact.selection.alternatives[0];
  const deferred = fact.selection.alternatives[1];
  const changedFuture = future => ({ ...deferred, selection: { ...deferred.selection,
    value: { ...deferred.selection.value, future } } });
  const changedArms = alternatives => ({ ...fact, selection: { ...fact.selection, alternatives } });
  const invalid = [
    { ...fact, resultCarrier: boolean }, { ...fact, operandCarrier: promise }, { ...fact, extra: true },
    changedArms([deferred, direct]), changedArms([direct]), changedArms([direct, deferred, direct]),
    changedArms([{ ...direct, variant: { ...direct.variant, name: "Other" } }, deferred]),
    changedArms([direct, changedFuture({ ...deferred.selection.value.future, outputCarrier: boolean })]),
    changedArms([direct, changedFuture({ ...deferred.selection.value.future, errorBoundary: "none" })]),
    changedArms([direct, changedFuture({ ...deferred.selection.value.future, errorBoundary: "invented" })]),
    changedArms([direct, changedFuture({ ...deferred.selection.value.future, extra: true })]),
    changedArms([direct, changedFuture(null)]),
    changedArms([direct, changedFuture({ ...deferred.selection.value.future, awaitedConversion: null })]),
    changedArms([direct, changedFuture({ ...deferred.selection.value.future,
      errorBoundary: "provider-native", errorCarrier: { kind: "invented" } })]),
    changedArms([direct, { ...deferred, selection: { ...deferred.selection,
      value: { ...deferred.selection.value, future: undefined } } }]),
    changedArms([{ ...direct, selection: { ...direct.selection,
      value: { ...direct.selection.value, completion: { kind: "absence" } } } }, deferred]),
    changedArms([{ ...direct, selection: { ...direct.selection, value: { ...direct.selection.value,
      completion: { kind: "value", conversion: { kind: "identity", sourceCarrier: integer,
        targetCarrier: boolean, fallible: false } } } } }, deferred]),
    changedArms([{ ...direct, selection: { ...direct.selection, value: { ...direct.selection.value,
      completion: { kind: "value", conversion: null } } } }, deferred]),
    changedArms([{ ...direct, selection: { ...direct.selection, value: { ...direct.selection.value,
      completion: { kind: "value", conversion: { kind: "invented" } } } } }, deferred]),
    changedArms([{ ...direct, selection: { ...direct.selection, value: { ...direct.selection.value,
      completion: { kind: "value", conversion: { kind: "semantic", sourceCarrier: integer,
        targetCarrier: integer, fallible: false, conversion: null } } } } }, deferred]),
  ];
  for (const mutation of invalid) assert.equal(rustAwaitValueMatchesCarrier(mutation, union, integer, definitions), false);
  assert.equal(rustAwaitValueMatchesCarrier(fact, promise, integer, definitions), false);
  assert.equal(rustAwaitValueMatchesCarrier(fact, union, boolean, definitions), false);
  const cyclic = { ...fact, selection: { kind: "optional", carrier: union } };
  cyclic.selection.present = cyclic.selection;
  assert.equal(rustAwaitValueMatchesCarrier(cyclic, union, integer, definitions), false);
});

test("native await topology rejects cycles, duplicate variants, and excessive finite selections", () => {
  for (const alternatives of [ [], [ { name: "Loop", carrier: union } ],
    new Array(1), [ { name: "", carrier: promise } ],
    [ { name: "Repeated", carrier: integer }, { name: "Repeated", carrier: promise } ],
    Array.from({ length: 4097 }, (_, index) => ({ name: `Arm${index}`, carrier: integer })) ]) {
    assert.equal(rustAwaitSelection(union, { programErrorOrigin: () => undefined, sourceUnionVariants: carrier =>
      rustTargetTypeRefEquals(carrier, union) ? alternatives : undefined }), undefined);
  }
  let deep = promise;
  for (let depth = 0; depth < 128; depth += 1) deep = rustOptionTargetType(deep);
  assert.equal(rustAwaitSelection(deep), undefined);
  assert.equal(select(integer, boolean), undefined);
});
