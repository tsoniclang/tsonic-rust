import assert from "node:assert/strict";
import test from "node:test";
import { rustCallTypeFromCarrierInContext, rustReturnTypeFromCarrier, rustTypeFromCarrierInContext,
  rustUnionTypePathInContext } from "../../../../dist/backend/planner/types/render.js";
import { rustNamedTargetType, rustVecTargetType, rustCallableInputTargetType, rustSourceOptionalTargetType,
  rustSourceUnionTargetType, rustFutureTargetType } from "../../../../dist/target-model/types/index.js";
import { rustTypeIsLegalInPosition } from "../../../../dist/backend/planner/types/type-observations.js";
import { emptyRustTypeDefinitions, instantiateRustSourceUnionPayloads } from "../../../../dist/target-model/types/source-union-definitions.js";
import { createRustTypeDefinitionRegistry } from "../../../../dist/analysis/project-types/type-definitions.js";
import { createRustGeneratedUnionPlan } from "../../../../dist/analysis/objects/generated-union-plan.js";

const context = { input: { program: { typeDefinitions: emptyRustTypeDefinitions } } };

test("borrowed invocation protocols render only in native parameter or return positions", () => {
  const input = rustCallableInputTargetType([scalar], scalar);
  const borrowed = input;
  const rendered = rustTypeFromCarrierInContext(borrowed, context, "parameter");
  assert.equal(rendered?.kind, "reference");
  assert.equal(rendered?.referent.kind, "impl-trait");
  assert.equal(rendered?.referent.bounds[0].reference.trait.path, "rt::CallableImplementation");
  assert.deepEqual(rendered.referent.bounds[0].reference.trait.genericArguments, [
    { kind: "type", type: { kind: "tuple", elements: [{ kind: "primitive", name: "usize" }] } },
    { kind: "associated-equality", name: "Output", genericArguments: [],
      type: { kind: "named", path: "rt::TsonicResult", genericArguments: [
        { kind: "type", type: { kind: "primitive", name: "usize" } },
      ] } },
  ]);
  assert.equal(rustTypeFromCarrierInContext(borrowed, context) === undefined, true);
  assert.equal(rustTypeFromCarrierInContext({ kind: "function-pointer", args: [borrowed], result: scalar }, context, "parameter") === undefined, true);
});

const scalar = { kind: "source-primitive", name: "native-uint" };

test("optional invocation parameters keep static dispatch and absence uses a concrete zero-value witness", () => {
  const input = rustCallableInputTargetType([scalar], scalar);
  const optional = rustSourceOptionalTargetType(input);
  const parameter = rustTypeFromCarrierInContext(optional, context, "parameter");
  assert.equal(parameter?.genericArguments[0].type.referent.kind, "impl-trait");
  assert.equal(rustTypeFromCarrierInContext(optional, context) === undefined, true);
  const witness = rustTypeFromCarrierInContext(optional, context, "absence");
  const referent = witness?.genericArguments[0].type.referent;
  assert.equal(referent?.kind, "function-pointer");
  assert.equal(referent?.parameters[0].elements[0].name, "usize");
  assert.equal(referent?.result.path, "rt::TsonicResult");
  assert.equal(referent?.result.genericArguments[0].type.name, "usize");
  assert.equal(rustTypeFromCarrierInContext(rustSourceOptionalTargetType(
    rustCallableInputTargetType([{ kind: "opaque", id: "missing" }], scalar)), context, "absence") === undefined, true);
  const borrowed = { kind: "reference", referent: { kind: "target-named", id: "rust.std.String" }, mutable: false };
  const ranked = rustTypeFromCarrierInContext(rustSourceOptionalTargetType(
    rustCallableInputTargetType([borrowed], scalar)), context, "absence");
  const functionType = ranked?.genericArguments[0].type.referent;
  assert.equal(functionType?.binder.length, 1);
  assert.equal(functionType?.parameters[0].elements[0].lifetime.name, functionType?.binder[0].name);
});

