import assert from "node:assert/strict";
import test from "node:test";
import { createTargetSourceProgram, sourceProjectFiles } from "@tsonic/target-api/source";
import { createRustSession, checkRustSession } from "../../../helpers/rust-session.mjs";
import { rustCallableTargetType, rustCallableProtocol } from "../../../../dist/target-model/types/carriers/callables.js";
import { rustSourceTypeCarrier, rustStructuralObjectTargetType, rustStructuralObjectCarrierValue } from "../../../../dist/target-model/types/carriers/source-types.js";
import { rustTargetTypeChildren } from "../../../../dist/target-model/types/carriers/children.js";
import { mapRustTargetTypes, substituteRustTargetGenerics } from "../../../../dist/target-model/types/carriers/substitution.js";
import { rustLifetimeKey } from "../../../../dist/target-model/lifetimes/index.js";
import { rustOwnedStorageChild, rustOwnedStorageChildren } from "../../../../dist/policy/types/storage/owned-storage.js";
import { closeRustSuspendedStorage } from "../../../../dist/policy/types/storage/suspended-storage.js";
import { closeRustRetainedResult } from "../../../../dist/analysis/callables/ownership/retained-result.js";

const integer = { kind: "source-primitive", name: "int64" };
const parameter = { kind: "type-parameter", identity: "owned:Value", name: "Value" };
const lifetime = { kind: "parameter", identity: "owned:region", name: "region" };
const callback = rustCallableTargetType([parameter], integer);
const factory = fields => rustStructuralObjectTargetType("/src/factory.ts", fields, "reference", callback);
const field = (sourceName, type, method = false) => ({ sourceName, type, presence: "required", readonly: true,
  ...(method ? { method: true } : {}) });

test("native constructor signatures and native methods never become stored closure environments", () => {
  const value = factory([field("invoke", callback, true)]);
  assert.equal(rustOwnedStorageChildren(value).length, 0);
  const closed = closeRustSuspendedStorage(value, "callable-result");
  const native = rustStructuralObjectCarrierValue(closed);
  assert.equal(native.construction === callback, true, "constructor signature is preserved by identity");
  assert.equal(native.fields[0].type === callback, true, "native method signature is preserved by identity");
  const context = {
    ast: { is: {} },
    sourceLifetimes: { contractFor() { assert.fail("no owned storage lifetime is demanded"); } },
    retainedEnvironments: { environmentFor() { assert.fail("native signatures do not own retained environments"); } },
  };
  assert.equal(closeRustRetainedResult({}, value, [], context).carrier === value, true);
});

test("pre-descent roles distinguish the same callable in a native signature and an owned field", () => {
  const value = factory([field("invoke", callback, true), field("stored", callback)]);
  const visits = [];
  const closed = mapRustTargetTypes({ kind: "tuple", elements: [value] }, (carrier, original) => {
    visits.push(original);
    const protocol = rustCallableProtocol(carrier);
    return protocol === undefined ? carrier : rustCallableTargetType(protocol.parameters, protocol.result, lifetime);
  }, rustOwnedStorageChild);
  const native = rustStructuralObjectCarrierValue(closed.elements[0]);
  assert.equal(native.construction === callback, true);
  assert.equal(native.fields[0].type === callback, true);
  assert.equal(rustCallableProtocol(native.fields[1].type).lifetime === lifetime, true);
  assert.equal(visits.filter(carrier => carrier === callback).length, 1, "only the owned slot is traversed");
  assert.equal(visits.filter(carrier => carrier === parameter).length, 1, "signature descendants are not visited");
  assert.equal(rustOwnedStorageChildren(value).length, 1);
  assert.equal(rustOwnedStorageChildren(value)[0] === callback, true);
});

test("child selection preserves native width, authored lifetimes and owned field instantiation independently", () => {
  const reference = { kind: "reference", mutable: false, referent: integer, lifetime };
  const value = factory([field("invoke", callback, true), field("stored", callback), field("borrowed", reference)]);
  const selected = substituteRustTargetGenerics(value, new Map([[parameter.identity, integer]]),
    new Map([[rustLifetimeKey(lifetime), { kind: "static" }]]), new Map(), undefined, rustOwnedStorageChild);
  const native = rustStructuralObjectCarrierValue(selected);
  assert.equal(native.construction === callback, true);
  assert.equal(native.fields.find(field => field.sourceName === "invoke").type === callback, true);
  const storedField = native.fields.find(field => field.sourceName === "stored");
  const borrowedField = native.fields.find(field => field.sourceName === "borrowed");
  assert.equal(rustCallableProtocol(storedField.type).parameters[0].name, "int64");
  assert.equal(rustCallableProtocol(storedField.type).result.name, "int64");
  assert.equal(borrowedField.type.referent.name, "int64");
  assert.equal(borrowedField.type.lifetime.kind, "static");
  const authored = rustCallableTargetType([], reference, lifetime);
  const closed = closeRustSuspendedStorage(factory([field("stored", authored)]), "callable-result");
  const stored = rustStructuralObjectCarrierValue(closed).fields[0].type;
  assert.equal(rustCallableProtocol(stored).lifetime === lifetime, true);
  assert.equal(rustCallableProtocol(stored).result.lifetime === lifetime, true);
});

