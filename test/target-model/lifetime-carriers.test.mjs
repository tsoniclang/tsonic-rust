import assert from "node:assert/strict";
import { test } from "node:test";

import { rustLifetimeKey } from "../../dist/target-model/lifetimes/index.js";
import {
  substituteRustTargetGenerics,
} from "../../dist/target-model/types/carriers/substitution.js";
import {
  isRustTargetTypeRef,
  rustTargetTypeRefEquals,
  rustTargetTypeRefEqualsWithinLifetimeBinders,
} from "../../dist/target-model/types/equality.js";

const int32 = Object.freeze({ kind: "source-primitive", name: "int32" });
const parameterLifetime = (identity, name) => ({ kind: "parameter", identity, name });
const boundLifetime = (binderIdentity, identity, name) => ({
  kind: "bound",
  binderIdentity,
  identity,
  name,
});
const lifetimeBinder = (identity, lifetime, outlives = []) => ({
  identity,
  parameters: [{ lifetime, outlives }],
});
const reference = (lifetime, referent = int32, mutable = false) => ({
  kind: "reference",
  referent,
  mutable,
  lifetime,
});

test("higher-ranked lifetime carriers compare by alpha-equivalent binder identity", () => {
  const leftLifetime = boundLifetime("left-binder", "left-a", "a");
  const rightLifetime = boundLifetime("right-binder", "right-value", "value");
  const left = {
    kind: "function-pointer",
    lifetimeBinder: lifetimeBinder("left-binder", leftLifetime),
    args: [reference(leftLifetime)],
    result: reference(leftLifetime),
  };
  const right = {
    kind: "function-pointer",
    lifetimeBinder: lifetimeBinder("right-binder", rightLifetime),
    args: [reference(rightLifetime)],
    result: reference(rightLifetime),
  };

  assert.equal(isRustTargetTypeRef(left), true);
  assert.equal(isRustTargetTypeRef(right), true);
  assert.equal(rustTargetTypeRefEquals(left, right), true);
  assert.equal(
    rustTargetTypeRefEqualsWithinLifetimeBinders(
      left.args[0],
      right.args[0],
      left.lifetimeBinder,
      right.lifetimeBinder,
    ),
    true,
  );
  assert.equal(
    rustTargetTypeRefEqualsWithinLifetimeBinders(
      left.args[0],
      reference({ kind: "static" }),
      left.lifetimeBinder,
      right.lifetimeBinder,
    ),
    false,
  );
  assert.equal(
    rustTargetTypeRefEquals(left, {
      ...right,
      result: reference({ kind: "static" }),
    }),
    false,
  );
});

test("trait-reference equality includes exact paths, mixed arguments, and associated constraints", () => {
  const lifetime = parameterLifetime("lifetime-a", "a");
  const carrier = {
    kind: "trait-ref",
    id: "acme.Family",
    path: "acme::Family",
    genericArguments: [
      { kind: "lifetime", lifetime },
      { kind: "type", type: int32 },
      { kind: "const", value: { kind: "integer", value: "4" } },
    ],
    associatedConstraints: [{
      kind: "equality",
      identity: "acme.Family.Item",
      name: "Item",
      genericArguments: [{ kind: "lifetime", lifetime }],
      type: reference(lifetime),
    }],
  };

  assert.equal(isRustTargetTypeRef(carrier), true);
  assert.equal(rustTargetTypeRefEquals(carrier, structuredClone(carrier)), true);
  assert.equal(
    rustTargetTypeRefEquals(carrier, { ...carrier, path: "other::Family" }),
    false,
  );
  assert.equal(
    rustTargetTypeRefEquals(carrier, {
      ...carrier,
      associatedConstraints: [{
        ...carrier.associatedConstraints[0],
        type: reference({ kind: "static" }),
      }],
    }),
    false,
  );
});

test("generic substitution replaces free lifetimes without capturing higher-ranked binders", () => {
  const outer = parameterLifetime("outer-a", "a");
  const bound = boundLifetime("callable-binder", "bound-a", "a");
  const carrier = {
    kind: "function-pointer",
    lifetimeBinder: lifetimeBinder("callable-binder", bound, [outer]),
    args: [reference(bound), reference(outer)],
    result: reference(outer),
  };
  const substituted = substituteRustTargetGenerics(
    carrier,
    new Map(),
    new Map([
      [rustLifetimeKey(outer), { kind: "static" }],
      [rustLifetimeKey(bound), { kind: "placeholder" }],
    ]),
  );

  assert.equal(substituted.kind, "function-pointer");
  assert.deepEqual(substituted.lifetimeBinder.parameters[0].lifetime, bound);
  assert.deepEqual(substituted.lifetimeBinder.parameters[0].outlives, [{ kind: "static" }]);
  assert.deepEqual(substituted.args[0].lifetime, bound);
  assert.deepEqual(substituted.args[1].lifetime, { kind: "static" });
  assert.deepEqual(substituted.result.lifetime, { kind: "static" });
});

test("malformed, duplicate, and wrong-kind lifetime carrier shapes fail closed", () => {
  const bound = boundLifetime("binder", "a", "a");
  const invalid = [
    {
      kind: "function-pointer",
      lifetimeBinder: lifetimeBinder("other-binder", bound),
      args: [reference(bound)],
      result: int32,
    },
    {
      kind: "trait-ref",
      id: "acme.Family",
      path: "acme::Family",
      genericArguments: [],
      associatedConstraints: [
        {
          kind: "equality",
          identity: "duplicate",
          name: "Item",
          genericArguments: [],
          type: int32,
        },
        {
          kind: "bounds",
          identity: "duplicate",
          name: "Item",
          genericArguments: [],
          traits: [],
          outlives: [],
        },
      ],
    },
    {
      kind: "trait-ref",
      id: "acme.Family",
      genericArguments: [],
      associatedConstraints: [],
    },
    {
      kind: "target-named",
      id: "acme.Value",
      genericArguments: [{ kind: "lifetime", lifetime: int32 }],
    },
    {
      kind: "trait-object",
      principal: int32,
      autoTraits: [],
    },
    {
      kind: "impl-trait",
      id: "acme.impl",
      bounds: [int32],
      outlives: [],
      captures: [],
    },
    {
      kind: "associated-type",
      owner: int32,
      trait: int32,
      name: "Item",
    },
  ];

  for (const carrier of invalid) {
    assert.equal(isRustTargetTypeRef(carrier), false);
  }
});
