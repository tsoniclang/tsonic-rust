import assert from "node:assert/strict";
import test from "node:test";
import { isRustTargetTypeRef, rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { substituteRustTargetTypeParameters } from "../../../dist/target-model/types/carriers/substitution.js";
import { inferRustTargetTypeParameterBindings } from "../../../dist/target-model/types/carriers/generic-inference.js";
import { rustTargetGenericReferences } from "../../../dist/target-model/types/carriers/generic-references.js";
import { rustGenericCallableTargetType, rustGenericCallableValue } from "../../../dist/target-model/types/carriers/generic-callables.js";
import { rustGeneratedTypeParameterNames } from "../../../dist/target-model/names/type-parameters.js";
import { rustTypeFromCarrier } from "../../../dist/backend/planner/types/render.js";

const outer = Object.freeze({ kind: "type-parameter", identity: "source:outer/0", name: "T" });
const inner = Object.freeze({ kind: "type-parameter", identity: "source:inner/0", name: "T" });
const integer = Object.freeze({ kind: "source-primitive", name: "int32" });

test("generic semantic identity never collapses equal spellings", () => {
  assert.equal(rustTargetTypeRefEquals(outer, inner), false);
  assert.equal(rustTargetTypeRefEquals(outer, { ...outer, name: "CapturedT" }), true);
  const tuple = { kind: "tuple", elements: [outer, inner] };
  assert.deepEqual(substituteRustTargetTypeParameters(tuple, new Map([[outer.identity, integer]])), {
    kind: "tuple", elements: [integer, inner],
  });
  assert.equal(inferRustTargetTypeParameterBindings(inner, integer, new Set([outer.identity])), undefined);
  assert.deepEqual(inferRustTargetTypeParameterBindings(inner, integer, new Set([inner.identity])), new Map([[inner.identity, integer]]));
  assert.deepEqual(rustTargetGenericReferences(tuple).typeParameters, [outer, inner]);
  assert.equal(isRustTargetTypeRef({ kind: "type-parameter", name: "T" }), false);
  assert.equal(isRustTargetTypeRef({ ...outer, identity: "" }), false);
});

test("quantified signatures remain alpha-equivalent without capturing free parameters", () => {
  const other = { ...inner, identity: "source:other/0", name: "U" };
  const origin = { fileName: "/source.ts", declarationIdentity: "/source.ts:callable" };
  const callable = parameter => rustGenericCallableTargetType([parameter], [parameter, outer], parameter, origin);
  assert.equal(rustTargetTypeRefEquals(callable(inner), callable(other)), true);
  assert.deepEqual(rustTargetGenericReferences(callable(inner)).typeParameters, [outer]);
  assert.deepEqual(rustGenericCallableValue(callable(inner)).environment, [outer]);
  const changed = rustGenericCallableTargetType([other], [other, inner], other, origin);
  assert.equal(rustTargetTypeRefEquals(callable(inner), changed), false);
  const bad = { ...callable(inner), value: { ...callable(inner).value,
    signature: { ...callable(inner).value.signature, typeParameters: ["CallType0"] } } };
  assert.equal(rustGenericCallableValue(bad), undefined);
});

test("generated generic scopes reserve authored binders and render nested references consistently", () => {
  const reserved = { kind: "type-parameter", identity: "source:reserved/0", name: "CapturedT" };
  const names = rustGeneratedTypeParameterNames([outer, reserved], [inner.name]);
  assert.equal(names.get(outer.identity), "CapturedT2");
  assert.equal(names.get(reserved.identity), "CapturedT");
  assert.equal(names.has(inner.identity), false);
  const rendering = { typeParameterNames: names, pathFor: () => undefined, additionalArgumentsFor: () => [] };
  assert.deepEqual(rustTypeFromCarrier(outer), { kind: "named", path: "T" });
  assert.deepEqual(rustTypeFromCarrier(outer, rendering), { kind: "named", path: "CapturedT2" });
  assert.deepEqual(rustTypeFromCarrier(inner, rendering), { kind: "named", path: "T" });
  assert.deepEqual(rustTypeFromCarrier({ kind: "tuple", elements: [outer, inner] }, rendering), {
    kind: "tuple", elements: [{ kind: "named", path: "CapturedT2" }, { kind: "named", path: "T" }],
  });
  assert.equal(outer.name, "T");
  assert.equal(inner.name, "T");
});
