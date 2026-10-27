import assert from "node:assert/strict";
import test from "node:test";
import { selectRustCallableParameterAdapters, selectRustCallableValueAdapter } from "../../../dist/policy/conversions/callable-adapters.js";
import * as sourceCollectors from "../../../dist/analysis/callables/native/adapters.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustOptionTargetType, rustSourcePrimitiveTargetType, rustStringTargetType, rustVecTargetType,
  rustJsArrayTargetType, rustUnitTargetType } from "../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { rustInfallibleTargetId } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustCallablePhysicalCarrier, rustCallableConversionPhysical } from "../../../dist/policy/conversions/callable-physical.js";
import { rustCallableConversionMatches } from "../../../dist/policy/conversions/callable.js";
import { rustCallablePhysicalSignature } from "../../../dist/target-model/conversions/callable-physical.js";

const projectTypes = Object.freeze({ definitionForCarrier: () => undefined, relationship: () => ({ kind: "unrelated" }) });
const integer = rustSourcePrimitiveTargetType("int32");
const text = rustStringTargetType();
const parameter = (carrier, form = "required", mode = "value") => Object.freeze({
  form, mode, valueCarrier: carrier, parameterCarrier: carrier,
});

test("native callable selection replaces the old analysis selection and recomputation APIs", () => {
  for (const name of ["selectRustCallableValueAdapter", "selectRustCallableParameterAdapters",
    "rustCallableParameterAdaptersMatch", "rustCallableValueAdapterIsFallible", "rustCallableParameterAdapterIsFallible",
    "callableRestElement"]) assert.equal(Object.hasOwn(sourceCollectors, name), false, name);
  assert.equal(typeof sourceCollectors.sourceCallableParameterAbis, "function", "checked source collection stays in analysis");
});

test("native callable value admission stores exact immutable conversion and option lowering", () => {
  const selected = selectRustCallableValueAdapter(integer, rustOptionTargetType(integer), projectTypes, emptyRustTypeDefinitions);
  assert.equal(selected.kind, "option-some");
  assert.equal(selected.fallible, false);
  assert.equal(selected.element.kind, "identity");
  assert.equal(selected.element.fallible, false);
  assert.equal(Object.isFrozen(selected) && Object.isFrozen(selected.element), true, "the complete option decision is immutable");
  assert.equal(rustTargetTypeRefEquals(selected.element.sourceCarrier, integer), true, "the native input remains int32");
  const absent = selectRustCallableValueAdapter(rustUnitTargetType(),
    rustOptionTargetType(integer), projectTypes, emptyRustTypeDefinitions);
  assert.equal(absent.kind, "absent-completion");
  assert.equal(absent.fallible, false);
  const conversion = selectRustCallableValueAdapter(integer, rustSourcePrimitiveTargetType("int64"), projectTypes, emptyRustTypeDefinitions);
  assert.equal(conversion.kind, "conversion");
  assert.equal(conversion.lowering.kind, "native");
  assert.equal(Object.isFrozen(conversion.lowering) && Object.isFrozen(conversion.lowering.contract), true, "native lowering is closed data");
  assert.equal(rustTargetTypeRefEquals(conversion.lowering.contract.source, integer), true, "the stored contract consumes the exact native input");
  assert.equal(conversion.fallible, conversion.lowering.contract.fallible, "fallibility is recorded by the same admission");
});

test("native parameter admission records rest extraction, collection and exact native read choices", () => {
  for (const sequence of [rustVecTargetType(integer), rustJsArrayTargetType(integer)]) {
    const source = [parameter(sequence, "rest")];
    const selected = selectRustCallableParameterAdapters(source,
      [parameter(integer), parameter(sequence, "rest")], projectTypes, emptyRustTypeDefinitions);
    assert.equal(Object.isFrozen(selected), true, "the admitted parameter vector is immutable");
    assert.equal(selected.length, 2);
    assert.equal(selected[0].kind, "rest-element");
    assert.equal(selected[0].offset, 0);
    assert.equal(selected[0].iteration.mutable, true);
    assert.equal(selected[0].iteration.cloneRequirement === undefined, true, "int32 has its native Copy/Clone contract");
    assert.equal(selected[1].kind, "rest");
    assert.equal(selected[1].segments.length, 1);
    assert.equal(selected[1].segments[0].kind, "sequence");
    assert.equal(selected[1].segments[0].offset, 1);
    assert.equal(selected[1].segments[0].iteration.mutable, true);
    assert.equal(selected[1].collection, selected[0].iteration.collection, "source and destination keep their actual native collections");
    assert.equal(selected.every(adapter => !adapter.fallible), true, "identity extraction adds no conversion failure");
  }
  const borrowed = { kind: "reference", referent: text, mutable: false };
  const selected = selectRustCallableParameterAdapters(
    [{ ...parameter(text, "required", "ref"), parameterCarrier: borrowed }],
    [parameter(rustOptionTargetType(text), "optional")], projectTypes, emptyRustTypeDefinitions);
  assert.equal(selected[0].kind, "logical-value");
  assert.equal(selected[0].read, "owned-string");
  assert.equal(selected[0].adapter.kind, "identity");
});

