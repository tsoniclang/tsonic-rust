import assert from "node:assert/strict";
import test from "node:test";
import { rustCallTypeFromCarrierInContext, rustReturnTypeFromCarrier, rustTypeFromCarrierInContext } from "../../../../dist/backend/planner/types/render.js";
import { rustNamedTargetType, rustVecTargetType, rustCallableInputTargetType } from "../../../../dist/target-model/types/index.js";

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
