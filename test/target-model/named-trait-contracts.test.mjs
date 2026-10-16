import assert from "node:assert/strict";
import test from "node:test";
import {
  isRustNamedTypeTraitContract, rustNamedTargetType, rustNamedTypeCarrierValue,
  rustNativeTraitRef, rustNativeTraitRefEquals,
} from "../../dist/target-model/types/carriers/native.js";
import { rustCarrierSatisfiesTraitRef, rustNamedTypeSupportsTrait } from "../../dist/target-model/types/carriers/traits.js";
import { rustRetainedErrorTargetType } from "../../dist/target-model/types/carriers/source-error.js";
import { substituteRustTargetGenerics } from "../../dist/target-model/types/carriers/substitution.js";
import { rustTargetGenericReferences } from "../../dist/target-model/types/carriers/generic-references.js";
import { materializeProviderCarrier } from "../../dist/providers/packages/materialization.js";
import { rustLifetimeKey } from "../../dist/target-model/lifetimes/index.js";
import { rustTargetTypeRefEquals } from "../../dist/target-model/types/equality.js";

const integer = { kind: "source-primitive", name: "int32" };
const typeArgument = type => ({ kind: "type", type });
const intoRetained = rustNativeTraitRef("core::convert::Into", [typeArgument(rustRetainedErrorTargetType())]);
const implementation = (trait, requirements = []) => ({ trait, requirements });
const carrier = (trait, arguments_ = [], requirements = []) => rustNamedTargetType(
  "foreign.Cause", "foreign::Cause", arguments_, [], { implementations: [implementation(trait, requirements)] },
);

test("native trait contracts require the existing complete DTO and reject removed path-only forms", () => {
  assert.equal(isRustNamedTypeTraitContract({ implementations: [implementation(intoRetained)] }), true);
  for (const candidate of [
    { implementations: [{ traitPath: "core::convert::Into", requirements: [] }] },
    { implementations: [{ trait: { ...intoRetained, genericArguments: undefined }, requirements: [] }] },
    { implementations: [implementation(intoRetained, [{ typeArgumentIndex: 0, traitPath: "core::clone::Clone" }])] },
    { implementations: [implementation(intoRetained), implementation(intoRetained)] },
  ]) assert.equal(isRustNamedTypeTraitContract(candidate), false);
});

test("any exact native trait evidence satisfies its instantiated obligation without an error-name whitelist", () => {
  const selected = carrier(intoRetained);
  assert.equal(rustCarrierSatisfiesTraitRef(selected, intoRetained), true);
  assert.equal(rustCarrierSatisfiesTraitRef(selected, { ...intoRetained, id: "another-source-provider::Into" }), true);
  for (const required of [
    rustNativeTraitRef("core::convert::Into"),
    rustNativeTraitRef("core::convert::Into", [typeArgument(integer)]),
    rustNativeTraitRef("core::convert::Into", [...intoRetained.genericArguments, typeArgument(integer)]),
    { ...intoRetained, path: "another::Into" },
    { ...intoRetained, associatedConstraints: [{ kind: "equality", identity: "Output", name: "Output",
      genericArguments: [], type: integer }] },
  ]) assert.equal(rustCarrierSatisfiesTraitRef(selected, required), false);
  assert.equal(rustNamedTypeSupportsTrait(rustNamedTypeCarrierValue(selected), "core::convert::Into"), false);
});

test("conditional native implementations preserve generic trait arguments rather than testing only the path", () => {
  const clone = rustNativeTraitRef("core::clone::Clone");
  const wrap = value => rustNamedTargetType("foreign.Wrapper", "foreign::Wrapper", [typeArgument(value)], [], {
    implementations: [implementation(clone, [{ typeArgumentIndex: 0, trait: intoRetained }])],
  });
  assert.equal(rustCarrierSatisfiesTraitRef(wrap(carrier(intoRetained)), clone), true);
  assert.equal(rustCarrierSatisfiesTraitRef(wrap(carrier(rustNativeTraitRef("core::convert::Into", [typeArgument(integer)]))), clone), false);
  const parameter = { kind: "type-parameter", identity: "checked:Error", name: "Error" };
  assert.equal(rustCarrierSatisfiesTraitRef(wrap(parameter), clone, () => true), false);
});

