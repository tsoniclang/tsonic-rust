import assert from "node:assert/strict";
import test from "node:test";
import { rustCarrierSatisfiesTraitRef } from "../../dist/target-model/types/carriers/traits.js";
import { rustNamedTargetType, rustStringTargetType, rustStrTargetType } from "../../dist/target-model/types/carriers/native.js";
import { instantiateProviderOperationTemplate } from "../../dist/analysis/operations/provider/calls/template-instantiation.js";

const bytes = { kind: "slice", element: { kind: "source-primitive", name: "uint8" } };
const path = rustNamedTargetType("compiler.path", "std::path::Path");
const asRef = (target) => ({ kind: "trait", path: "core::convert::AsRef", genericArguments: [{ kind: "type", type: target }], associatedConstraints: [] });

test("native strings satisfy exact AsRef contracts, including reference forwarding", () => {
  for (const source of [rustStringTargetType(), rustStrTargetType()]) {
    for (const target of [bytes, path, rustStrTargetType(), rustNamedTargetType("compiler.osstr", "std::ffi::OsStr")]) {
      for (const carrier of [source, { kind: "reference", referent: source, mutable: false }, { kind: "reference", referent: source, mutable: true }]) {
        assert.equal(rustCarrierSatisfiesTraitRef(carrier, asRef(target)), true);
      }
    }
  }
});

test("AsRef rejects wrong elements, lookalike types and malformed trait arguments", () => {
  const source = rustStringTargetType();
  for (const target of [rustStringTargetType(), rustNamedTargetType("acme.Path", "acme::Path"), { kind: "slice", element: { kind: "source-primitive", name: "int8" } }, { ...path, value: { ...path.value, genericArguments: [{ kind: "type", type: source }] } }]) {
    assert.equal(rustCarrierSatisfiesTraitRef(source, asRef(target)), false);
  }
  for (const carrier of [{ kind: "source-primitive", name: "uint8" }, { kind: "target-named", id: "acme.String" }, { ...source, genericArguments: [{ kind: "type", type: source }] }]) {
    assert.equal(rustCarrierSatisfiesTraitRef(carrier, asRef(path)), false);
  }
  for (const trait of [{ ...asRef(path), path: "acme::AsRef" }, { ...asRef(path), genericArguments: [] }, { ...asRef(path), genericArguments: [...asRef(path).genericArguments, ...asRef(path).genericArguments] }, { ...asRef(path), associatedConstraints: [{ kind: "equality", name: "Output", genericArguments: [], type: source }] }]) {
    assert.equal(rustCarrierSatisfiesTraitRef(source, trait), false);
  }
});

test("generic invocation defers unproved AsRef obligations without creating ownership evidence", () => {
  const template = {
    kind: "provider-operation", operationId: "acme.accept",
    operationKind: "method", target: { form: "call", path: "acme::accept" },
    resultCarrier: { kind: "tuple", elements: [] },
    parameterCarriers: [{ kind: "type-parameter", name: "P" }],
    genericParameters: [{ kind: "type", sourceName: "P" }],
    typeRequirements: [{ name: "P", requirements: [asRef(path)] }],
    isAsync: false, isFallible: false, errorBoundary: "none",
  };
  assert.ok(instantiateProviderOperationTemplate(template, { sourceParameterCarriers: [rustStringTargetType()] }));
  const integer = { kind: "source-primitive", name: "int32" };
  const selected = instantiateProviderOperationTemplate(template, { sourceParameterCarriers: [integer] });
  assert.deepEqual(selected.template.parameterCarriers, [integer]);
  assert.deepEqual(selected.substitutions.types.get("P"), integer);
  assert.equal(rustCarrierSatisfiesTraitRef(integer, asRef(path)), false);
  assert.equal(instantiateProviderOperationTemplate(template, { sourceParameterCarriers: [] }), undefined);
});
