import assert from "node:assert/strict";
import test from "node:test";
import { rustGenericCallableTargetType, rustGenericCallableValue } from "../../dist/target-model/types/carriers/generic-callables.js";
import { rustFrameCallableTargetType } from "../../dist/target-model/types/carriers/frame-callables.js";
import { rustSourceTypeCarrier } from "../../dist/target-model/types/carriers/source-types.js";
import { inferRustTargetTypeParameterBindings } from "../../dist/target-model/types/carriers/generic-inference.js";
import { substituteRustTargetTypeParameters } from "../../dist/target-model/types/carriers/substitution.js";

const parameter = identity => ({ kind: "type-parameter", identity, name: "Value" });
const free = parameter("source:factory/Value");
const bound = parameter("source:method/Value");
const integer = { kind: "source-primitive", name: "int32" };
const boolean = { kind: "source-primitive", name: "bool" };
const origin = { fileName: "/factory.ts", declarationIdentity: "/factory.ts:method" };
const selected = new Set([free.identity]);
const concrete = carrier => substituteRustTargetTypeParameters(carrier, new Map([[free.identity, integer]]));

test("quantified callable inference binds only its existing free environment", () => {
  const carrier = rustGenericCallableTargetType([bound], [bound, free], free, origin);
  assert.equal(carrier !== undefined, true);
  assert.deepEqual(inferRustTargetTypeParameterBindings(carrier, concrete(carrier), selected), new Map([[free.identity, integer]]));
  assert.equal(inferRustTargetTypeParameterBindings(carrier, concrete(carrier), new Set([bound.identity])), undefined);
  const otherOrigin = rustGenericCallableTargetType([bound], [bound, integer], integer,
    { ...origin, declarationIdentity: "/factory.ts:different" });
  assert.equal(inferRustTargetTypeParameterBindings(carrier, otherOrigin, selected), undefined);
  const otherSignature = rustGenericCallableTargetType([bound], [bound, integer], boolean, origin);
  assert.equal(inferRustTargetTypeParameterBindings(carrier, otherSignature, selected), undefined);
  const binding = rustGenericCallableValue(concrete(carrier));
  assert.equal(inferRustTargetTypeParameterBindings(carrier, { ...concrete(carrier), value: {
    ...binding, environment: [integer, boolean],
  } }, selected), undefined);
});

test("lexical and class frame inference preserves exact activation and environment", () => {
  const lexical = rustFrameCallableTargetType([free], free, { kind: "lexical", origin });
  const instance = rustSourceTypeCarrier(origin.fileName, "Owner", "object", [{ kind: "type", type: free }]);
  const member = rustFrameCallableTargetType([free], free, { kind: "class", origin, instance });
  for (const carrier of [lexical, member]) {
    assert.equal(carrier !== undefined, true);
    assert.deepEqual(inferRustTargetTypeParameterBindings(carrier, concrete(carrier), selected), new Map([[free.identity, integer]]));
    assert.equal(inferRustTargetTypeParameterBindings(carrier, concrete(carrier), new Set()), undefined);
    const otherOwner = rustFrameCallableTargetType([integer], integer, { kind: "lexical", origin: {
      ...origin, declarationIdentity: "/factory.ts:other-frame",
    } });
    assert.equal(inferRustTargetTypeParameterBindings(carrier, otherOwner, selected), undefined);
  }
  assert.equal(inferRustTargetTypeParameterBindings(lexical, concrete(member), selected), undefined);
  const otherInstance = rustSourceTypeCarrier(origin.fileName, "Other", "object", [{ kind: "type", type: integer }]);
  const otherMember = rustFrameCallableTargetType([integer], integer, { kind: "class", origin, instance: otherInstance });
  assert.equal(inferRustTargetTypeParameterBindings(member, otherMember, selected), undefined);
});