test("native trait substitution includes conditions, associated types, lifetimes and const arguments", () => {
  const parameter = { kind: "type-parameter", identity: "checked:Value", name: "Value" };
  const lifetime = { kind: "parameter", identity: "checked:region", name: "region" };
  const constant = { kind: "parameter", identity: "checked:Count", name: "Count" };
  const trait = { ...rustNativeTraitRef("foreign::Project", [typeArgument(parameter),
    { kind: "lifetime", lifetime }, { kind: "const", value: constant }]),
    associatedConstraints: [{ kind: "equality", identity: "checked:Output", name: "Output", genericArguments: [], type: parameter }] };
  const condition = { ...trait, path: "foreign::Required" };
  const original = carrier(trait, [typeArgument(parameter)], [{ typeArgumentIndex: 0, trait: condition }]);
  const concrete = substituteRustTargetGenerics(original, new Map([[parameter.identity, integer]]),
    new Map([[rustLifetimeKey(lifetime), { kind: "static" }]]), new Map([[constant.identity, { kind: "integer", value: "4" }]]));
  const selected = rustNamedTypeCarrierValue(concrete).traits.implementations[0];
  for (const value of [selected.trait, selected.requirements[0].trait]) {
    assert.deepEqual(value.genericArguments, [typeArgument(integer), { kind: "lifetime", lifetime: { kind: "static" } },
      { kind: "const", value: { kind: "integer", value: "4" } }]);
    assert.deepEqual(value.associatedConstraints[0].type, integer);
  }
  const references = rustTargetGenericReferences(original);
  assert.deepEqual(references.typeIdentities, [parameter.identity]);
  assert.deepEqual(references.lifetimeIdentities, [rustLifetimeKey(lifetime)]);
  assert.deepEqual(references.elisionInputs, []);
});

test("higher-ranked native trait evidence uses the existing alpha-equivalent binder equality", () => {
  const bound = identity => {
    const lifetime = { kind: "bound", binderIdentity: identity, identity: `${identity}:value`, name: "value" };
    return { ...rustNativeTraitRef("foreign::Lending", [{ kind: "lifetime", lifetime }]),
      lifetimeBinder: { identity, parameters: [{ lifetime, outlives: [] }] } };
  };
  assert.equal(rustNativeTraitRefEquals(bound("left"), bound("right")), true);
  assert.equal(rustCarrierSatisfiesTraitRef(carrier(bound("left")), bound("right")), true);
  assert.equal(rustCarrierSatisfiesTraitRef(carrier(bound("left")), rustNativeTraitRef("foreign::Lending")), false);
});

