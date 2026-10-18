import assert from "node:assert/strict";
import test from "node:test";
import { implementationSubstitutions } from "../../../../../dist/providers/native/model/normalization/implementation-bindings.js";
import { selectRustCompilerDirectImplementation, normalizeTypeTraits } from "../../../../../dist/providers/native/model/types/requirements.js";
import * as compilerTypes from "../../../../../dist/providers/native/model/rustdoc-types.js";
import { normalizeTypeMembers } from "../../../../../dist/providers/native/model/normalization/members.js";
import { normalizeGenericParameters, rootNormalizationContext, rustCompilerItemIdentity } from "../../../../../dist/providers/native/model/rustdoc-types.js";

const identity = itemId => ({ itemId, canonicalPath: ["example", itemId] });
const parameter = (itemId, name) => ({ kind: "type", identity: identity(itemId), name,
  requirements: [], outlives: [], maybeSized: false });
const reference = parameter => ({ kind: "generic", identity: parameter.identity, name: parameter.name });

test("primitive implementation ownership uses the compiler type, not the export spelling", () => {
  const owner = identity("renamed-primitive");
  const implementation = { for: { primitive: "u32" } };
  const selected = selectRustCompilerDirectImplementation({}, implementation, {}, [], owner, "u32");
  assert.equal(selected !== undefined, true, "the exact primitive owner is selected");
  assert.equal(selected.positions.size, 0, "the primitive implementation has no owner generic substitutions");
  assert.equal(selected.selfType.kind, "primitive", "the selected Self remains the actual native primitive");
  assert.equal(selected.selfType.name, "u32", "the native primitive identity is not an export spelling");
  assert.equal(selectRustCompilerDirectImplementation({}, implementation, {}, [], owner, "f32"), undefined);
  assert.equal(selectRustCompilerDirectImplementation({}, implementation, {}, [], owner), undefined);
  assert.equal(selectRustCompilerDirectImplementation({}, implementation, {}, [parameter("wrong", "T")], owner, "u32"), undefined);
  assert.equal(Object.hasOwn(compilerTypes, "directImplementationGenericParameterPositions"), false,
    "the superseded position-only API is absent rather than a competing native Self route");
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

function implementationFixture(parameters, implementationParameters, arguments_) {
  const implementation = rawImplementation(700, implementationParameters, arguments_, null);
  const owner = { id: 90, name: "Holder", visibility: "public", inner: { struct: {
    kind: { plain: { fields: [], has_stripped_fields: true } },
    generics: { params: parameters, where_predicates: [] }, impls: [700],
  } } };
  const document = { index: { 90: owner, 700: implementation },
    paths: { 90: { path: ["core", "Holder"], kind: "struct" } } };
  const ownerIdentity = rustCompilerItemIdentity(document, dependency, owner);
  const declared = normalizeGenericParameters(document, owner.inner.struct.generics,
    rootNormalizationContext(document, dependency, owner)).parameters;
  const context = normalizeGenericParameters(document, implementation.inner.impl.generics,
    compilerTypes.derivedNormalizationContext(dependency, ownerIdentity, "impl:700", { selfOwner: ownerIdentity })).context;
  const select = arguments_ => selectRustCompilerDirectImplementation(document,
    { ...implementation.inner.impl, for: rawPath(90, arguments_) }, context, declared, ownerIdentity);
  return { document, owner, implementation, ownerIdentity, declared, context, select };
}

const rawLifetimeParameter = name => ({ name, kind: { lifetime: { outlives: [] } } });

test("impl-header anonymous lifetimes retain exact declared nominal slots without accepting static or foreign specializations", () => {
  const current = implementationFixture([rawLifetimeParameter("'first"), rawLifetimeParameter("'second")], [],
    [{ lifetime: "'_" }, { lifetime: "'_" }]);
  const selected = current.select([{ lifetime: "'_" }, { lifetime: "'_" }]);
  assert.equal(selected !== undefined, true, "the native universally elided implementation is selected");
  assert.equal(selected.positions.size, 0, "no nonexistent implementation parameter identity is manufactured");
  assert.equal(selected.selfType.kind, "path", "the actual nominal Self is retained");
  assert.equal(selected.selfType.identity.itemId, current.ownerIdentity.itemId, "the nominal declaration identity is authoritative");
  assert.equal(selected.selfType.genericArguments[0].lifetime === current.declared[0].lifetime, true,
    "the first anonymous impl slot carries the identical first declaration binder");
  assert.equal(selected.selfType.genericArguments[1].lifetime === current.declared[1].lifetime, true,
    "the second anonymous impl slot carries the identical second declaration binder");
  assert.equal(current.declared[0].lifetime.identity.itemId !== current.declared[1].lifetime.identity.itemId, true,
    "anonymous slots never collapse distinct native lifetime identities");
  assert.equal(Object.isFrozen(selected) && Object.isFrozen(selected.selfType) &&
    Object.isFrozen(selected.selfType.genericArguments), true, "selected Self evidence is immutable");
  assert.equal(current.select([{ lifetime: "'static" }, { lifetime: "'_" }]), undefined,
    "a static specialization is not projected as a universal declaration");
  assert.equal(current.select([{ lifetime: "'_" }]), undefined, "a missing required lifetime is not a default");
  assert.equal(current.select([{ lifetime: "'_" }, { lifetime: "'_" }, { lifetime: "'_" }]), undefined,
    "extra lifetime arguments are not silently dropped");
  assert.equal(current.select([{ type: { primitive: "u8" } }, { lifetime: "'_" }]), undefined,
    "an argument of another native generic kind cannot fill a lifetime slot");
  assert.equal(selectRustCompilerDirectImplementation(current.document, current.implementation.inner.impl,
    current.context, current.declared, { ...current.ownerIdentity, itemId: `${current.ownerIdentity.itemId}:foreign` }), undefined,
    "equal displayed nominal names cannot replace exact native declaration identity");
  const repeated = implementationFixture([rawLifetimeParameter("'first"), rawLifetimeParameter("'second")],
    [rawLifetimeParameter("'actual")], [{ lifetime: "'actual" }, { lifetime: "'actual" }]);
  assert.equal(repeated.select([{ lifetime: "'actual" }, { lifetime: "'actual" }]), undefined,
    "a repeated named implementation argument does not prove two independent owner slots");
});

test("impl lifetime elision preserves actual type and const default boundaries", () => {
  const current = implementationFixture([rawLifetimeParameter("'owner"),
    { ...rawTypeParameter("Value"), kind: { type: { ...rawTypeParameter("Value").kind.type, default: { primitive: "u8" } } } },
    { name: "SIZE", kind: { const: { type: { primitive: "usize" }, default: "4" } } }], [],
    [{ lifetime: "'_" }, { type: { primitive: "u8" } }, { const: "4" }]);
  const selected = current.select([{ lifetime: "'_" }, { type: { primitive: "u8" } }, { const: "4" }]);
  assert.equal(selected !== undefined, true, "the exact declared type and const defaults remain admissible");
  assert.equal(selected.selfType.genericArguments[0].lifetime === current.declared[0].lifetime, true,
    "only the actual impl lifetime placeholder is materialized from its nominal slot");
  assert.equal(selected.selfType.genericArguments[1].type.name, "u8", "the selected native default type is unchanged");
  assert.equal(selected.selfType.genericArguments[2].value.value, "4", "the selected native const default is unchanged");
  assert.equal(current.select([{ lifetime: "'_" }]) !== undefined, true, "only trailing declared defaults may be omitted");
  assert.equal(current.select([{ lifetime: "'_" }, { type: { primitive: "u16" } }, { const: "4" }]), undefined,
    "an arbitrary concrete type specialization is not admitted as the default");
  assert.equal(current.select([{ lifetime: "'_" }, { type: { primitive: "u8" } }, { const: "5" }]), undefined,
    "an arbitrary concrete const specialization is not admitted as the default");
});

test("actual impl Self and source-visible methods retain owner binders without replacing function signature elision", () => {
  const current = implementationFixture([rawLifetimeParameter("'owner")], [], [{ lifetime: "'_" }]);
  const method = (id, name, receiver, result, visibility = "public") => ({ id, name, visibility, inner: { function: {
    sig: { inputs: [["self", receiver]], output: result, is_c_variadic: false },
    generics: { params: [], where_predicates: [] },
    header: { is_async: false, is_unsafe: false, abi: "Rust" }, has_body: true,
  } } });
  current.document.index[701] = method(701, "identity", { generic: "Self" }, { generic: "Self" });
  current.document.index[702] = method(702, "borrow", { borrowed_ref: { lifetime: null, is_mutable: false, type: { generic: "Self" } } },
    { borrowed_ref: { lifetime: "'_", is_mutable: false, type: { primitive: "u8" } } });
  current.document.index[703] = method(703, "private", { generic: "Self" }, { generic: "Self" }, "default");
  current.implementation.inner.impl.items = [701, 702, 703];
  const selected = normalizeTypeMembers(current.document, current.owner.inner.struct, dependency, current.declared, current.ownerIdentity);
  assert.equal(selected.unsupported.length, 0, "the real anonymous native impl no longer silently loses its methods");
  assert.equal(selected.methods.length, 2, "native private method visibility is preserved");
  const identity = selected.methods.find(value => value.name === "identity");
  assert.equal(identity.receiver.type.genericArguments[0].lifetime === current.declared[0].lifetime, true,
    "the admitted physical Self receiver carries its identical original owner binder");
  assert.equal(identity.result.genericArguments[0].lifetime === current.declared[0].lifetime, true,
    "an actual owned Self result preserves that same declared native binder");
  assert.equal(identity.resultLoans.kind, "complete", "owned Self has a native result relation rather than a guessed empty one");
  assert.equal(identity.resultLoans.loans[0].origins[0].kind, "carried", "owned Self carries its loan, not a new storage borrow");
  const borrowed = selected.methods.find(value => value.name === "borrow");
  assert.equal(borrowed.result.lifetime.kind, "placeholder", "function result placeholders are not globally rewritten");
  assert.equal(borrowed.resultLoanTypes.result.lifetime.kind, "elided", "only the canonical native function selector resolves result elision");
  assert.equal(borrowed.resultLoanTypes.result.lifetime.ownerIdentity, borrowed.identity.itemId,
    "the function's actual receiver borrow does not become the owner's distinct inner lifetime");
});

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
