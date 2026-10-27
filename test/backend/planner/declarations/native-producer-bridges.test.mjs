import assert from "node:assert/strict";
import test from "node:test";
import { planRustNativeProducerBridge } from "../../../../dist/backend/planner/declarations/callables/native-producer-bridges.js";
import { createRustNativeCallableProtocolRegistry } from "../../../../dist/analysis/callables/native-protocols.js";
import { emptyRustTypeDefinitions } from "../../../../dist/target-model/types/source-union-definitions.js";
import { createRustTypeDefinitionRegistry } from "../../../../dist/analysis/project-types/type-definitions.js";
import { rustSourcePrimitiveTargetType, rustFutureTargetType, rustJsPromiseTargetType,
  rustSourceOptionalTargetType, rustSourceUnionTargetType, rustSourceUnionCarrierValue, rustCallableTargetType, rustStrTargetType }
  from "../../../../dist/target-model/types/index.js";
import { rustGenericCallableTargetType } from "../../../../dist/target-model/types/carriers/generic-callables.js";
import { rustTargetTypeChildren } from "../../../../dist/target-model/types/carriers/children.js";
import { closedMetadataKey } from "../../../../dist/target-model/metadata/closed-data.js";
import { nativeProducerFixture, nativeProducerItems, printNativeProducerItems }
  from "../../../helpers/native-producer-bridges.mjs";

// A planning context whose sealed native protocol record also answers for `variant` with the analysed protocol's own
// emission, so the planner sees an admitted protocol that differs from the analysed one only in the varied field.
function withProtocolRecord(fixture, variant) {
  const records = fixture.context.input.program.records;
  const emission = records.nativeProtocol.get(fixture.protocol);
  const program = { ...fixture.context.input.program, records: { ...records,
    nativeProtocol: { get: protocol => protocol === variant ? emission : records.nativeProtocol.get(protocol) } } };
  return { ...fixture.context, input: { ...fixture.context.input, program } };
}

const integer = rustSourcePrimitiveTargetType("uint64");
const borrowed = { kind: "reference", referent: rustStrTargetType(), mutable: false };

