import assert from "node:assert/strict";
import test from "node:test";
import { implementationSubstitutions } from "../../../../../dist/providers/native/model/normalization/implementation-bindings.js";
import { directImplementationGenericParameterPositions, normalizeTypeTraits } from "../../../../../dist/providers/native/model/types/requirements.js";
import { normalizeGenericParameters } from "../../../../../dist/providers/native/model/types/normalization.js";
import { rootNormalizationContext, rustCompilerItemIdentity } from "../../../../../dist/providers/native/model/types/normalization-context.js";

const identity = itemId => ({ itemId, canonicalPath: ["example", itemId] });
const parameter = (itemId, name) => ({ kind: "type", identity: identity(itemId), name,
  requirements: [], outlives: [], maybeSized: false });
const reference = parameter => ({ kind: "generic", identity: parameter.identity, name: parameter.name });

test("primitive implementation ownership uses the compiler type, not the export spelling", () => {
  const owner = identity("renamed-primitive");
  const implementation = { for: { primitive: "u32" } };
  assert.deepEqual(directImplementationGenericParameterPositions({}, implementation, {}, [], owner, "u32"), new Map());
  assert.equal(directImplementationGenericParameterPositions({}, implementation, {}, [], owner, "f32"), undefined);
  assert.equal(directImplementationGenericParameterPositions({}, implementation, {}, [], owner), undefined);
  assert.equal(directImplementationGenericParameterPositions({}, implementation, {}, [parameter("wrong", "T")], owner, "u32"), undefined);
});

test("implementation generics use declaration identities and exact associated equalities", () => {
  const declared = parameter("owner:type", "OwnerName");
  const input = parameter("impl:input", "DifferentName");
  const output = parameter("impl:output", "Value");
  const trait = { identity: identity("Producer"), path: "example::Producer", genericArguments: [],
    associatedConstraints: [{ kind: "equality", identity: identity("Producer::Output"), name: "Output", genericArguments: [], type: reference(output) }] };
  input.requirements = [{ kind: "trait", trait }];
  const positions = new Map([[input.identity.itemId, 0]]);
  const bindings = implementationSubstitutions([output, input], positions, [declared]);
  assert.deepEqual(bindings.types.get(input.identity.itemId), reference(declared));
  const selected = bindings.types.get(output.identity.itemId);
  assert.equal(selected.kind, "associated-type");
  assert.deepEqual(selected.owner, reference(declared));
  assert.deepEqual(selected.trait.associatedConstraints, []);
  assert.throws(() => implementationSubstitutions([output], new Map(), []), /one exact associated/u);
  assert.throws(() => implementationSubstitutions([output, { ...input, requirements: [...input.requirements, ...input.requirements] }], positions, [declared]), /one exact associated/u);
  const cyclic = { ...input, requirements: [{ kind: "trait", trait: { ...trait,
    genericArguments: [{ kind: "type", type: reference(output) }] } }] };
  assert.throws(() => implementationSubstitutions([output, cyclic], positions, [declared]), /cyclic or depends/u);
});

const dependency = { alias: "core", packageId: "core 0.0.0", packageName: "core", packageVersion: "0.0.0",
  crateName: "core", targetCrateName: "core", manifestPath: "/core/Cargo.toml", sourceRoot: "/core",
  sourceDigest: "pinned-result-28842", closurePackageIds: ["core 0.0.0"], features: [] };
const argumentsOf = args => ({ angle_bracketed: { args, constraints: [] } });
const rawTypeParameter = (name, bounds = []) => ({ name, kind: {
  type: { bounds, default: null, is_synthetic: false },
} });
const rawGeneric = name => ({ type: { generic: name } });
const rawTrait = (id, args) => ({ path: "selected", id, args: argumentsOf(args) });
const rawBound = (id, args) => ({ trait_bound: {
  trait: rawTrait(id, args), generic_params: [], modifier: "none",
} });
const rawPath = (id, args) => ({ resolved_path: { path: "selected", id, args: argumentsOf(args) } });

function normalizedTraits(parameters, implementations, paths = {}) {
  const owner = { id: 90, name: "Result", inner: { enum: {
    generics: { params: parameters, where_predicates: [] }, impls: implementations.map(row => row.id),
  } } };
  const document = { index: { 90: owner, ...Object.fromEntries(implementations.map(row => [row.id, row])) },
    paths: { 90: { path: ["core", "result", "Result"], kind: "enum" },
      204: { path: ["core", "iter", "traits", "collect", "FromIterator"], kind: "trait" },
      205: { path: ["core", "cmp", "PartialEq"], kind: "trait" },
      206: { path: ["core", "convert", "Into"], kind: "trait" },
      207: { path: ["core", "error", "RetainedError"], kind: "struct" }, ...paths } };
  const declared = normalizeGenericParameters(document, owner.inner.enum.generics,
    rootNormalizationContext(document, dependency, owner)).parameters;
  return { declared, traits: normalizeTypeTraits(document, dependency, owner.inner.enum, declared,
    rustCompilerItemIdentity(document, dependency, owner)) };
}

