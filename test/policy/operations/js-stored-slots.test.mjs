import assert from "node:assert/strict";
import test from "node:test";
import { selectRustJsStoredTypeArgumentSlots } from "../../../dist/policy/operations/source-profiles/js/stored-slots.js";
import { rustJsMapTargetType, rustJsSetTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";

const key = rustSourcePrimitiveTargetType("string");
const value = rustSourcePrimitiveTargetType("int64");

test("Map stored slots preserve the exact selected native key and value arguments", () => {
  const slots = selectRustJsStoredTypeArgumentSlots(rustJsMapTargetType(key, value));
  assert.equal(slots?.length, 2, "two checked source slots have two native arguments");
  assert.equal(slots[0].index, 0, "key source slot");
  assert.equal(slots[0].nativeArgumentIndex, 0, "key native argument");
  assert.equal(slots[0].carrier === key, true, "key carrier identity");
  assert.equal(slots[1].index, 1, "value source slot");
  assert.equal(slots[1].nativeArgumentIndex, 1, "value native argument");
  assert.equal(slots[1].carrier === value, true, "value carrier identity");
  assert.equal(Object.isFrozen(slots), true, "closed slot inventory");
  assert.equal(slots.every(Object.isFrozen), true, "closed slot rows");
});

test("Set stored slot preserves its exact native element argument", () => {
  const slots = selectRustJsStoredTypeArgumentSlots(rustJsSetTargetType(value));
  assert.equal(slots?.length, 1, "one checked source slot");
  assert.equal(slots[0].index, 0, "element source slot");
  assert.equal(slots[0].nativeArgumentIndex, 0, "element native argument");
  assert.equal(slots[0].carrier === value, true, "element carrier identity");
});

test("nested native lifetime and const arguments remain inside their selected stored carrier", () => {
  const payload = { kind: "target-named", id: "fixture.Stored", genericArguments: [
    { kind: "lifetime", lifetime: { kind: "static" } },
    { kind: "const", value: { kind: "integer", value: "4" } },
    { kind: "type", type: value },
  ] };
  const slots = selectRustJsStoredTypeArgumentSlots(rustJsMapTargetType(key, payload));
  assert.equal(slots?.[1].carrier === payload, true, "no filtering or reconstruction of nested physical arguments");
  assert.equal(slots[1].nativeArgumentIndex, 1, "outer native ABI ordinal remains exact");
});

test("unregistered native carriers never gain a source stored-slot interpretation", () => {
  for (const carrier of [undefined, value, { kind: "target-named", id: "fixture.JsMap", genericArguments: [
    { kind: "type", type: key }, { kind: "type", type: value },
  ] }]) {
    assert.equal(selectRustJsStoredTypeArgumentSlots(carrier) === undefined, true, "only registered native identities");
  }
});

test("stored-slot ABI refuses missing, extra and non-type native arguments", () => {
  const map = rustJsMapTargetType(key, value);
  const set = rustJsSetTargetType(value);
  for (const [carrier, arguments_] of [
    [map, undefined], [map, []], [map, [{ kind: "type", type: key }]],
    [map, [...map.genericArguments, { kind: "type", type: value }]],
    [set, []], [set, [...set.genericArguments, { kind: "type", type: key }]],
    [map, [{ kind: "lifetime", lifetime: { kind: "static" } }, { kind: "type", type: value }]],
    [set, [{ kind: "const", value: { kind: "integer", value: "4" } }]],
  ]) {
    assert.equal(selectRustJsStoredTypeArgumentSlots({ ...carrier, genericArguments: arguments_ }) === undefined,
      true, "native argument kind and arity are exact, never filtered or inferred");
  }
});