test("native trait equality ignores provider evidence but retains exact native arguments and constraints", () => {
  const lifetime = { kind: "parameter", identity: "checked:region", name: "region" };
  const leftRow = rustNamedTargetType("provider-one.Row", "common::Row", [typeArgument(integer)]);
  const rightRow = rustNamedTargetType("provider-two.Row", "common::Row", [typeArgument(integer)], [], {
    implementations: [implementation(rustNativeTraitRef("core::clone::Clone"))],
  });
  const trait = { ...rustNativeTraitRef("foreign::Project", [typeArgument(leftRow),
    { kind: "lifetime", lifetime }, { kind: "const", value: { kind: "integer", value: "4" } }]),
    associatedConstraints: [{ kind: "equality", identity: "provider-one.Output", name: "Output",
      genericArguments: [], type: leftRow }] };
  const other = { ...trait, id: "provider-two.Project", sourceItem: { fileName: "other.rs", typeName: "Project" },
    genericArguments: [typeArgument(rightRow), ...trait.genericArguments.slice(1)],
    associatedConstraints: [{ ...trait.associatedConstraints[0], identity: "provider-two.Output", type: rightRow }] };
  assert.equal(rustNativeTraitRefEquals(trait, other), true);
  assert.equal(rustTargetTypeRefEquals(trait, other), false);
  assert.equal(rustTargetTypeRefEquals(leftRow, rightRow), false);
  const replaceArgument = (index, argument) => ({ ...other,
    genericArguments: other.genericArguments.map((value, at) => at === index ? argument : value) });
  const controls = [
    { ...other, path: "another::Project" },
    replaceArgument(0, typeArgument(rustNamedTargetType("provider-one.Row", "another::Row", [typeArgument(integer)]))),
    replaceArgument(0, typeArgument(rustNamedTargetType("provider-one.Row", "common::Row", [typeArgument({ kind: "source-primitive", name: "number" })]))),
    { ...other, genericArguments: other.genericArguments.slice(1) },
    replaceArgument(1, { kind: "lifetime", lifetime: { kind: "static" } }),
    replaceArgument(1, { kind: "lifetime", lifetime: { ...lifetime, identity: "checked:other" } }),
    replaceArgument(2, { kind: "const", value: { kind: "integer", value: "5" } }),
    { ...other, associatedConstraints: [] },
    { ...other, associatedConstraints: [{ ...other.associatedConstraints[0], name: "Different" }] },
    { ...other, associatedConstraints: [{ ...other.associatedConstraints[0], type: integer }] },
    { ...other, associatedConstraints: [{ ...other.associatedConstraints[0],
      genericArguments: [{ kind: "lifetime", lifetime }] }] },
  ];
  controls.forEach((control, index) => assert.equal(rustNativeTraitRefEquals(trait, control), false, `native identity control ${index}`));
});

test("native trait equality preserves binder arity and outlives constraints", () => {
  const lifetime = { kind: "bound", binderIdentity: "binder", identity: "binder:value", name: "value" };
  const trait = { ...rustNativeTraitRef("foreign::Lending", [{ kind: "lifetime", lifetime }]),
    lifetimeBinder: { identity: "binder", parameters: [{ lifetime, outlives: [] }] } };
  assert.equal(rustNativeTraitRefEquals(trait, { ...trait, lifetimeBinder: undefined }), false);
  assert.equal(rustNativeTraitRefEquals(trait, { ...trait,
    lifetimeBinder: { ...trait.lifetimeBinder, parameters: [] } }), false);
  assert.equal(rustNativeTraitRefEquals(trait, { ...trait,
    lifetimeBinder: { ...trait.lifetimeBinder, parameters: [{ lifetime, outlives: [{ kind: "static" }] }] } }), false);
  const bounds = { ...trait, associatedConstraints: [{ kind: "bounds", identity: "Output", name: "Output",
    genericArguments: [], traits: [rustNativeTraitRef("core::clone::Clone")], outlives: [] }] };
  assert.equal(rustNativeTraitRefEquals(bounds, { ...bounds,
    associatedConstraints: [{ ...bounds.associatedConstraints[0], outlives: [{ kind: "static" }] }] }), false);
  assert.equal(rustNativeTraitRefEquals(bounds, { ...bounds,
    associatedConstraints: [{ ...bounds.associatedConstraints[0], traits: [] }] }), false);
});

test("provider trait aliases materialize exact arguments and self references without recursively adding their contracts", () => {
  const self = { kind: "target-named", id: "foreign.Cause" };
  const trait = rustNativeTraitRef("old::Project", [typeArgument(self)]);
  const contract = { implementations: [implementation(trait)] };
  const selected = materializeProviderCarrier(self, { "foreign.Cause": "foreign_alias::Cause",
    "old::Project": "foreign_alias::Project" }, { "foreign.Cause": contract });
  const native = rustNamedTypeCarrierValue(selected);
  assert.equal(native.path, "foreign_alias::Cause");
  const actual = native.traits.implementations[0].trait;
  assert.equal(actual.path, "foreign_alias::Project");
  const argument = rustNamedTypeCarrierValue(actual.genericArguments[0].type);
  assert.equal(argument.path, "foreign_alias::Cause");
  assert.deepEqual(argument.traits.implementations, []);
  assert.equal(rustCarrierSatisfiesTraitRef(selected, { ...actual, genericArguments: [typeArgument(selected)] }), true);
});
