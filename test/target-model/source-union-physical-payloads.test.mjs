import assert from "node:assert/strict";
import test from "node:test";
import { createRustTypeDefinitionRegistry } from "../../dist/analysis/project-types/type-definitions.js";
import { createRustSourceTypeRegistry } from "../../dist/analysis/project-types/source-type-registry.js";
import { rustSourceUnionCarrierValue, rustSourceUnionTargetType } from "../../dist/target-model/types/carriers/source-types.js";
import { rustFutureTargetType } from "../../dist/target-model/types/carriers/primitives.js";
import { rustUnitTargetType, rustNamedTargetType } from "../../dist/target-model/types/carriers/native.js";
import { rustTargetTypeRefEquals } from "../../dist/target-model/types/equality.js";
import { rustTargetTypeChildren } from "../../dist/target-model/types/carriers/children.js";
import { rustTargetGenericReferences } from "../../dist/target-model/types/carriers/generic-references.js";
import { substituteRustTargetTypeParameters, mapRustTargetTypes } from "../../dist/target-model/types/carriers/substitution.js";
import { inferRustTargetTypeParameterBindings } from "../../dist/target-model/types/carriers/generic-inference.js";
import { instantiateRustSourceUnionPayloads, rustSourceUnionPayloadArguments } from "../../dist/target-model/types/source-union-definitions.js";
import { rustCarrierSupportsClone } from "../../dist/target-model/types/carriers/traits.js";
import { rustAwaitSelection, rustAwaitSelectionLeaves } from "../../dist/target-model/types/await.js";
import { planRustSourceUnionPayloadTemplate } from "../../dist/backend/planner/types/source-union-payloads.js";
import { rustTypeFromCarrier } from "../../dist/backend/planner/types/render.js";

const integer = { kind: "source-primitive", name: "int32" };
const text = { kind: "target-named", id: "rust.std.String" };
const unit = rustUnitTargetType();
const future = rustFutureTargetType(unit);
const parameter = { kind: "type-parameter", identity: "source:Value", name: "Value" };
const argument = type => ({ kind: "type", type });
const alias = (name = "MixedCompletion", arguments_ = []) => rustSourceUnionTargetType("/src/completion.ts", name, arguments_);
const definition = (carrier, types) => ({ carrier, variants: types.map((type, index) => ({ name: `Variant${index}`, carrier: type })) });
const equals = (actual, expected, label) => assert.equal(rustTargetTypeRefEquals(actual, expected), true, label);
const ready = error => rustNamedTargetType("native.Ready", "core::future::Ready", [argument(
  rustNamedTargetType("native.Result", "Result", [argument(unit), argument(error)], [], undefined, [], undefined, []),
)], [], undefined, [], undefined, []);

test("authored union payload instantiation reaches definition-owned futures without changing source identity", () => {
  const registry = createRustTypeDefinitionRegistry();
  const carrier = alias();
  assert.equal(registry.registerSourceUnion(definition(carrier, [integer, future]), true), true);
  const definitions = registry.seal();
  const selected = rustAwaitSelection(carrier, definitions);
  assert.equal(selected?.kind, "union");
  assert.equal(rustAwaitSelectionLeaves(selected).filter(leaf => leaf.future !== undefined).length, 1);
  equals(mapRustTargetTypes(carrier, type => type === future ? ready(integer) : type), carrier, "carrier-only walk cannot see authored payload");
  const physical = instantiateRustSourceUnionPayloads(carrier, [integer, ready(integer)], definitions);
  assert.equal(physical !== undefined, true);
  assert.equal(rustSourceUnionCarrierValue(physical).payloads.kind, "physical");
  assert.equal(rustSourceUnionCarrierValue(physical).genericArguments.length, 0);
  equals(definitions.sourceUnionVariants(physical)[1].carrier, ready(integer), "exact physical future");
  equals(definitions.sourceUnionVariants(carrier)[1].carrier, future, "source declaration stays immutable");
  const second = instantiateRustSourceUnionPayloads(carrier, [integer, ready(text)], definitions);
  assert.equal(definitions.sourceUnionPayloadTemplate(physical) === definitions.sourceUnionPayloadTemplate(second), true);
  assert.equal(rustSourceUnionPayloadArguments(physical, definitions).length, 2);
  assert.equal(Object.isFrozen(physical.value.payloads.types), true);
  assert.equal(Object.isFrozen(definitions.sourceUnionPayloadTemplate(physical).variants), true);
  assert.equal(rustCarrierSupportsClone(physical, definitions), false, "physical Future does not acquire Clone");
});

