import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RustSemanticModel,
  rustConversionKey,
  rustRuntimeCarrierKey,
  rustSelectedCallKey,
  rustSelectedOperationKey,
} from "../dist/policy/model.js";
import {
  rustFinalizedCarrierTransitionMatches,
  rustTargetOperationIsDirectLocation,
  rustTargetOperationSupportsAssignment,
  rustTargetOperationText,
} from "../dist/source/rust-facts/target-operation.js";

function createModel() {
  return new RustSemanticModel({ getFact: () => undefined });
}

test("closed Rust carrier and conversion facts are allocation-independent", () => {
  const model = createModel();
  const subject = {};
  const firstCarrier = { kind: "target-named", id: "rust.std.Vec", typeArguments: [{ kind: "source-primitive", name: "int32" }] };
  const equivalentCarrier = { kind: "target-named", id: "rust.std.Vec", typeArguments: [{ kind: "source-primitive", name: "int32" }] };

  model.set(subject, rustRuntimeCarrierKey, { carrier: firstCarrier });
  assert.doesNotThrow(() => model.set(subject, rustRuntimeCarrierKey, { carrier: equivalentCarrier }));
  assert.equal(model.getRuntimeCarrierFact(subject)?.carrier, firstCarrier);
  assert.throws(
    () => model.set(subject, rustRuntimeCarrierKey, { carrier: { kind: "source-primitive", name: "uint8" } }),
    /Conflicting Rust semantic plan/u,
  );

  const conversionSubject = {};
  model.set(conversionSubject, rustConversionKey, { convertedType: firstCarrier });
  assert.doesNotThrow(() => model.set(conversionSubject, rustConversionKey, { convertedType: equivalentCarrier }));
});

test("selected operations compare target data structurally and source provenance exactly", () => {
  const model = createModel();
  const subject = {};
  const sourceExpression = {};
  const first = {
    operationId: "tsonic.rust.operator.concat.string",
    operationKind: "operator",
    targetOperation: "+",
    resultType: { kind: "target-named", id: "rust.std.String" },
    provenance: { sourceExpression },
  };
  const equivalent = {
    operationId: "tsonic.rust.operator.concat.string",
    operationKind: "operator",
    targetOperation: "+",
    resultType: { kind: "target-named", id: "rust.std.String" },
    provenance: { sourceExpression },
  };

  model.set(subject, rustSelectedOperationKey, first);
  assert.doesNotThrow(() => model.set(subject, rustSelectedOperationKey, equivalent));
  assert.throws(
    () => model.set(subject, rustSelectedOperationKey, { ...equivalent, provenance: { sourceExpression: {} } }),
    /Conflicting Rust semantic plan/u,
  );
});

test("selected calls preserve exact checker evidence while accepting equivalent target members", () => {
  const model = createModel();
  const subject = {};
  const sourceSignature = {};
  const selectedType = {};
  const member = {
    id: "acme.run",
    sourceName: "run",
    targetName: "acme::run",
    kind: "method",
    parameters: [{ name: "value", type: { kind: "source-primitive", name: "int32" }, passingMode: "value" }],
    returnType: { kind: "source-primitive", name: "int32" },
  };
  const first = {
    member,
    sourceSignature,
    sourceArgumentBindings: [{
      sourceArgumentIndex: 0,
      effectiveArgumentIndex: 0,
      sourceForm: "value",
      sourceParameterIndex: 0,
      sourceParameterForm: "parameter",
      selectedArgumentType: selectedType,
      selectedParameterType: selectedType,
    }],
  };
  const equivalent = {
    ...first,
    member: {
      ...member,
      parameters: [{ name: "value", type: { kind: "source-primitive", name: "int32" }, passingMode: "value" }],
      returnType: { kind: "source-primitive", name: "int32" },
    },
    sourceArgumentBindings: [{ ...first.sourceArgumentBindings[0] }],
  };

  model.set(subject, rustSelectedCallKey, first);
  assert.doesNotThrow(() => model.set(subject, rustSelectedCallKey, equivalent));
  assert.throws(
    () => model.set(subject, rustSelectedCallKey, {
      ...equivalent,
      sourceArgumentBindings: [{ ...equivalent.sourceArgumentBindings[0], selectedArgumentType: {} }],
    }),
    /Conflicting Rust semantic plan/u,
  );
});

test("one canonical operation projection serves selection and backend validation", () => {
  assert.equal(rustTargetOperationText({
    kind: "string-concat",
    operationId: "tsonic.rust.operator.concat.string",
    resultCarrier: { kind: "target-named", id: "rust.std.String" },
  }), "+");
  assert.equal(rustTargetOperationText({
    kind: "source-conversion",
    operationId: "tsonic.rust.conversion.identity",
    resultCarrier: { kind: "source-primitive", name: "int32" },
  }), "identity");
});

test("assignment support distinguishes direct Rust places from reference-backed project fields", () => {
  const projectField = {
    kind: "source-field",
    operationId: "source-field",
    storageIndex: 0,
    resultCarrier: { kind: "source-primitive", name: "int32" },
  };
  const providerField = {
    kind: "provider-operation",
    abi: { target: { form: "field", name: "value" } },
  };
  const providerMethod = {
    kind: "provider-operation",
    abi: { target: { form: "receiver-method", name: "value" } },
  };
  assert.equal(rustTargetOperationIsDirectLocation(projectField), false);
  assert.equal(rustTargetOperationSupportsAssignment(projectField), true);
  assert.equal(rustTargetOperationIsDirectLocation(providerField), true);
  assert.equal(rustTargetOperationSupportsAssignment(providerField), true);
  assert.equal(rustTargetOperationIsDirectLocation(providerMethod), false);
  assert.equal(rustTargetOperationSupportsAssignment(providerMethod), false);
  assert.equal(rustTargetOperationIsDirectLocation(undefined), false);
  assert.equal(rustTargetOperationSupportsAssignment(undefined), false);
});

test("finalized carrier transitions require one exact conversion lane", () => {
  const int32 = { kind: "source-primitive", name: "int32" };
  const equivalentInt32 = { kind: "source-primitive", name: "int32" };
  const uint8 = { kind: "source-primitive", name: "uint8" };

  assert.equal(rustFinalizedCarrierTransitionMatches(int32, undefined, equivalentInt32), true);
  assert.equal(rustFinalizedCarrierTransitionMatches(int32, int32, equivalentInt32), false);
  assert.equal(rustFinalizedCarrierTransitionMatches(int32, uint8, uint8), true);
  assert.equal(rustFinalizedCarrierTransitionMatches(int32, undefined, uint8), false);
  assert.equal(rustFinalizedCarrierTransitionMatches(int32, equivalentInt32, uint8), false);
});
