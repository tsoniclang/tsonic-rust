import assert from "node:assert/strict";
import test from "node:test";
import { rustGenericCallableCarrier, rustGenericCallableValue, rustGenericCallableTargetType } from "../../../dist/target-model/types/carriers/generic-callables.js";
import { substituteRustTargetTypeParameters } from "../../../dist/target-model/types/carriers/substitution.js";
import { rustTargetTypeParameterIdentities } from "../../../dist/target-model/types/carriers/generic-references.js";
import { rustTargetTypeChildren } from "../../../dist/target-model/types/carriers/children.js";
import { inferRustTargetGenericBindings } from "../../../dist/target-model/types/carriers/generic-inference.js";
import { rustGenericCallableStorageArguments } from "../../../dist/target-model/types/carriers/generic-callable-storage.js";

const parameter = identity => ({ kind: "type-parameter", identity, name: identity });
const origin = { fileName: "/index.ts", declarationIdentity: "checked:origin:1" };
const logical = rustGenericCallableValue(rustGenericCallableTargetType([parameter("Value")],
  [parameter("Value")], parameter("Value"), origin));
const selected = identities => rustGenericCallableCarrier({ ...logical, physical: { ownerFileName: "/index.ts",
  members: identities.map((_identity, index) => ({ origin, arguments: [index] })),
  arguments: identities.map(identity => ({ kind: "type", type: parameter(identity) })) } });
const member = index => ({ origin, arguments: [index] });

test("generic physical metadata retains distinct actual member substitutions and traverses hidden types", () => {
  const carrier = selected(["Left", "Right"]);
  assert.deepEqual([...rustTargetTypeParameterIdentities(carrier)].sort(), ["Left", "Right"]);
  assert.equal(rustTargetTypeChildren(carrier).some(type => type.kind === "type-parameter" && type.identity === "Left"), true);
  const scalar = { kind: "source-primitive", name: "float64" };
  const substituted = substituteRustTargetTypeParameters(carrier, new Map([["Left", scalar]]));
  assert.deepEqual(rustTargetTypeParameterIdentities(substituted), ["Right"]);
  assert.equal(Object.isFrozen(carrier.value.physical.members[0].arguments), true);
  const inferred = inferRustTargetGenericBindings(carrier, substituted, {
    typeIdentities: new Set(["Left"]), lifetimeIdentities: new Set(), constIdentities: new Set(),
  });
  assert.equal(inferred?.types.get("Left")?.name, "float64");
  assert.deepEqual(substituted.value.physical.members, carrier.value.physical.members,
    "substituting actual types never reorders native enum alternatives");
});

test("generic physical metadata rejects malformed members, duplicates, sparse arrays and getters", () => {
  const valid = selected(["Left"]);
  let accesses = 0;
  const getter = { ...member(0) };
  Object.defineProperty(getter, "arguments", { get() { accesses += 1; throw new Error("must not execute"); }, enumerable: true });
  for (const physical of [
    undefined,
    { ...valid.value.physical, extra: true },
    { ...valid.value.physical, members: [] },
    { ...valid.value.physical, members: Array(1) },
    { ...valid.value.physical, members: [member(0), member(0)] },
    { ...valid.value.physical, members: [member(1)] },
    { ...valid.value.physical, members: [getter] },
    { ...valid.value.physical, members: [{ ...member(0), arguments: Array(1) }] },
  ]) assert.equal(rustGenericCallableValue({ ...valid, value: { ...valid.value, physical } }) === undefined, true);
  assert.equal(accesses, 0);
});

test("generic physical argument emission orders lifetimes before authored and physical type parameters", () => {
  const authored = parameter("Authored");
  const physical = { kind: "type", type: parameter("Implementation") };
  const lifetime = { kind: "lifetime", lifetime: { kind: "parameter", identity: "borrow", name: "borrow" } };
  const constant = { kind: "const", value: { kind: "integer", value: "17" } };
  const arguments_ = [physical, lifetime, constant];
  const selected = rustGenericCallableStorageArguments([authored], arguments_);
  assert.deepEqual(selected, [lifetime, { kind: "type", type: authored }, physical, constant]);
  assert.equal(Object.isFrozen(selected), true);
  assert.deepEqual(arguments_, [physical, lifetime, constant], "physical member argument indexes are not reordered");
});
