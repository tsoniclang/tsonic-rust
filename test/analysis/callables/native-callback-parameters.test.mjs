import assert from "node:assert/strict";
import test from "node:test";
import { selectRustNativeCallbackParameterStorage } from "../../../dist/analysis/callables/native/native-parameters.js";
import { jsOperationRows } from "../../../dist/policy/operations/source-profiles/js/rows.js";
import { rustCallablePhysicalCarrier } from "../../../dist/policy/conversions/callable-physical.js";
import { rustCallablePhysicalSignature } from "../../../dist/target-model/conversions/callable-physical.js";
import { rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { rustJsMapTargetType, rustJsSetTargetType, rustJsValueTargetType, rustUnitTargetType } from "../../../dist/target-model/types/index.js";
import { rustInfallibleTargetId } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";

const logical = rustCallableTargetType([], rustUnitTargetType());
const lifetime = { kind: "parameter", identity: "native:caller", name: "caller" };
const keyCarrier = rustCallablePhysicalCarrier(rustCallableTargetType([], rustUnitTargetType(), lifetime,
  { kind: "target-named", id: rustInfallibleTargetId }));
const valueCarrier = rustCallablePhysicalCarrier(rustCallableTargetType([], rustUnitTargetType(), lifetime, rustJsValueTargetType()));

function callback(owner, arity) {
  const selected = jsOperationRows.find(row => row.owner === owner && row.member === "forEach" &&
    row.shape.params?.[0]?.arity === arity);
  assert.equal(selected?.callback !== undefined, true, `${owner}/${arity}: one selected native callback row exists`);
  return selected.callback;
}

function fixture(options = {}) {
  const owner = {};
  const parameter = {};
  const extraParameter = {};
  const receiver = {};
  const invocation = {};
  const signature = {};
  const parameterSymbol = {};
  const extraSymbol = {};
  const bindings = {};
  const callerBindings = {};
  const subject = { kind: "input", node: parameter, projection: [] };
  const root = { kind: "value", node: receiver, projection: [] };
  const selectedCallback = options.callback ?? callback("Map", 2);
  const parameterIndex = options.parameterIndex ?? 0;
  const semantics = { declarations: {
    declarationSignature: node => node === owner ? signature : undefined,
    signatureParameters: selected => selected === signature ? [parameterSymbol, extraSymbol] : [],
    primarySymbolDeclaration: selected => selected === (parameterIndex === 0 ? parameterSymbol : extraSymbol)
      ? parameter : extraParameter,
  } };
  const logicalReceiver = options.logicalReceiver ?? rustJsMapTargetType(logical, logical);
  const physicalReceiver = options.physicalReceiver ?? rustJsMapTargetType(keyCarrier, valueCarrier);
  const nativeInput = {};
  const provenance = {};
  const physical = options.physical ?? { kind: "selected", carrier: physicalReceiver,
    inputs: [nativeInput], sources: [provenance] };
  const activation = { kind: "declaration", declaration: owner, bindings,
    nativeEntry: { invocation, argument: { binding: { sourceArgumentIndex: options.sourceArgumentIndex ?? 0 } }, callerBindings } };
  const storage = {
    source: { semantics: { forNode: () => semantics } }, failureReason: () => undefined,
    boundActivationsFor: (declaration, current) => {
      assert.equal(declaration === owner && current === bindings, true, "the formal uses its exact active declaration tuple");
      return { kind: "resolved", activations: options.unmappedActivation === true
        ? [activation, { kind: "declaration", declaration: owner, bindings }] : [activation] };
    },
    subjectFor: node => {
      assert.equal(node === receiver, true, "the selected native receiver is the original source expression");
      return { kind: "resolved", subject: root };
    },
  };
  const absent = Object.freeze({ get: () => undefined });
  const records = Object.fromEntries(["optionProjection", "contextualValueConversion", "indexedFieldKeyArgument",
    "objectReferenceView", "callScopedLifetimeReconciliation", "projectUpcast", "conversion", "flowReadProjection"]
    .map(name => [name, absent]));
  records.runtimeCarrier = { get: node => node === receiver ? { carrier: logicalReceiver } : undefined };
  records.sourceParameterAbi = { get: node => node === parameter ? { valueCarrier: options.parameterCarrier ?? logical } : undefined };
  records.targetOperation = { get: node => node === invocation ? { kind: "provider-operation", abi: {
    sourceReceiver: { kind: "receiver", carrier: logicalReceiver, disposition: "runtime" }, sourceArguments: [],
  } } : undefined };
  const input = {
    ast: { is: { IsParameterDeclaration: node => node === parameter || node === extraParameter }, parent: () => owner },
    storage, records, carrierHost: { sourceStorage: storage }, definitions: emptyRustTypeDefinitions,
    operationAttempts: { get: node => node === invocation ? { kind: "checked-call", request: { source: {
      sourceReceiver: { expression: receiver }, sourceArguments: [],
    } }, prepared: { value: { callback: selectedCallback } } } : undefined },
  };
  const result = selectRustNativeCallbackParameterStorage(input, subject, bindings, (selected, carrier, context) => {
    assert.equal(selected === root && carrier === logicalReceiver && context === callerBindings, true,
      "physical input selection preserves the whole caller activation instead of using the callback's bindings");
    return physical;
  });
  return { result, physical, nativeInput, provenance };
}

test("Map and Set callback rows declare every native value, key and receiver position", () => {
  for (const owner of ["Map", "ReadonlyMap", "Set", "ReadonlySet"]) {
    for (const arity of [0, 1, 2, 3]) {
      const sources = callback(owner, arity).parameterSources;
      assert.equal(sources?.length, arity, `${owner}/${arity}: all native callback positions are declared`);
      for (let index = 0; index < arity; index++) {
        const expected = index === 2 ? [] : owner === "Map" || owner === "ReadonlyMap" ? [1 - index] : [0];
        assert.equal(sources[index].kind, "receiver", `${owner}/${arity}/${index}: the native receiver owns the input`);
        assert.equal(sources[index].projection.length === expected.length &&
          sources[index].projection.every((component, componentIndex) => component === expected[componentIndex]), true,
        `${owner}/${arity}/${index}: values and keys retain their different selected components`);
      }
    }
  }
});

test("native callback parameters preserve physical errors, lifetimes and provenance through exact components", () => {
  for (const [parameterIndex, expected] of [[0, valueCarrier], [1, keyCarrier]]) {
    const selected = fixture({ parameterIndex });
    assert.equal(selected.result?.kind, "selected", "a complete native source component is selected");
    assert.equal(selected.result.carrier === expected, true, "equal logical key/value signatures do not erase their distinct native errors");
    assert.equal(selected.result.erased, true, "the actual native runtime Callable remains explicitly erased");
    assert.equal(selected.result.inputs[0] === selected.nativeInput && selected.result.sources[0] === selected.provenance, true,
      "native input obligations and original source provenance remain attached");
    assert.equal(rustTargetTypeRefEquals(rustCallablePhysicalSignature(selected.result.carrier).error,
      parameterIndex === 0 ? rustJsValueTargetType() : { kind: "target-named", id: rustInfallibleTargetId }), true,
    "JsValue and Infallible stay their actual native channels, never local ProgramError");
  }
  for (const parameterIndex of [0, 1]) {
    const selected = fixture({ callback: callback("Set", 2), parameterIndex,
      logicalReceiver: rustJsSetTargetType(logical), physicalReceiver: rustJsSetTargetType(valueCarrier) });
    assert.equal(selected.result?.kind === "selected" && selected.result.carrier === valueCarrier, true,
      "both native Set value positions use the same actual component");
  }
});

test("native callback parameters refuse missing physical storage and mismatched logical correspondence", () => {
  const unavailable = { kind: "unresolved", reason: "the actual receiver physical input is not prepared" };
  assert.equal(fixture({ physical: unavailable }).result === unavailable, true,
    "an unprepared physical channel never becomes local, static or infallible");
  for (const options of [{ parameterCarrier: rustUnitTargetType() }, { sourceArgumentIndex: 1 }, { unmappedActivation: true },
    { callback: { ...callback("Map", 2), parameterSources: [{ kind: "receiver", projection: [2] }] } }]) {
    assert.equal(fixture(options).result?.kind, "unresolved", "every invalid native correspondence is rejected at its owner");
  }
});
