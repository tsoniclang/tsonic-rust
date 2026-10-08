import assert from "node:assert/strict";
import test from "node:test";
import { rustCallTypeFromCarrierInContext, rustReturnTypeFromCarrier, rustTypeFromCarrierInContext } from "../../../../dist/backend/planner/types/render.js";
import { rustNamedTargetType, rustVecTargetType, rustCallableInputTargetType, rustSourceOptionalTargetType } from "../../../../dist/target-model/types/index.js";
import { rustTypeIsLegalInPosition } from "../../../../dist/backend/planner/types/type-observations.js";

test("borrowed invocation protocols render only in native parameter or return positions", () => {
  const input = rustCallableInputTargetType([scalar], scalar);
  const borrowed = input;
  const rendered = rustTypeFromCarrierInContext(borrowed, {}, "parameter");
  assert.equal(rendered?.kind, "reference");
  assert.equal(rendered?.referent.kind, "impl-trait");
  assert.equal(rendered?.referent.bounds[0].reference.trait.path, "rt::CallableImplementation");
  assert.equal(rustTypeFromCarrierInContext(borrowed, {}) === undefined, true);
  assert.equal(rustTypeFromCarrierInContext({ kind: "function-pointer", args: [borrowed], result: scalar }, {}, "parameter") === undefined, true);
});

const scalar = { kind: "source-primitive", name: "native-uint" };

test("optional invocation parameters keep static dispatch and absence uses a concrete zero-value witness", () => {
  const input = rustCallableInputTargetType([scalar], scalar);
  const optional = rustSourceOptionalTargetType(input);
  const parameter = rustTypeFromCarrierInContext(optional, {}, "parameter");
  assert.equal(parameter?.genericArguments[0].type.referent.kind, "impl-trait");
  assert.equal(rustTypeFromCarrierInContext(optional, {}) === undefined, true);
  const witness = rustTypeFromCarrierInContext(optional, {}, "absence");
  const referent = witness?.genericArguments[0].type.referent;
  assert.equal(referent?.kind, "function-pointer");
  assert.equal(referent?.parameters[0].elements[0].name, "usize");
  assert.equal(referent?.result.path, "rt::TsonicResult");
  assert.equal(referent?.result.genericArguments[0].type.name, "usize");
  assert.equal(rustTypeFromCarrierInContext(rustSourceOptionalTargetType(
    rustCallableInputTargetType([{ kind: "opaque", id: "missing" }], scalar)), {}, "absence") === undefined, true);
  const borrowed = { kind: "reference", referent: { kind: "target-named", id: "rust.std.String" }, mutable: false };
  const ranked = rustTypeFromCarrierInContext(rustSourceOptionalTargetType(
    rustCallableInputTargetType([borrowed], scalar)), {}, "absence");
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
const callable = { kind: "closure", callTrait: "FnMut", args: [scalar], result: scalar };
const owner = rustNamedTargetType("test.adapter", "example::Adapter", [{ kind: "type", type: callable }]);

test("native call positions infer anonymous types without erasing their known contract", () => {
  assert.deepEqual(rustCallTypeFromCarrierInContext(callable, {}), { kind: "infer" });
  assert.deepEqual(rustCallTypeFromCarrierInContext(owner, {}), { kind: "infer" });
  assert.deepEqual(rustCallTypeFromCarrierInContext(scalar, {}), { kind: "primitive", name: "usize" });
  assert.equal(rustTypeFromCarrierInContext(owner, {}), undefined);
  assert.equal(rustTypeFromCarrierInContext(callable, {}, "parameter").bounds[0].trait, "FnMut");
});

test("native anonymous call inference does not conceal an unresolved component", () => {
  const unresolved = { kind: "opaque", name: "unresolved" };
  assert.equal(rustCallTypeFromCarrierInContext(unresolved, {}), undefined);
  assert.equal(rustCallTypeFromCarrierInContext({ ...callable, result: unresolved }, {}), undefined);
  assert.equal(rustCallTypeFromCarrierInContext({ ...owner, value: { ...owner.value,
    genericArguments: [...owner.value.genericArguments, { kind: "type", type: unresolved }],
  } }, {}), undefined);
});

test("bottom storage is uninhabited while diverging return types remain native never", () => {
  const bottom = { kind: "target-specific", target: "rust", name: "never" };
  const storage = { kind: "named", path: "core::convert::Infallible" };
  assert.deepEqual(rustTypeFromCarrierInContext(bottom, {}), storage);
  assert.deepEqual(rustReturnTypeFromCarrier(bottom), { kind: "never" });
  assert.deepEqual(rustTypeFromCarrierInContext(rustVecTargetType(bottom), {}), {
    kind: "named", path: "Vec", genericArguments: [{ kind: "type", type: storage }],
  });
});
