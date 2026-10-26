import assert from "node:assert/strict";
import test from "node:test";
import { rustCallTypeFromCarrierInContext, rustTypeFromCarrierInContext, rustUnionTypePathInContext } from "../../../../dist/backend/planner/types/render.js";
import { rustReturnTypeFromCarrier } from "../../../../dist/backend/planner/types/carrier-syntax.js";
import { rustNamedTargetType, rustVecTargetType, rustCallableInputTargetType, rustSourceOptionalTargetType,
  rustSourceUnionTargetType, rustFutureTargetType } from "../../../../dist/target-model/types/index.js";
import { emptyRustTypeDefinitions, instantiateRustSourceUnionPayloads } from "../../../../dist/target-model/types/source-union-definitions.js";
import { createRustTypeDefinitionRegistry } from "../../../../dist/analysis/project-types/type-definitions.js";
import { createRustGeneratedUnionPlan } from "../../../../dist/analysis/objects/shapes/generated-union-plan.js";
import { createRustStructuralShapePlan } from "../../../../dist/analysis/objects/shapes/structural-shape-plan.js";
import { rustProgramPlanContext, rustProgramWithTypeEmissions } from "../../../helpers/plan-context.mjs";


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

const callable = { kind: "closure", callTrait: "FnMut", args: [scalar], result: scalar };
const owner = rustNamedTargetType("test.adapter", "example::Adapter", [{ kind: "type", type: callable }]);

// Rendering reads each carrier's sealed type emission; a real program selects the carriers these tests render.
const input = rustCallableInputTargetType([scalar], scalar);
const borrowedString = { kind: "reference", referent: { kind: "target-named", id: "rust.std.String" }, mutable: false };
const bottom = { kind: "target-specific", target: "rust", name: "never" };
const context = rustProgramPlanContext(rustProgramWithTypeEmissions([
  scalar, input, { kind: "function-pointer", args: [input], result: scalar }, rustSourceOptionalTargetType(input),
  rustSourceOptionalTargetType(rustCallableInputTargetType([{ kind: "opaque", id: "missing" }], scalar)),
  rustSourceOptionalTargetType(rustCallableInputTargetType([borrowedString], scalar)), callable, owner,
  bottom, rustVecTargetType(bottom),
]));

test("native call positions infer anonymous types without erasing their known contract", () => {
  assert.deepEqual(rustCallTypeFromCarrierInContext(callable, context), { kind: "infer" });
  assert.deepEqual(rustCallTypeFromCarrierInContext(owner, context), { kind: "infer" });
  assert.deepEqual(rustCallTypeFromCarrierInContext(scalar, context), { kind: "primitive", name: "usize" });
  assert.equal(rustTypeFromCarrierInContext(owner, context), undefined);
  assert.equal(rustTypeFromCarrierInContext(callable, context, "parameter").bounds[0].trait, "FnMut");
});

// A carrier without a sealed type emission record is an internal planner invariant, not an absent rendering
// (no-fallback rule; PORT-MAP row 262: rendering reads only sealed physical type metadata; RULINGS.md).
const missingRenderingMetadata = error => error?.diagnostic?.code === "TSONIC_INTERNAL_PLANNER_INVARIANT" &&
  /exact sealed rendering metadata/u.test(error.diagnostic.message);

test("native anonymous call inference does not conceal an unresolved component", () => {
  const unresolved = { kind: "opaque", name: "unresolved" };
  assert.throws(() => rustCallTypeFromCarrierInContext(unresolved, context), missingRenderingMetadata);
  assert.throws(() => rustCallTypeFromCarrierInContext({ ...callable, result: unresolved }, context), missingRenderingMetadata);
  assert.throws(() => rustCallTypeFromCarrierInContext({ ...owner, value: { ...owner.value,
    genericArguments: [...owner.value.genericArguments, { kind: "type", type: unresolved }],
  } }, context), missingRenderingMetadata);
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
    const carrier = rustSourceUnionTargetType("/src/index.ts", origin === "generated" ? "Union2" : "Completion", [], origin,
      origin === "generated" ? { kind: "physical", types: payloads } : { kind: "source" });
    const definition = { carrier, variants: payloads.map((carrier, index) => ({ name: `Variant${index}`, carrier })) };
    assert.equal(registry.registerSourceUnion(definition, origin === "authored"), true);
    const physical = instantiateRustSourceUnionPayloads(carrier, [scalar, opaque], registry);
    assert.equal(physical !== undefined, true);
    const generated = createRustGeneratedUnionPlan(origin === "authored" ? [] : [definition], () => "owner", new Map());
    const pointer = { kind: "function-pointer", args: [], result: physical };
    const program = rustProgramWithTypeEmissions([carrier, physical, pointer], {
      source: 'import type { nativeUint } from "@tsonic/core/types.js";\ntype Completion = nativeUint | Promise<nativeUint>;\nexport function probe(): void {}\n',
      typeDefinitions: registry.seal(), structuralShapes: createRustStructuralShapePlan([], [], () => "owner", [], new Map(), [], generated),
    });
    const scope = rustProgramPlanContext(program, { moduleName: "owner", moduleNameByFileName: new Map([["/src/index.ts", "owner"]]) });
    assert.equal(rustUnionTypePathInContext(carrier, scope), origin === "authored" ? "Completion"
      : `crate::shapes::${generated.unionForCarrier(carrier).targetName}`,
      "a nominal union pattern does not require a concrete Future payload annotation");
    for (const position of ["parameter", "return"]) {
      const rendered = rustTypeFromCarrierInContext(physical, scope, position);
      assert.equal(rendered?.kind, "named", `${origin}:${position}`);
      assert.equal(rendered.genericArguments[1].type.kind, "impl-trait");
      assert.equal(rustUnionTypePathInContext(physical, scope), rendered.path,
        "patterns retain the canonical enum identity without emitting anonymous generic arguments");
      assert.equal(rustTypeFromCarrierInContext(pointer, scope, position) === undefined, true,
        "enclosing function pointer still rejects opaque types");
    }
    assert.equal(rustTypeFromCarrierInContext(physical, scope) === undefined, true, "anonymous storage is not admitted");
    assert.equal(rustCallTypeFromCarrierInContext(physical, scope)?.kind, "infer", "the entire anonymous call type is inferred once");
  }
});
