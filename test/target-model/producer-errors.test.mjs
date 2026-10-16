import assert from "node:assert/strict";
import test from "node:test";
import { rustProducerErrorReference, rustProducerErrorTargetType } from "../../dist/target-model/types/carriers/producer-errors.js";
import { substituteRustTargetGenerics } from "../../dist/target-model/types/carriers/substitution.js";
import { rustTargetGenericReferences } from "../../dist/target-model/types/carriers/generic-references.js";
import { rustTargetTypeChildren } from "../../dist/target-model/types/carriers/children.js";
import { rustLifetimeKey } from "../../dist/target-model/lifetimes/index.js";

const parameter = { kind: "type-parameter", identity: "type:Value", name: "Value" };
const lifetime = { kind: "parameter", identity: "lifetime:input", name: "input" };
const count = { kind: "parameter", identity: "const:Count", name: "Count" };
const integer = { kind: "source-primitive", name: "int64" };
const reference = { identity: "file:producer", fileName: "/src/owner.ts", channel: "invoke",
  genericArguments: [{ kind: "lifetime", lifetime }, { kind: "type", type: parameter }, { kind: "const", value: count }] };

test("producer error references preserve immutable exact type lifetime and const environments", () => {
  const input = structuredClone(reference);
  const type = rustProducerErrorTargetType(input);
  input.genericArguments[1].type.name = "Changed";
  const selected = rustProducerErrorReference(type);
  assert.equal(selected.genericArguments[1].type.name, "Value");
  assert.equal(Object.isFrozen(type) && Object.isFrozen(selected) && Object.isFrozen(selected.genericArguments), true);
  const references = rustTargetGenericReferences(type);
  assert.deepEqual(references.typeIdentities, [parameter.identity]);
  assert.deepEqual(references.lifetimeIdentities, [rustLifetimeKey(lifetime)]);
  assert.deepEqual(references.constParameters, [count]);
  assert.deepEqual(rustTargetTypeChildren(type), [parameter]);
  const substituted = substituteRustTargetGenerics(type, new Map([[parameter.identity, integer]]),
    new Map([[rustLifetimeKey(lifetime), { kind: "static" }]]), new Map([[count.identity, { kind: "integer", value: "9007199254740993" }]]));
  const actual = rustProducerErrorReference(substituted);
  assert.equal(actual.identity, reference.identity);
  assert.equal(actual.channel, "invoke");
  assert.deepEqual(actual.genericArguments, [{ kind: "lifetime", lifetime: { kind: "static" } },
    { kind: "type", type: integer }, { kind: "const", value: { kind: "integer", value: "9007199254740993" } }]);
});

test("producer errors reject malformed channels environments and accessor metadata", () => {
  const valid = rustProducerErrorTargetType(reference);
  for (const mutation of [{ identity: "" }, { fileName: "" }, { channel: -1 }, { channel: 0.5 },
    { channel: Infinity }, { channel: "await" }, { extra: true }, { genericArguments: Array(1) },
    { genericArguments: [{ kind: "type", type: { kind: "missing" } }] }]) {
    assert.equal(rustProducerErrorReference({ ...valid, value: { ...reference, ...mutation } }) === undefined, true,
      "invalid producer metadata cannot become a type proof");
  }
  let reads = 0;
  const withGetter = { ...reference };
  Object.defineProperty(withGetter, "identity", { enumerable: true, get() { reads++; return reference.identity; } });
  assert.equal(rustProducerErrorReference({ ...valid, value: withGetter }) === undefined, true);
  assert.equal(reads, 0);
  assert.equal(rustProducerErrorReference(rustProducerErrorTargetType({ ...reference, channel: 0 })).channel, 0);
  assert.equal(rustProducerErrorReference(rustProducerErrorTargetType({ ...reference, channel: "body" })).channel, "body");
});

test("const environment collection rejects contradictory names for one declaration identity", () => {
  const type = rustProducerErrorTargetType({ ...reference, genericArguments: [
    { kind: "const", value: count }, { kind: "const", value: { ...count, name: "Other" } },
  ] });
  assert.throws(() => rustTargetGenericReferences(type), /contradictory target names/u);
});
