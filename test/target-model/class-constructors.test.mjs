import assert from "node:assert/strict";
import test from "node:test";
import { rustClassConstructorTargetType, rustClassConstructorInstance } from "../../dist/target-model/types/carriers/class-constructors.js";
import { rustSourceTypeCarrier } from "../../dist/target-model/types/carriers/source-types.js";
import { rustTargetTypeChildren } from "../../dist/target-model/types/carriers/children.js";
import { rustTargetTypeParameterNames } from "../../dist/target-model/types/carriers/generic-references.js";
import { substituteRustTargetTypeParameters } from "../../dist/target-model/types/carriers/substitution.js";
import { inferRustTargetTypeParameterBindings } from "../../dist/target-model/types/carriers/generic-inference.js";
import { isRustCopyCarrier, rustCarrierSupportsClone, rustCarrierSupportsObjectIdentity } from "../../dist/target-model/types/carriers/traits.js";

const instance = (name, parameter) => rustSourceTypeCarrier("/src/model.ts", name, "object",
  [{ kind: "type", type: parameter }]);
const parameter = { kind: "type-parameter", name: "Value" };
const number = { kind: "source-primitive", name: "float64" };

test("constructor values retain distinct instance identity and exact generic arguments", () => {
  const source = instance("Adapter@10", parameter);
  const constructor = rustClassConstructorTargetType(source);
  assert.deepEqual(rustClassConstructorInstance(constructor), source);
  assert.equal(rustClassConstructorInstance(source), undefined);
  assert.deepEqual(rustTargetTypeChildren(constructor), [source]);
  assert.deepEqual(rustTargetTypeParameterNames(constructor), ["Value"]);
  const concrete = substituteRustTargetTypeParameters(constructor, new Map([["Value", number]]));
  assert.deepEqual(rustClassConstructorInstance(concrete), instance("Adapter@10", number));
  assert.deepEqual(inferRustTargetTypeParameterBindings(constructor, concrete, new Set(["Value"])), new Map([["Value", number]]));
  assert.equal(inferRustTargetTypeParameterBindings(constructor,
    rustClassConstructorTargetType(instance("Adapter@20", number)), new Set(["Value"])), undefined);
  assert.equal(rustCarrierSupportsClone(constructor), true);
  assert.equal(rustCarrierSupportsObjectIdentity(constructor), true);
  assert.equal(isRustCopyCarrier(constructor), false);
});

test("constructor metadata is immutable and malformed instance selections are rejected", () => {
  const source = structuredClone(instance("Adapter@10", parameter));
  const constructor = rustClassConstructorTargetType(source);
  source.value.typeName = "Changed";
  source.value.genericArguments[0].type.name = "Changed";
  assert.deepEqual(rustClassConstructorInstance(constructor), instance("Adapter@10", parameter));
  assert.ok(Object.isFrozen(constructor.value.instance.value.genericArguments[0].type));
  for (const carrier of [number, rustSourceTypeCarrier("/src/model.ts", "Tag", "enum")]) {
    assert.throws(() => rustClassConstructorTargetType(carrier), /exact project instance carrier/u);
    assert.equal(rustClassConstructorInstance({ ...constructor, value: { instance: carrier } }), undefined);
  }
  assert.equal(rustClassConstructorInstance({ ...constructor, value: { instance: constructor.value.instance, extra: true } }), undefined);
  let reads = 0;
  const value = { get instance() { reads += 1; return source; } };
  assert.equal(rustClassConstructorInstance({ ...constructor, value }), undefined);
  assert.equal(reads, 0);
});