test("native output unions use the canonical generated declaration and sealed physical payloads", () => {
  const payloads = [borrowed, rustFutureTargetType(borrowed), rustFutureTargetType(integer)];
  const carrier = rustSourceUnionTargetType("/src/index.ts", "Union3", [], "generated",
    { kind: "physical", types: payloads });
  const definitions = createRustTypeDefinitionRegistry();
  assert.equal(definitions.registerSourceUnion({ carrier,
    variants: payloads.map((type, index) => ({ name: `Variant${index}`, carrier: type })),
  }, false), true, "all exact mixed output payloads are admitted by the actual registry");
  const fixture = nativeProducerFixture({ identity: "mixed-output", parameters: [borrowed],
    result: rustSourceOptionalTargetType(carrier), definitions });
  const union = fixture.program.structuralShapes.unionForCarrier(carrier);
  assert.equal(union !== undefined, true, "the native output owns a generated declaration before rendering");
  assert.equal(Object.isFrozen(union), true, "the generated declaration is immutable");
  assert.equal(union.ownerFileName, "/src/index.ts", "the declaration belongs to the actual checked source file");
  assert.equal(fixture.program.records.sourceUnion.get(carrier) === union, true,
    "project emission retains the same canonical generated declaration");
  const emitted = fixture.program.records.typeEmission.get(carrier);
  assert.equal(emitted?.structural?.targetName, union.targetName,
    "TYPE publication names the actual generated declaration");
  assert.equal(emitted.structural.arguments.length, payloads.length,
    "each ready or suspended output retains its physical payload slot");
  const producer = fixture.program.records.nativeProtocol.get(fixture.protocol)?.producer;
  assert.equal(producer !== undefined, true, "the actual native bridge publishes its completed output contract");
  const pending = [producer.concreteResult, producer.implementationResult];
  const seen = new Set();
  let derivedUnion = false;
  for (let index = 0; index < pending.length; index++) {
    const selected = pending[index];
    const key = closedMetadataKey(selected);
    if (seen.has(key)) continue;
    seen.add(key);
    if (rustSourceUnionCarrierValue(selected)?.origin === "generated") {
      assert.equal(fixture.program.records.sourceUnion.get(selected) === union, true,
        "every exact producer-output instantiation retains the same canonical native declaration");
      assert.equal(fixture.program.records.typeEmission.get(selected)?.structural !== undefined, true,
        "the same completed output key owns its physical payload emission");
      if (key !== closedMetadataKey(carrier)) derivedUnion = true;
    }
    pending.push(...rustTargetTypeChildren(selected));
  }
  assert.equal(derivedUnion, true,
    "the native bridge really introduces an output instantiation beyond the original source-carrier scan");
  const printed = printNativeProducerItems(nativeProducerItems(fixture));
  assert.match(printed, /crate::shapes::Union3</u,
    "the native bridge uses the canonical generated declaration module");
  assert.match(printed, /AwaitError0/u, "the first suspended payload retains its independent error channel");
  assert.match(printed, /AwaitError1/u, "the second suspended payload retains its independent error channel");
  assert.doesNotMatch(printed, /TsonicError|TsonicResult|Box|dyn |\.clone\(|'static/u,
    "union admission invents no error erasure, allocation, clone or static lifetime");
});

test("native output union admission refuses a foreign source owner instead of inventing a declaration", () => {
  const payloads = [integer, borrowed];
  const carrier = rustSourceUnionTargetType("/foreign/index.ts", "Union2", [], "generated",
    { kind: "physical", types: payloads });
  const definitions = createRustTypeDefinitionRegistry();
  assert.equal(definitions.registerSourceUnion({ carrier,
    variants: payloads.map((type, index) => ({ name: `Variant${index}`, carrier: type })),
  }, false), true, "the carrier metadata is valid independently of source-package ownership");
  assert.throws(() => nativeProducerFixture({ identity: "foreign-output", result: carrier, definitions }),
    /foreign-output: generated union has its actual source-package owner/u,
    "a valid shape cannot impersonate an absent checked source component");
});

test("producer fixtures preserve the complete sealed native-input contract and exact source-item identity", () => {
  const fixture = nativeProducerFixture({ parameters: [integer], result: integer });
  const native = fixture.program.callableValues.native;
  const protocol = fixture.protocol;
  assert.equal(Object.isFrozen(native), true, "native input plan is sealed");
  for (const method of ["callFor", "inputsFor", "capturesFor", "protocolForSourceItem",
    "isConcreteCallableParameter", "isNativeRetainedParameter"]) {
    assert.equal(typeof native[method], "function", `native input contract includes ${method}`);
  }
  for (const inventory of ["inputs", "calls", "protocols"]) {
    assert.equal(Object.isFrozen(native[inventory]), true, `native ${inventory} inventory is sealed`);
  }
  assert.equal(native.inputs.length, 0, "checked probe has no native input parameters");
  assert.equal(native.calls.length, 0, "checked probe has no native input calls");
  assert.equal(native.protocols.includes(protocol), true, "bound protocol is in the actual registry inventory");
  assert.equal(native.protocolForSourceItem(protocol.ownerFileName, protocol.targetName) === protocol,
    true, "exact source-item owner and name select the bound protocol");
  assert.equal(native.protocolForSourceItem(`${protocol.ownerFileName}.foreign`, protocol.targetName) === undefined,
    true, "another source owner cannot claim the protocol");
  assert.equal(native.protocolForSourceItem(protocol.ownerFileName, `${protocol.targetName}Missing`) === undefined,
    true, "an absent source-item name cannot manufacture a protocol");
  assert.deepEqual(fixture.program.records.sourceTypeIdentity.get(protocol.ownerFileName, protocol.targetName),
    { targetName: protocol.targetName, native: true }, "project admission records the actual native source identity");
  assert.equal(fixture.program.records.sourceTypeIdentity.get(`${protocol.ownerFileName}.foreign`, protocol.targetName) === undefined,
    true, "project admission does not publish a foreign source identity");
});

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
  const unnamed = { ...fixture.protocol, boundProducerName: undefined };
  assert.throws(() => planRustNativeProducerBridge(unnamed, withProtocolRecord(fixture, unnamed)),
    /An admitted higher-ranked producer requires its bound native trait name/u);
});

test("JS completion remains the concrete one-payload Promise without an unconstrained error parameter", () => {
  const fixture = nativeProducerFixture({ parameters: [integer], result: rustSourceOptionalTargetType(
    rustJsPromiseTargetType(integer)),
  });
  const items = nativeProducerItems(fixture);
  assert.equal(items.length, 2);
  assert.deepEqual(items[1].generics.parameters.map(parameter => parameter.name),
    ["Implementation", "InvocationError"]);
  const printed = printNativeProducerItems(items);
  assert.match(printed, /Option<js_abi::JsPromise<u64>>/u);
  assert.doesNotMatch(printed, /impl core::future::Future|Pending0|AwaitError|TsonicError|TsonicResult|'static/u);
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
    rustJsPromiseTargetType(borrowed),
  });
  const items = nativeProducerItems(fixture);
  const printed = printNativeProducerItems(items);
  assert.match(printed, /js_abi::JsPromise<Output0>/u);
  assert.doesNotMatch(printed, /'static|AwaitError|impl core::future::Future|Pending0|Box|dyn /u);
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
  assert.deepEqual(callable.genericArguments[1].type, { kind: "named", path: "Result", identity: "rust.core.Result", genericArguments: [
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
  assert.throws(() => planRustNativeProducerBridge(malformed, withProtocolRecord(fixture, malformed)),
    /An admitted native type requires its exact sealed/u);
});

test("equal checked signatures share a bridge without consulting recipient errors", () => {
  const usedNames = new Set();
  const protocols = createRustNativeCallableProtocolRegistry({ definitions: emptyRustTypeDefinitions, usedNames,
    structuralShapes: { instantiateSourceCarrier() { assert.fail("this scalar bridge fixture has no structural output"); } } });
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
