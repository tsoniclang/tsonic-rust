import assert from "node:assert/strict";
import test from "node:test";
import { rustCheckedCallRequestsEqual, rustCheckedElementRequestsEqual, rustCheckedPropertyRequestsEqual } from "../../../dist/analysis/operations/call-request-correspondence.js";

const reference = () => Object.freeze(Object.create(null));
const sourceValue = () => Object.fromEntries(["expression", "type", "symbol", "declaration", "selectedSymbol",
  "selectedDeclaration", "authoredTypeNode"].map(name => [name, reference()]));
const value = sourceValue();
const call = { target: "rust", sourceSelectedDeclaration: reference(), source: {
  outcome: "applicable", call: reference(), optionalChain: false, selectedSignature: reference(),
  sourceSelectedSignatureKind: "resolved", sourceResultType: reference(), sourceCallee: value,
  sourceReceiver: sourceValue(), sourceArguments: [sourceValue(), sourceValue()],
  sourceArgumentBindings: [{ sourceArgumentIndex: 0, effectiveArgumentIndex: 0, sourceForm: "spread-element",
    spreadElementIndex: 0, sourceParameterIndex: 0, sourceParameterForm: "parameter",
    selectedArgumentType: reference(), selectedParameterType: reference() }],
  sourceSelectedSignatureParameters: [{ parameterIndex: 0, parameterName: "value", parameterSymbol: reference(),
    parameterDeclaration: reference(), selectedType: reference(), authoredTypeNode: reference(), acceptsOmission: false, rest: false }],
  sourceSelectedMethodTypeArguments: [{ typeParameterName: "Value", typeParameter: reference(), selectedType: reference(), explicitTypeNode: reference() }],
  sourceCalleeAccess: { kind: "element", expression: reference(), receiver: sourceValue(), argument: sourceValue(),
    resultType: reference(), symbol: reference(), declaration: reference(), selectedSymbol: reference(),
    selectedDeclaration: reference(), selectedElementIndex: 0 },
} };

function changed(value) {
  if (typeof value === "boolean") return !value;
  if (typeof value === "number") return value + 1;
  if (typeof value === "string") return `${value}-different`;
  return reference();
}

test("checked-call correspondence retains every opaque identity and ordered evidence dimension", () => {
  assert.equal(rustCheckedCallRequestsEqual(call, { ...call, target: undefined, source: { ...call.source } }), true);
  const mutations = [{ ...call, sourceSelectedDeclaration: reference() }];
  for (const name of ["outcome", "call", "optionalChain", "selectedSignature", "sourceSelectedSignatureKind", "sourceResultType"]) {
    mutations.push({ ...call, source: { ...call.source, [name]: changed(call.source[name]) } });
  }
  for (const name of ["sourceCallee", "sourceReceiver"]) {
    for (const field of Object.keys(call.source[name])) mutations.push({ ...call,
      source: { ...call.source, [name]: { ...call.source[name], [field]: reference() } } });
  }
  for (const field of Object.keys(value)) mutations.push({ ...call, source: { ...call.source,
    sourceArguments: [{ ...call.source.sourceArguments[0], [field]: reference() }, call.source.sourceArguments[1]] } });
  for (const sourceArguments of [[], [...call.source.sourceArguments].reverse(), [call.source.sourceArguments[0]]]) {
    mutations.push({ ...call, source: { ...call.source, sourceArguments } });
  }
  for (const name of ["sourceArgumentBindings", "sourceSelectedSignatureParameters", "sourceSelectedMethodTypeArguments"]) {
    const row = call.source[name][0];
    mutations.push({ ...call, source: { ...call.source, [name]: [] } });
    for (const field of Object.keys(row)) mutations.push({ ...call,
      source: { ...call.source, [name]: [{ ...row, [field]: changed(row[field]) }] } });
  }
  const access = call.source.sourceCalleeAccess;
  for (const field of ["kind", "expression", "resultType", "symbol", "declaration", "selectedSymbol", "selectedDeclaration", "selectedElementIndex"]) {
    mutations.push({ ...call, source: { ...call.source, sourceCalleeAccess: { ...access, [field]: changed(access[field]) } } });
  }
  for (const name of ["receiver", "argument"]) for (const field of Object.keys(value)) mutations.push({ ...call,
    source: { ...call.source, sourceCalleeAccess: { ...access, [name]: { ...access[name], [field]: reference() } } } });
  mutations.push({ ...call, source: { ...call.source, sourceCalleeAccess: undefined } });
  for (const [index, mutation] of mutations.entries()) {
    assert.equal(rustCheckedCallRequestsEqual(call, mutation), false, `changed call dimension ${index}`);
    assert.equal(rustCheckedCallRequestsEqual(mutation, call), false, `reverse call dimension ${index}`);
  }
});

test("property and element correspondence retains every selected read, write and native-index input", () => {
  const property = { target: "rust", optionalChain: false, expression: reference(), receiver: reference(),
    sourceReceiverType: reference(), sourceReceiverDeclaration: reference(), sourceReceiverValueDeclaration: reference(),
    sourceReceiverIntrinsic: "global-object", accessMode: "read-write", sourceSelectedSymbol: reference(),
    sourceSelectedDeclaration: reference(), sourceSelectedReadDeclaration: reference(), sourceSelectedWriteDeclaration: reference(),
    sourceSelectedIndex: reference(), sourceReadType: reference(), sourceWriteType: reference(), sourceResultType: reference() };
  assert.equal(rustCheckedPropertyRequestsEqual(property, { ...property, target: undefined, optionalChain: undefined }), true);
  for (const field of Object.keys(property).filter(field => field !== "target")) {
    assert.equal(rustCheckedPropertyRequestsEqual(property, { ...property, [field]: changed(property[field]) }), false, field);
  }
  const element = { ...property, argument: reference(), sourceArgumentType: reference(), sourceSelectedElementIndex: 0 };
  assert.equal(rustCheckedElementRequestsEqual(element, { ...element }), true);
  for (const field of Object.keys(element).filter(field => field !== "target")) {
    assert.equal(rustCheckedElementRequestsEqual(element, { ...element, [field]: changed(element[field]) }), false, field);
  }
});
