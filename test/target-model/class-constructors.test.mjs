import assert from "node:assert/strict";
import test from "node:test";
import { rustClassConstructorTargetType, rustClassConstructorInstance, rustClassConstructorContract } from "../../dist/target-model/types/carriers/class-constructors.js";
import { rustSourceTypeCarrier } from "../../dist/target-model/types/carriers/source-types.js";
import { rustTargetTypeChildren } from "../../dist/target-model/types/carriers/children.js";
import { rustTargetTypeParameterNames } from "../../dist/target-model/types/carriers/generic-references.js";
import { substituteRustTargetTypeParameters } from "../../dist/target-model/types/carriers/substitution.js";
import { inferRustTargetTypeParameterBindings } from "../../dist/target-model/types/carriers/generic-inference.js";
import { isRustCopyCarrier, rustCarrierSupportsClone, rustCarrierSupportsObjectIdentity } from "../../dist/target-model/types/carriers/traits.js";
import { selectRustBinaryOperator } from "../../dist/policy/operations/operator-rules.js";

const instance = (name, parameter) => rustSourceTypeCarrier("/src/model.ts", name, "object",
  [{ kind: "type", type: parameter }]);
const parameter = { kind: "type-parameter", name: "Value" };
const number = { kind: "source-primitive", name: "float64" };

test("constructor values retain distinct instance identity and exact generic arguments", () => {
  const source = instance("Adapter@10", parameter);
  const constructor = rustClassConstructorTargetType(source);
  assert.deepEqual(rustClassConstructorInstance(constructor), source);
  assert.equal(rustClassConstructorInstance(source), undefined);
  assert.deepEqual(rustTargetTypeChildren(constructor), [parameter]);
  assert.deepEqual(rustTargetTypeParameterNames(constructor), ["Value"]);
  const concrete = substituteRustTargetTypeParameters(constructor, new Map([["Value", number]]));
  assert.deepEqual(rustClassConstructorInstance(concrete), instance("Adapter@10", number));
  assert.deepEqual(inferRustTargetTypeParameterBindings(constructor, concrete, new Set(["Value"])), new Map([["Value", number]]));
  assert.equal(inferRustTargetTypeParameterBindings(constructor,
    rustClassConstructorTargetType(instance("Adapter@20", number)), new Set(["Value"])), undefined);
  assert.equal(rustCarrierSupportsClone(constructor), true);
  assert.equal(rustCarrierSupportsObjectIdentity(constructor), true);
  assert.equal(isRustCopyCarrier(constructor), false);
  for (const operator of ["===", "!==", "==", "!="]) {
    const selected = selectRustBinaryOperator(operator, constructor, constructor);
    assert.equal(selected?.kind, "operator-token");
    assert.equal(selected.rustOperator, operator.includes("!") ? "!=" : "==");
  }
});

test("constructor binders remain quantified while outer environment arguments are substituted", () => {
  const own = { kind: "type-parameter", name: "Item" };
  const source = rustSourceTypeCarrier("/src/model.ts", "Factory", "object", [
    { kind: "type", type: parameter }, { kind: "type", type: own },
  ]);
  const constructor = rustClassConstructorTargetType(source, [1]);
  const concrete = substituteRustTargetTypeParameters(constructor, new Map([["Value", number], ["Item", number]]));
  assert.deepEqual(rustClassConstructorContract(concrete).boundParameterIndexes, [1]);
  assert.deepEqual(rustClassConstructorInstance(concrete).value.genericArguments, [
    { kind: "type", type: number }, { kind: "type", type: own },
  ]);
  assert.deepEqual(rustTargetTypeChildren(constructor), [parameter]);
  assert.deepEqual(rustTargetTypeParameterNames(constructor), ["Value"]);
  assert.deepEqual(inferRustTargetTypeParameterBindings(constructor, concrete, new Set(["Value", "Item"])), new Map([["Value", number]]));
  assert.equal(inferRustTargetTypeParameterBindings(constructor, rustClassConstructorTargetType(source), new Set(["Value", "Item"])), undefined);
  for (const indexes of [[-1], [2], [1, 1], [0.5], [NaN], [Infinity]]) {
    assert.throws(() => rustClassConstructorTargetType(source, indexes), /bound parameter indexes/u);
  }
  assert.throws(() => rustClassConstructorTargetType(instance("Factory", number), [0]), /bound parameter indexes/u);
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