test("structural child roles account for base slots before exact field indices", () => {
  const value = rustStructuralObjectTargetType("/src/factory.ts", [field("invoke", callback, true), field("stored", callback)],
    "reference", callback, [rustSourceTypeCarrier("/src/base.ts", "Base", "object")]);
  const roles = [];
  rustTargetTypeChildren(value, (_parent, _child, role) => { roles.push(role); return true; });
  assert.deepEqual(roles.map(role => ({ kind: role.kind, ...(role.kind === "structural-field" ? { index: role.index } : {}) })), [
    { kind: "component" }, { kind: "structural-field", index: 0 }, { kind: "structural-field", index: 1 },
    { kind: "structural-construction" },
  ]);
  assert.equal(roles.slice(1).every(role => role.structural.construction === callback), true);
  const children = rustOwnedStorageChildren(value);
  assert.equal(children.length, 2);
  assert.equal(children[0].value.typeName, "Base");
  assert.equal(children[1] === callback, true);
});

test("ordinary structural method storage remains an owned callable without native dispatch evidence", () => {
  const value = rustStructuralObjectTargetType("/src/record.ts", [field("invoke", callback, true)]);
  assert.equal(rustOwnedStorageChildren(value)[0] === callback, true);
  const closed = closeRustSuspendedStorage(value, "callable-result", { kind: "static" });
  assert.equal(rustCallableProtocol(rustStructuralObjectCarrierValue(closed).fields[0].type).lifetime.kind, "static");
});

test("native retained storage never infers static from absent source retention or unknown generic inputs", () => {
  const checked = checkRustSession(createRustSession({ surfaces: [], files: {
    "index.ts": "function owner<Value>(input: Value): Value { return input; }",
  } }));
  const source = createTargetSourceProgram(checked);
  const owner = source.ast.statements(sourceProjectFiles(checked)[0])[0];
  const input = source.ast.parameters(owner)[0];
  const context = {
    ast: source.ast, source,
    sourceLifetimes: { contractFor: () => ({ declaration: owner, parameters: [] }) },
    retainedEnvironments: { environmentFor: () => ({ kind: "none" }) },
  };
  for (const [label, inputs] of [["opaque callable input", [callback]], ["unproved generic input", [parameter]]]) {
    assert.equal(closeRustRetainedResult(owner, callback, inputs, context) === undefined, true,
      `${label}: source none is not native static evidence`);
  }
  assert.equal(closeRustSuspendedStorage(callback, "callable-result") === undefined, true,
    "a missing native construction lifetime is not replaced by a static default");
  const native = rustCallableTargetType([parameter], integer, lifetime);
  assert.equal(closeRustRetainedResult(owner, native, [parameter], context)?.carrier === native, true,
    "an exact opaque native return keeps its authored loan independent of source retention");
  const copied = rustCallableTargetType([], integer, { kind: "static" });
  const borrowed = { kind: "reference", mutable: false, referent: integer, lifetime };
  assert.equal(closeRustRetainedResult(owner, copied, [borrowed], context)?.carrier === copied, true,
    "an actual native copied environment is not constrained by an unrelated formal loan");
  const environment = Object.freeze({ lifetime, inputs: Object.freeze([{ kind: "parameter", declaration: input }]) });
  const retained = closeRustRetainedResult(owner, callback, [parameter], { ...context,
    retainedEnvironments: { environmentFor: () => ({ kind: "selected", environment }) } });
  assert.equal(retained !== undefined, true, "an actual captured generic input uses its exact symbolic environment");
  assert.equal(retained.environment === environment, true, "the one source retention decision is preserved");
  assert.equal(rustCallableProtocol(retained.carrier).lifetime === lifetime, true,
    "a retained free generic input is not silently made static");
  const foreign = closeRustRetainedResult(owner, callback, [parameter], { ...context,
    retainedEnvironments: { environmentFor: () => ({ kind: "selected", environment: { lifetime,
      inputs: [{ kind: "parameter", declaration: {} }] } }) } });
  assert.equal(foreign === undefined, true, "foreign source-retention parameters prove no native environment");
});