test("source generic arguments and physical payload arguments retain independent identities and substitution", () => {
  const registry = createRustTypeDefinitionRegistry();
  const carrier = alias("GenericCompletion", [argument(parameter)]);
  assert.equal(registry.registerSourceUnion(definition(carrier, [parameter, future]), true), true);
  const lifetime = { kind: "parameter", identity: "call:input", name: "input" };
  const borrowed = { kind: "reference", mutable: true, referent: parameter, lifetime };
  const payload = ready(borrowed);
  const physical = instantiateRustSourceUnionPayloads(carrier, [parameter, payload], registry);
  assert.equal(physical !== undefined, true);
  assert.equal(rustSourceUnionCarrierValue(physical).genericArguments.length, 1);
  assert.equal(rustSourceUnionCarrierValue(physical).payloads.types.length, 2);
  const references = rustTargetGenericReferences(physical);
  assert.equal(references.typeIdentities.includes(parameter.identity), true);
  assert.equal(references.lifetimes.some(selected => selected.identity === lifetime.identity), true);
  assert.equal(rustTargetTypeChildren(physical).some(type => rustTargetTypeRefEquals(type, payload)), true);
  const instantiated = substituteRustTargetTypeParameters(physical, new Map([[parameter.identity, integer]]));
  equals(instantiated.value.genericArguments[0].type, integer, "source binding");
  equals(registry.sourceUnionVariants(instantiated)[1].carrier,
    ready({ ...borrowed, referent: integer }), "physical binding");
  assert.equal(inferRustTargetTypeParameterBindings(physical, instantiated, new Set([parameter.identity]))?.has(parameter.identity), true);
  assert.equal(inferRustTargetTypeParameterBindings(carrier, instantiated, new Set([parameter.identity])) === undefined, true,
    "logical source carrier does not silently accept unrelated physical shape");
});

test("physical union applications reject unknown owners, arity, malformed selections and stale carrier shape", () => {
  const registry = createRustTypeDefinitionRegistry();
  const carrier = alias();
  assert.equal(registry.registerSourceUnion(definition(carrier, [integer, future]), true), true);
  const sparse = new Array(2);
  sparse[1] = ready(integer);
  for (const [label, value, types] of [
    ["unknown owner", alias("Other"), [integer, ready(integer)]],
    ["other file", rustSourceUnionTargetType("/other.ts", "MixedCompletion"), [integer, ready(integer)]],
    ["source arity", alias("MixedCompletion", [argument(integer)]), [integer, ready(integer)]],
    ["short physical arity", carrier, [integer]],
    ["long physical arity", carrier, [integer, future, text]],
    ["invalid type", carrier, [integer, {}]],
    ["sparse arguments", carrier, sparse],
  ]) assert.equal(instantiateRustSourceUnionPayloads(value, types, registry) === undefined, true, label);
  const { payloads: _payloads, ...stale } = carrier.value;
  for (const payloads of [undefined, null, {}, { kind: "physical", types: [] },
    { kind: "physical", types: [integer, undefined] }, { kind: "source", types: [] },
    { kind: "physical", types: [integer, future], unexpected: true }]) {
    assert.equal(rustSourceUnionCarrierValue({ ...carrier, value: { ...stale, payloads } }) === undefined, true);
  }
  assert.equal(rustSourceUnionCarrierValue({ ...carrier, value: stale }) === undefined, true);
  const physical = instantiateRustSourceUnionPayloads(carrier, [integer, ready(integer)], registry);
  assert.equal(registry.registerSourceUnion(definition(physical, [integer, ready(integer)]), false), false,
    "physical application cannot replace checked source declaration");
  for (const types of [[integer], [integer, future, text]]) {
    const forged = rustSourceUnionTargetType("/src/completion.ts", "MixedCompletion", [], "authored", { kind: "physical", types });
    assert.equal(registry.sourceUnionVariants(forged) === undefined, true, "owner rejects forged native arity");
    assert.equal(rustSourceUnionPayloadArguments(forged, registry) === undefined, true, "renderer rejects forged native arity");
  }
});