test("native anonymous signature containers do not admit anonymous storage or nested callable bounds", () => {
  const anonymous = { kind: "impl-trait", bounds: [{ kind: "trait", path: "core::fmt::Debug" }], outlives: [] };
  for (const type of [anonymous, { kind: "reference", referent: anonymous, mutable: false },
    { kind: "tuple", elements: [anonymous] },
    { kind: "named", path: "Option", genericArguments: [{ kind: "type", type: anonymous }] },
    { kind: "slice", element: anonymous }]) {
    assert.equal(rustTypeIsLegalInPosition(type, "parameter"), true);
    assert.equal(rustTypeIsLegalInPosition(type, "return"), true);
    assert.equal(rustTypeIsLegalInPosition(type, "general"), false);
  }
  for (const type of [
    { kind: "function-pointer", parameters: [anonymous], result: { kind: "unit" } },
    { kind: "impl-trait", bounds: [{ kind: "callable", trait: "Fn", binder: [], parameters: [anonymous], result: { kind: "unit" } }], outlives: [] },
  ]) {
    assert.equal(rustTypeIsLegalInPosition(type, "parameter"), false);
    assert.equal(rustTypeIsLegalInPosition(type, "return"), false);
  }
});

test("anonymous implementation bounds admit exact associated outputs without positional nesting", () => {
  const output = { kind: "impl-trait", bounds: [{ kind: "trait", path: "core::fmt::Debug" }], outlives: [] };
  const optional = { kind: "named", path: "Option", genericArguments: [{ kind: "type", type: output }] };
  const selected = argument => ({ kind: "impl-trait", outlives: [], bounds: [{ kind: "trait-type", reference: {
    trait: { kind: "named", path: "example::Invocation", genericArguments: [argument] },
  } }] });
  const equality = type => ({ kind: "associated-equality", name: "Output", genericArguments: [], type });
  for (const type of [selected(equality(output)), selected(equality(optional)),
    selected(equality(selected(equality(output)))), selected({ kind: "associated-bounds", name: "Output", genericArguments: [],
      bounds: [{ kind: "trait-type", reference: { trait: { kind: "named", path: "Iterator", genericArguments: [equality(output)] } } }] })]) {
    assert.equal(rustTypeIsLegalInPosition(type, "parameter"), true);
    assert.equal(rustTypeIsLegalInPosition(type, "return"), true);
    assert.equal(rustTypeIsLegalInPosition(type, "general"), false);
  }
  for (const type of [selected({ kind: "type", type: output }), selected({ kind: "type", type: optional }),
    selected({ ...equality({ kind: "unit" }), genericArguments: [{ kind: "type", type: output }] }),
    { ...selected(equality(output)), captures: [{ kind: "type", type: output }] }]) {
    assert.equal(rustTypeIsLegalInPosition(type, "parameter"), false);
    assert.equal(rustTypeIsLegalInPosition(type, "return"), false);
    assert.equal(rustTypeIsLegalInPosition(type, "general"), false);
  }
});
const callable = { kind: "closure", callTrait: "FnMut", args: [scalar], result: scalar };
const owner = rustNamedTargetType("test.adapter", "example::Adapter", [{ kind: "type", type: callable }]);

test("native call positions infer anonymous types without erasing their known contract", () => {
  assert.deepEqual(rustCallTypeFromCarrierInContext(callable, context), { kind: "infer" });
  assert.deepEqual(rustCallTypeFromCarrierInContext(owner, context), { kind: "infer" });
  assert.deepEqual(rustCallTypeFromCarrierInContext(scalar, context), { kind: "primitive", name: "usize" });
  assert.equal(rustTypeFromCarrierInContext(owner, context), undefined);
  assert.equal(rustTypeFromCarrierInContext(callable, context, "parameter").bounds[0].trait, "FnMut");
});