test("native parameter admission refuses malformed and incompatible inputs before publication", () => {
  const rest = parameter(rustVecTargetType(integer), "rest");
  const ordinary = parameter(integer);
  const invalid = [null, { ...ordinary, mode: "unknown" }, { ...ordinary, form: "unknown" },
    { ...ordinary, parameterCarrier: undefined }, { ...rest, mode: "ref" }, { ...rest, parameterCarrier: integer }];
  for (const candidate of invalid)
    assert.equal(selectRustCallableParameterAdapters([ordinary], [candidate], projectTypes, emptyRustTypeDefinitions) === undefined, true,
      "an invalid implementation parameter cannot enter the canonical adapter family");
  assert.equal(selectRustCallableParameterAdapters([rest, ordinary], [ordinary], projectTypes, emptyRustTypeDefinitions) === undefined, true,
    "a rest source must be the final native parameter");
  assert.equal(selectRustCallableParameterAdapters([], [ordinary], projectTypes, emptyRustTypeDefinitions) === undefined, true,
    "required native input cannot be manufactured");
  assert.equal(selectRustCallableParameterAdapters([ordinary], [parameter(text)], projectTypes, emptyRustTypeDefinitions) === undefined, true,
    "unrelated native inputs remain incompatible");
});

test("physical callable fields use one arity and uninhabited-error adapter into the fixed getter", () => {
  const lifetime = { kind: "parameter", identity: "physical-field", name: "field" };
  const infallible = { kind: "target-named", id: rustInfallibleTargetId };
  const error = { kind: "target-named", id: "test:ExactGetterError" };
  const source = rustCallablePhysicalCarrier(rustCallableTargetType([], integer, lifetime, infallible));
  const target = rustCallableTargetType([integer], integer, undefined, error);
  const adapter = selectRustCallableValueAdapter(source, target, projectTypes, emptyRustTypeDefinitions);
  assert.equal(adapter?.kind, "conversion", "one adapter selects arity and error transport together");
  assert.equal(adapter?.conversion.kind, "callable-adapter", "the canonical callable conversion owns the adaptation");
  assert.equal(rustTargetTypeRefEquals(adapter?.sourceCarrier, source), true, "the actual two-type-argument physical field is retained");
  assert.equal(rustTargetTypeRefEquals(adapter?.targetCarrier,
    rustCallableTargetType([integer], integer, lifetime, error)), true,
  "the getter retains the physical field lifetime and complete native contract");
  assert.equal(rustTargetTypeRefEquals(adapter?.targetCarrier,
    rustCallableTargetType([integer], integer, { ...lifetime, identity: "unrelated-field" }, error)), false,
  "a distinct lifetime identity is not made equal by the same native spelling");
  assert.equal(adapter?.conversion.parameters.length, 0, "the original zero-argument source ignores the getter argument");
  assert.equal(rustCallableConversionMatches(adapter?.conversion, source, adapter?.targetCarrier), true,
    "the selected conversion admits the exact physical source");
  const selected = rustCallableConversionPhysical(adapter?.conversion, rustCallablePhysicalSignature(source),
    "physical-field.ts", undefined, emptyRustTypeDefinitions, true);
  assert.equal(selected?.eliminatedInvokeError, true, "the uninhabited invocation error is eliminated natively");
  assert.equal(rustTargetTypeRefEquals(selected?.error, error), true, "the target carries only its exact fixed error");
  assert.equal(selected?.parameters.length, 1, "the getter keeps its full fixed parameter list");
  assert.equal(selected?.arguments.length, 0, "the physical source is still invoked without arguments");
  assert.equal(selected?.resultPlan.kind, "identity", "the native result is not boxed or converted");
  for (const changed of [
    rustCallablePhysicalCarrier(rustCallableTargetType([], integer, lifetime, { kind: "target-named", id: "test:OtherError" })),
    rustCallablePhysicalCarrier(rustCallableTargetType([integer, integer], integer, lifetime, infallible)),
    rustCallablePhysicalCarrier(rustCallableTargetType([], text, lifetime, infallible)),
  ]) assert.equal(selectRustCallableValueAdapter(changed, target, projectTypes, emptyRustTypeDefinitions) === undefined, true,
    "a real incompatible error, wider source arity or unrelated result is not silently repaired");
});