test("recursive authored payload edges remain nominal, finite and fixed across physical applications", () => {
  const registry = createRustTypeDefinitionRegistry();
  const tree = alias("Tree", [argument(parameter)]);
  const children = { kind: "array", element: tree };
  assert.equal(registry.registerSourceUnion(definition(tree, [parameter, children]), true), true);
  const template = registry.sourceUnionPayloadTemplate(tree);
  assert.equal(template !== undefined, true);
  assert.deepEqual(template.sourceArgumentIndexes, [0]);
  assert.deepEqual(template.payloadParameters.map(selected => selected.variantIndex), [0]);
  equals(template.variants[1].carrier, children, "recursive arm is not expanded into a generic payload");
  assert.equal(instantiateRustSourceUnionPayloads(tree, [integer, { kind: "array", element: text }], registry) === undefined, true);
  const applied = instantiateRustSourceUnionPayloads(tree, [integer, children], registry);
  assert.equal(applied !== undefined, true);
  assert.equal(rustSourceUnionPayloadArguments(applied, registry).length, 2);
  const concrete = substituteRustTargetTypeParameters(tree, new Map([[parameter.identity, integer]]));
  equals(registry.sourceUnionVariants(concrete)[1].carrier, { kind: "array", element: concrete }, "source recursive generic identity");
  registry.seal();
});

test("source registry exposes the same canonical template and keeps payload binder names hygienic", () => {
  const registry = createRustSourceTypeRegistry();
  const colliding = { ...parameter, name: "Payload0" };
  const carrier = alias("Collision", [argument(colliding)]);
  const declared = definition(carrier, [colliding, future]);
  assert.equal(registry.registerSourceUnion({ ...declared, declaration: {}, sourceType: {}, selectedProperties: [],
    variants: declared.variants.map(variant => ({ ...variant, sourceTypes: [{}] })) }), true);
  const template = registry.sourceUnionPayloadTemplate(carrier);
  assert.equal(template !== undefined, true);
  assert.equal(template.payloadParameters[0].parameter.name === colliding.name, false);
  assert.equal(instantiateRustSourceUnionPayloads(carrier, [colliding, ready(colliding)], registry) !== undefined, true);
});

test("physical declaration planning retains exact source arity and binder kinds even for erased source binders", () => {
  const registry = createRustTypeDefinitionRegistry();
  const carrier = alias("Generic", [argument(parameter)]);
  assert.equal(registry.registerSourceUnion(definition(carrier, [parameter, text]), true), true);
  const template = registry.sourceUnionPayloadTemplate(carrier);
  const generic = { kind: "type", name: "Value", bounds: [] };
  const valid = planRustSourceUnionPayloadTemplate(template, { parameters: [generic], wherePredicates: [] }, rustTypeFromCarrier);
  assert.equal(valid !== undefined, true);
  assert.deepEqual(valid.generics.parameters.map(selected => selected.name), ["Payload0", "Payload1"]);
  for (const parameters of [[], [generic, generic], [{ kind: "lifetime", name: "input", outlives: [] }]]) {
    assert.equal(planRustSourceUnionPayloadTemplate(template, { parameters, wherePredicates: [] }, rustTypeFromCarrier) === undefined, true);
  }
});
