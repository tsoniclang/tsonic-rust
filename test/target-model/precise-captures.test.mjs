import assert from "node:assert/strict";
import test from "node:test";
import { substituteRustTargetGenerics } from "../../dist/target-model/types/carriers/substitution.js";
import { rustTargetCaptureArguments } from "../../dist/target-model/types/carriers/generic-references.js";
import { rustFixedArrayTargetType } from "../../dist/target-model/types/carriers/native.js";
import { rustLifetimeKey } from "../../dist/target-model/lifetimes/index.js";

const value = { kind: "type-parameter", identity: "scope:Value", name: "Value" };
const item = { kind: "type-parameter", identity: "scope:Item", name: "Item" };
const region = { kind: "parameter", identity: "scope:Region", name: "region" };
const count = { kind: "parameter", identity: "scope:Count", name: "Count" };
const integer = { kind: "source-primitive", name: "int32" };
const typeArgument = type => ({ kind: "type", type });
const opaque = captures => ({ kind: "impl-trait", id: "fixture:opaque", bounds: [], outlives: [], captures });

test("precise captures substitute dependencies rather than concrete type lifetime or const values", () => {
  const captures = [typeArgument(value), { kind: "lifetime", lifetime: region }, { kind: "const", value: count }];
  const substituted = substituteRustTargetGenerics(opaque(captures), new Map([[value.identity, integer]]),
    new Map([[rustLifetimeKey(region), { kind: "static" }]]), new Map([[count.identity, { kind: "integer", value: "4" }]]));
  assert.deepEqual(substituted.captures, []);
  const application = substituteRustTargetGenerics({ kind: "target-named", id: "fixture:Container", genericArguments: captures },
    new Map([[value.identity, integer]]), new Map([[rustLifetimeKey(region), { kind: "static" }]]),
    new Map([[count.identity, { kind: "integer", value: "4" }]]));
  assert.deepEqual(application.genericArguments, [typeArgument(integer), { kind: "lifetime", lifetime: { kind: "static" } },
    { kind: "const", value: { kind: "integer", value: "4" } }]);
});

test("compound precise capture substitution retains exact free type lifetime and const identities once", () => {
  const compound = { kind: "reference", lifetime: region, mutable: false,
    referent: rustFixedArrayTargetType(item, count) };
  const substituted = substituteRustTargetGenerics(opaque([typeArgument(value), typeArgument(item),
    { kind: "lifetime", lifetime: region }, { kind: "const", value: count }]),
    new Map([[value.identity, compound]]), new Map());
  assert.deepEqual(substituted.captures, [{ kind: "lifetime", lifetime: region }, typeArgument(item), { kind: "const", value: count }]);
  assert.equal(Object.isFrozen(substituted.captures) && substituted.captures.every(Object.isFrozen), true);
});

test("precise capture collection excludes nested bound lifetimes but preserves free references", () => {
  const bound = { kind: "bound", binderIdentity: "callback", identity: "bound:input", name: "input" };
  const pointer = { kind: "function-pointer", lifetimeBinder: { identity: "callback", parameters: [{ lifetime: bound, outlives: [] }] },
    args: [{ kind: "reference", lifetime: bound, mutable: false, referent: item }],
    result: { kind: "reference", lifetime: region, mutable: false, referent: item } };
  const selected = substituteRustTargetGenerics(opaque([typeArgument(value)]), new Map([[value.identity, pointer]]), new Map());
  assert.deepEqual(selected.captures, [{ kind: "lifetime", lifetime: region }, typeArgument(item)]);
});

test("precise capture collection retains unresolved lifetime identity instead of pretending no dependency", () => {
  const call = { kind: "call-scoped-elision", callIdentity: "call:one", parameterIdentity: "parameter:region" };
  const selected = rustTargetCaptureArguments([{ kind: "lifetime", lifetime: call },
    typeArgument({ kind: "reference", lifetime: { kind: "placeholder" }, mutable: false, referent: integer })]);
  assert.deepEqual(selected, [{ kind: "lifetime", lifetime: call }, { kind: "lifetime", lifetime: { kind: "placeholder" } }]);
});
