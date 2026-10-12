import assert from "node:assert/strict";
import test from "node:test";
import { rustNativeErrorJoinTargetType, rustNativeErrorJoinReference, selectRustNativeErrorJoin }
  from "../../dist/target-model/types/native-error-joins.js";
import { rustNamedTargetType } from "../../dist/target-model/types/carriers/native.js";
import { rustTargetTypeChildren } from "../../dist/target-model/types/carriers/children.js";
import { rustTargetGenericReferences } from "../../dist/target-model/types/carriers/generic-references.js";
import { substituteRustTargetGenerics } from "../../dist/target-model/types/carriers/substitution.js";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../dist/target-model/types/equality.js";
import { rustLifetimeKey } from "../../dist/target-model/lifetimes/index.js";
import { rustInfallibleTargetId } from "../../dist/target-model/types/carriers/source-types.js";

const file = "/errors.ts";
const failure = rustNamedTargetType("fixture:Failure", "Failure");
const integer = { kind: "source-primitive", name: "int32" };

test("semantic native error joins have one bounded immutable canonical selection", () => {
  const pure = rustNativeErrorJoinTargetType(file, []);
  assert.equal(pure.id, rustInfallibleTargetId);
  const single = rustNativeErrorJoinTargetType(file, [failure]);
  assert.equal(rustTargetTypeRefEquals(single, failure), true);
  assert.equal(Object.isFrozen(single.value), true);
  const joined = rustNativeErrorJoinTargetType(file, [failure, failure]);
  const reference = rustNativeErrorJoinReference(joined);
  assert.equal(reference !== undefined, true);
  assert.equal(reference.fileName, file);
  assert.equal(reference.errors.length, 2, "equal payloads retain distinct source channels");
  assert.equal(Object.isFrozen(reference.errors[0].value), true);
  assert.equal(Object.isFrozen(reference.errors), true);
  assert.equal(Object.isFrozen(reference), true);
  assert.equal(rustTargetTypeRefEquals(joined, rustNativeErrorJoinTargetType("/other.ts", [failure, failure])), false);
});

test("semantic error payload traversal preserves exact type lifetime and const dependencies", () => {
  const parameter = { kind: "type-parameter", identity: "scope:Value", name: "Value" };
  const lifetime = { kind: "parameter", identity: "scope:borrow", name: "borrow" };
  const count = { kind: "parameter", identity: "scope:Count", name: "Count" };
  const dependent = rustNamedTargetType("fixture:Borrowed", "Borrowed", [
    { kind: "type", type: parameter }, { kind: "lifetime", lifetime }, { kind: "const", value: count },
  ]);
  const joined = rustNativeErrorJoinTargetType(file, [dependent, failure]);
  const references = rustTargetGenericReferences(joined);
  assert.deepEqual(references.typeIdentities, [parameter.identity]);
  assert.deepEqual(references.lifetimeIdentities, [rustLifetimeKey(lifetime)]);
  assert.deepEqual(references.constIdentities, [count.identity]);
  assert.equal(rustTargetTypeChildren(joined).length, 2);
  const selected = substituteRustTargetGenerics(joined, new Map([[parameter.identity, integer]]),
    new Map([[rustLifetimeKey(lifetime), { kind: "static" }]]),
    new Map([[count.identity, { kind: "integer", value: "9007199254740993" }]]));
  const payload = rustNativeErrorJoinReference(selected).errors[0].value.genericArguments;
  assert.equal(rustTargetTypeRefEquals(payload[0].type, integer), true);
  assert.equal(payload[1].lifetime.kind, "static");
  assert.equal(payload[2].value.value, "9007199254740993");
  assert.equal(rustTargetGenericReferences(selected).typeIdentities.length, 0);
});

test("native error joins reject malformed cyclic accessor and excessive metadata", () => {
  const cyclic = { kind: "reference", mutable: false };
  cyclic.referent = cyclic;
  const deep = Array.from({ length: 140 }).reduce(referent => ({ kind: "reference", mutable: false, referent }), failure);
  let read = false;
  const accessor = Object.defineProperty({}, "kind", { get() { read = true; return "source-primitive"; } });
  for (const [label, errors] of [
    ["non-array", {}], ["sparse", new Array(2)], ["invalid", [failure, { kind: "invalid" }]],
    ["cycle", [failure, cyclic]], ["depth", [failure, deep]], ["getter", [failure, accessor]],
    ["size", Array.from({ length: 4097 }, () => failure)],
  ]) assert.equal(rustNativeErrorJoinTargetType(file, errors) === undefined, true, label);
  assert.equal(read, false);
  assert.equal(rustNativeErrorJoinTargetType("", [failure]) === undefined, true);
  const joined = rustNativeErrorJoinTargetType(file, [failure, failure]);
  for (const value of [{ ...joined.value, extra: true }, { ...joined.value, errors: [failure] },
    { ...joined.value, fileName: "" }, { ...joined.value, errors: [cyclic, failure] }])
    assert.equal(rustNativeErrorJoinReference({ ...joined, value }) === undefined, true);
});

test("join source selection retains identity and rejects colliding variants", () => {
  const first = { identity: "first", variant: "First", errorType: failure };
  const second = { identity: "second", variant: "Second", errorType: failure };
  assert.equal(selectRustNativeErrorJoin([first, second], isRustTargetTypeRef).kind, "joined");
  for (const sources of [[first, first], [first, { ...second, variant: "First" }],
    [first, { ...second, variant: "r#First" }], [first, { ...second, errorType: {} }],
    [{ ...first, extra: true }], [{ ...first, variant: "bad-name" }]])
    assert.equal(selectRustNativeErrorJoin(sources, isRustTargetTypeRef) === undefined, true);
});