function rawImplementation(id, parameters, args, trait) {
  return { id, inner: { impl: { is_unsafe: false,
    generics: { params: parameters, where_predicates: [] }, provided_trait_methods: [], trait,
    for: rawPath(90, args), items: [], is_negative: false, is_synthetic: false, blanket_impl: null,
  } } };
}

test("closed trait implementations rebind renamed arguments and conditional PartialEq<Self> to declaration identities", () => {
  const self = rawPath(90, [rawGeneric("Value"), rawGeneric("Error")]);
  const implementation = rawImplementation(600, [
    rawTypeParameter("Value", [rawBound(205, [rawGeneric("Value")])]),
    rawTypeParameter("Error", [rawBound(205, [rawGeneric("Error")])]),
  ], [rawGeneric("Value"), rawGeneric("Error")], rawTrait(205, [{ type: self }]));
  const { declared, traits } = normalizedTraits([rawTypeParameter("T"), rawTypeParameter("E")], [implementation]);
  assert.equal(traits.implementations.length, 1);
  const selected = traits.implementations[0];
  assert.deepEqual(selected.trait.trait.genericArguments[0].type.genericArguments,
    declared.map(value => ({ kind: "type", type: reference(value) })));
  assert.deepEqual(selected.requirements.map(value => value.typeArgumentIndex), [0, 1]);
  for (const condition of selected.requirements) {
    assert.deepEqual(condition.requirement.trait.genericArguments,
      [{ kind: "type", type: reference(declared[condition.typeArgumentIndex]) }]);
  }
});

test("trait evidence rebinds lifetime and const arguments while condition slots remain type-only", () => {
  const rawLifetime = name => ({ name, kind: { lifetime: { outlives: [] } } });
  const rawConst = name => ({ name, kind: { const: { type: { primitive: "usize" }, default: null } } });
  const argumentsFor = (lifetime, type, constant) => [
    { lifetime }, rawGeneric(type), { const: { expr: constant, value: null, is_literal: false } },
  ];
  const args = argumentsFor("'impl", "Value", "SIZE");
  const implementation = rawImplementation(601, [rawLifetime("'impl"),
    rawTypeParameter("Value", [rawBound(204, args)]), rawConst("SIZE")], args, rawTrait(204, args));
  const { declared, traits } = normalizedTraits([rawLifetime("'owner"), rawTypeParameter("T"), rawConst("N")], [implementation]);
  assert.equal(traits.implementations.length, 1);
  const expected = [{ kind: "lifetime", lifetime: declared[0].lifetime },
    { kind: "type", type: reference(declared[1]) },
    { kind: "const", value: { kind: "parameter", identity: declared[2].identity, name: "N" } }];
  assert.deepEqual(traits.implementations[0].trait.trait.genericArguments, expected);
  assert.equal(traits.implementations[0].requirements[0].typeArgumentIndex, 0);
  assert.deepEqual(traits.implementations[0].requirements[0].requirement.trait.genericArguments, expected);
});

test("core Result rustdoc impl 28842 cannot leak its unbound FromIterator quantifier into a closed declaration fact", () => {
  const implementation = { id: 28842, crate_id: 0, name: null,
    span: { filename: "core/src/result.rs", begin: [2114, 1], end: [2161, 2] },
    visibility: "default", docs: null, links: {}, attrs: [], deprecation: null,
    stability: { feature: "rust1", level: "stable", since: "1.0.0" }, const_stability: null,
    inner: { impl: { is_unsafe: false, generics: { params: [rawTypeParameter("A"), rawTypeParameter("E"),
      rawTypeParameter("V", [rawBound(204, [rawGeneric("A")])])], where_predicates: [] },
    provided_trait_methods: [], trait: rawTrait(204, [{ type: rawPath(90, [rawGeneric("A"), rawGeneric("E")]) }]),
    for: rawPath(90, [rawGeneric("V"), rawGeneric("E")]), items: [28841],
    is_negative: false, is_synthetic: false, blanket_impl: null } } };
  const concrete = rawImplementation(602, [], [], rawTrait(206, [{ type: rawPath(207, []) }]));
  const { traits } = normalizedTraits([rawTypeParameter("T"), rawTypeParameter("E")], [implementation]);
  assert.deepEqual(traits.implementations, []);
  const closed = normalizedTraits([], [concrete]).traits.implementations;
  assert.equal(closed.length, 1);
  assert.equal(closed[0].trait.trait.path, "core::convert::Into");
  assert.deepEqual(closed[0].trait.trait.genericArguments[0].type.identity.canonicalPath,
    ["core", "error", "RetainedError"]);
});
