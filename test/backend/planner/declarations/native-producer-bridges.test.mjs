import assert from "node:assert/strict";
import test from "node:test";
import { planRustNativeProducerBridge } from "../../../../dist/backend/planner/declarations/callables/native-producer-bridges.js";
import { createRustNativeCallableProtocolRegistry } from "../../../../dist/analysis/callables/native-protocols.js";
import { emptyRustTypeDefinitions } from "../../../../dist/target-model/types/source-union-definitions.js";
import { rustSourcePrimitiveTargetType, rustFutureTargetType, rustJsPromiseTargetTypeWithLifetime,
  rustSourceOptionalTargetType, rustCallableTargetType, rustStrTargetType }
  from "../../../../dist/target-model/types/index.js";
import { rustGenericCallableTargetType } from "../../../../dist/target-model/types/carriers/generic-callables.js";
import { nativeProducerFixture, nativeProducerItems, printNativeProducerItems }
  from "../../../helpers/native-producer-bridges.mjs";

const integer = rustSourcePrimitiveTargetType("uint64");
const borrowed = { kind: "reference", referent: rustStrTargetType(), mutable: false };

test("unbound protocols receive one exact producer impl without intermediate traits or storage", () => {
  const fixture = nativeProducerFixture({ parameters: [integer], result: integer });
  const items = nativeProducerItems(fixture);
  assert.deepEqual(items.map(item => item.kind), ["trait", "impl"]);
  const implementation = items[1];
  assert.equal(implementation.generics.parameters.length, 2);
  assert.equal(implementation.generics.wherePredicates.length, 1);
  const bound = implementation.generics.wherePredicates[0].bounds[0].reference.trait;
  assert.equal(bound.path, "rt::CallableImplementation");
  assert.equal(bound.genericArguments[1].kind, "associated-equality");
  assert.equal(bound.genericArguments[1].name, "Output");
  assert.equal(bound.genericArguments[1].type.path, "Result");
  assert.equal(bound.genericArguments[1].type.genericArguments[1].type.path, "InvocationError");
  assert.equal(fixture.context.usedAliases.has("rt"), true);
  const printed = printNativeProducerItems(items);
  assert.doesNotMatch(printed, /TsonicError|TsonicResult|From<|Box|dyn |\.clone\(|fn call/u);
  assert.match(printed, /<Implementation as rt::CallableImplementation<\(u64,\)>>::invoke/u);
});

test("native Future output bounds preserve invocation and awaited errors independently", () => {
  const fixture = nativeProducerFixture({ parameters: [integer], result: rustFutureTargetType(integer) });
  const items = nativeProducerItems(fixture);
  assert.equal(items.length, 2);
  const implementation = items[1];
  assert.deepEqual(implementation.generics.parameters.map(parameter => parameter.name),
    ["Implementation", "InvocationError", "AwaitError0", "Pending0"]);
  const pending = implementation.generics.wherePredicates[1];
  assert.equal(pending.type.path, "Pending0");
  assert.equal(pending.bounds[0].reference.trait.path, "core::future::Future");
  const printed = printNativeProducerItems(items);
  assert.match(printed, /Pending0: core::future::Future<Output = Result<u64, AwaitError0>>/u);
  assert.match(printed, /use<Implementation, InvocationError, AwaitError0, Pending0>/u);
  assert.doesNotMatch(printed, /TsonicError|TsonicResult|Box|dyn |\.clone\(|async move/u);
});

test("borrowed inputs add only the reserved lifetime-bound producer helper", () => {
  const fixture = nativeProducerFixture({ parameters: [borrowed], result: rustFutureTargetType(borrowed) });
  const items = nativeProducerItems(fixture);
  assert.deepEqual(items.map(item => item.kind), ["trait", "trait", "impl", "impl"]);
  assert.equal(items[1].name, fixture.protocol.boundProducerName);
  assert.equal(items[1].visibility, "public");
  assert.equal(items[1].generics.parameters[0].kind, "lifetime");
  assert.equal(items[2].generics.parameters[0].kind, "lifetime");
  assert.equal(items[3].generics.wherePredicates[0].binder.length, 1);
  assert.equal(items[3].members[0].generics.parameters.length, 1);
  const printed = printNativeProducerItems(items);
  assert.match(printed, /for<'input> Implementation:/u);
  assert.doesNotMatch(printed, /'static|Box|dyn |\.clone\(|TsonicError/u);
  assert.equal(planRustNativeProducerBridge({ ...fixture.protocol, boundProducerName: undefined }, fixture.context) === undefined, true);
});

test("JS completion remains the concrete Promise carrier with its selected error type", () => {
  const fixture = nativeProducerFixture({ parameters: [integer], result: rustSourceOptionalTargetType(
    rustJsPromiseTargetTypeWithLifetime(integer, { kind: "static" })),
  });
  const items = nativeProducerItems(fixture);
  assert.equal(items.length, 2);
  assert.deepEqual(items[1].generics.parameters.map(parameter => parameter.name),
    ["Implementation", "InvocationError", "AwaitError0"]);
  const printed = printNativeProducerItems(items);
  assert.match(printed, /Option<js_abi::JsPromise<'static, u64, AwaitError0>>/u);
  assert.doesNotMatch(printed, /impl core::future::Future|Pending0|TsonicError|TsonicResult/u);
});

test("borrowed generic environments share exact GAT bounds without imposing a static helper environment", () => {
  const value = { kind: "type-parameter", identity: "source:Value", name: "Value" };
  const reference = { kind: "reference", referent: value, mutable: false };
  for (const result of [reference, rustFutureTargetType(reference)]) {
    const fixture = nativeProducerFixture({ parameters: [reference], result });
    const [protocol, helper, implementation, forwarding] = nativeProducerItems(fixture);
    assert.deepEqual(helper.generics.parameters.map(parameter => parameter.name), ["input", "Arguments", "Output0"]);
    assert.equal(implementation.generics.parameters.some(parameter => parameter.name === "EnvironmentType0"), false);
    const predicates = [{ kind: "type", type: { kind: "named", path: "EnvironmentType0" },
      bounds: [{ kind: "lifetime", lifetime: { kind: "named", name: "input" } }],
    }];
    for (const member of [...protocol.members, ...forwarding.members]) {
      assert.deepEqual(member.generics.wherePredicates, predicates);
    }
    const bound = forwarding.generics.wherePredicates[0].bounds[0].reference.trait;
    assert.equal(bound.genericArguments[1].type.kind, "tuple");
    assert.equal(bound.genericArguments[1].type.elements[0].referent.path, "EnvironmentType0");
    assert.equal(bound.genericArguments[2].type.referent.path, "EnvironmentType0");
    assert.doesNotMatch(printNativeProducerItems([protocol, helper, implementation, forwarding]), /'static|Box|dyn /u);
  }
});

test("borrowed JS completion uses its input lifetime without manufacturing a native future", () => {
  const fixture = nativeProducerFixture({ parameters: [borrowed], result:
    rustJsPromiseTargetTypeWithLifetime(borrowed, { kind: "placeholder" }),
  });
  const items = nativeProducerItems(fixture);
  const printed = printNativeProducerItems(items);
  assert.match(printed, /js_abi::JsPromise<'input, Output0, AwaitError0>/u);
  assert.doesNotMatch(printed, /'static|impl core::future::Future|Pending0|Box|dyn /u);
});

test("environment parameters remain on the protocol while universal methods require their existing state owner", () => {
  const value = { kind: "type-parameter", identity: "source:Value", name: "Value" };
  const fixture = nativeProducerFixture({ parameters: [value], result: value });
  const items = nativeProducerItems(fixture);
  const printed = printNativeProducerItems(items);
  assert.match(printed, /impl<Implementation, EnvironmentType0, InvocationError>/u);
  const callable = items[1].generics.wherePredicates[0].bounds[0].reference.trait;
  assert.equal(callable.path, "rt::CallableImplementation");
  assert.deepEqual(callable.genericArguments[0].type, { kind: "tuple", elements: [{ kind: "named", path: "EnvironmentType0" }] });
  assert.deepEqual(callable.genericArguments[1].type, { kind: "named", path: "Result", genericArguments: [
    { kind: "type", type: { kind: "named", path: "EnvironmentType0" } },
    { kind: "type", type: { kind: "named", path: "InvocationError" } },
  ] });
  const generic = nativeProducerFixture({ carrier: rustGenericCallableTargetType([value], [value], value,
    { fileName: "/index.ts", declarationIdentity: "universal" }) });
  assert.deepEqual(planRustNativeProducerBridge(generic.protocol, generic.context), []);
});

test("bridge planning fails closed on an unrenderable input instead of guessing a producer", () => {
  const fixture = nativeProducerFixture({ parameters: [integer], result: integer });
  const malformed = { ...fixture.protocol, method: { ...fixture.protocol.method,
    parameters: [{ kind: "target-named", id: "unavailable.native.carrier" }],
  } };
  assert.equal(planRustNativeProducerBridge(malformed, fixture.context) === undefined, true);
});

test("equal checked signatures share a bridge without consulting recipient errors", () => {
  const usedNames = new Set();
  const protocols = createRustNativeCallableProtocolRegistry({ definitions: emptyRustTypeDefinitions, usedNames });
  const carrier = rustCallableTargetType([integer], integer);
  const first = nativeProducerFixture({ carrier, identity: "left", protocols });
  const second = nativeProducerFixture({ carrier, identity: "right", protocols });
  assert.equal(first.protocol === second.protocol, true);
  assert.equal(protocols.definitions().length, 1);
  const expected = printNativeProducerItems(nativeProducerItems(first));
  first.context.sourcePackageErrors = new Proxy({}, { get() { throw Error("ambient boundary consulted"); } });
  first.context.fallibleBoundary = new Proxy({}, { get() { throw Error("active boundary consulted"); } });
  assert.equal(printNativeProducerItems(nativeProducerItems(first)), expected);
  const left = planRustNativeProducerBridge(first.protocol, first.context);
  const right = planRustNativeProducerBridge(second.protocol, second.context);
  assert.equal(left[0].trait.path === right[0].trait.path, true);
  assert.deepEqual(left[0].generics, right[0].generics);
});
