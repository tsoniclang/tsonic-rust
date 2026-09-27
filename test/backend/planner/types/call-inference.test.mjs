import assert from "node:assert/strict";
import test from "node:test";
import { rustCallTypeFromCarrierInContext, rustTypeFromCarrierInContext } from "../../../../dist/backend/planner/types/render.js";
import { rustNamedTargetType } from "../../../../dist/target-model/types/index.js";

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