test("native anonymous call inference does not conceal an unresolved component", () => {
  const unresolved = { kind: "opaque", name: "unresolved" };
  assert.equal(rustCallTypeFromCarrierInContext(unresolved, context), undefined);
  assert.equal(rustCallTypeFromCarrierInContext({ ...callable, result: unresolved }, context), undefined);
  assert.equal(rustCallTypeFromCarrierInContext({ ...owner, value: { ...owner.value,
    genericArguments: [...owner.value.genericArguments, { kind: "type", type: unresolved }],
  } }, context), undefined);
});

test("bottom storage is uninhabited while diverging return types remain native never", () => {
  const bottom = { kind: "target-specific", target: "rust", name: "never" };
  const storage = { kind: "named", path: "core::convert::Infallible" };
  assert.deepEqual(rustTypeFromCarrierInContext(bottom, context), storage);
  assert.deepEqual(rustReturnTypeFromCarrier(bottom), { kind: "never" });
  assert.deepEqual(rustTypeFromCarrierInContext(rustVecTargetType(bottom), context), {
    kind: "named", path: "Vec", genericArguments: [{ kind: "type", type: storage }],
  });
});

test("canonical physical union payloads retain enclosing anonymous type positions", () => {
  const opaque = { kind: "impl-trait", id: "call:Future", captures: [], outlives: [], bounds: [
    { kind: "trait-ref", id: "native.Future", path: "core::future::Future", genericArguments: [], associatedConstraints: [
      { kind: "equality", identity: "native.Future:Output", name: "Output", genericArguments: [], type: scalar },
    ] },
  ] };
  for (const origin of ["authored", "generated"]) {
    const registry = createRustTypeDefinitionRegistry();
    const payloads = [scalar, rustFutureTargetType(scalar)];
    const carrier = rustSourceUnionTargetType("/src/owner.ts", origin === "generated" ? "Union2" : "Completion", [], origin,
      origin === "generated" ? { kind: "physical", types: payloads } : { kind: "source" });
    const definition = { carrier, variants: payloads.map((carrier, index) => ({ name: `Variant${index}`, carrier })) };
    assert.equal(registry.registerSourceUnion(definition, origin === "authored"), true);
    const physical = instantiateRustSourceUnionPayloads(carrier, [scalar, opaque], registry);
    assert.equal(physical !== undefined, true);
    const generated = createRustGeneratedUnionPlan(origin === "authored" ? [] : [definition], () => "owner", new Map());
    const scope = { moduleName: "owner", moduleNameByFileName: new Map([["/src/owner.ts", "owner"]]),
      structuralShapesModuleName: "shapes", externalCrateNameByFileName: new Map(), externalStructuralShapeModuleByFileName: new Map(),
      input: { program: { typeDefinitions: registry.seal(), names: { nameForSourceType: (_file, name) => name },
        callableValues: { native: { protocolForSourceItem: () => undefined } }, structuralShapes: generated } } };
    for (const position of ["parameter", "return"]) {
      const rendered = rustTypeFromCarrierInContext(physical, scope, position);
      assert.equal(rendered?.kind, "named", `${origin}:${position}`);
      assert.equal(rendered.genericArguments[1].type.kind, "impl-trait");
      assert.equal(rustUnionTypePathInContext(physical, scope), rendered.path,
        "patterns retain the canonical enum identity without emitting anonymous generic arguments");
      assert.equal(rustTypeFromCarrierInContext({ kind: "function-pointer", args: [], result: physical }, scope, position) === undefined, true,
        "enclosing function pointer still rejects opaque types");
    }
    assert.equal(rustTypeFromCarrierInContext(physical, scope) === undefined, true, "anonymous storage is not admitted");
    assert.equal(rustCallTypeFromCarrierInContext(physical, scope)?.kind, "infer", "the entire anonymous call type is inferred once");
  }
});
