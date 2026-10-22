import assert from "node:assert/strict";
import test from "node:test";
import { withProjectionGenericParameters, requireSourceGenericName } from "../../../../dist/providers/native/projection/utilities.js";
import * as typeArguments from "../../../../dist/providers/native/projection/declarations/type-arguments.js";
import * as typeProjection from "../../../../dist/providers/native/projection/declarations/types.js";

const parameter = (identity, name) => ({ kind: "type", name,
  identity: { itemId: identity, canonicalPath: ["example", identity] }, requirements: [], outlives: [], maybeSized: false });

test("source generic names preserve native identities through shadowing and repeated projection", () => {
  const owner = parameter("owner", "T");
  const method = parameter("method", "T");
  const initial = withProjectionGenericParameters({}, [owner]);
  const scoped = withProjectionGenericParameters(initial, [method]);
  assert.equal(requireSourceGenericName("owner", scoped), "T");
  assert.equal(requireSourceGenericName("method", scoped), "T_2");
  assert.equal(requireSourceGenericName("method", withProjectionGenericParameters(scoped, [method])), "T_2");
  assert.equal(initial.genericNames.has("method"), false);
  assert.throws(() => withProjectionGenericParameters(scoped, [parameter("method", "Other")]), /conflicting native names/u);
  assert.throws(() => requireSourceGenericName("missing", scoped), /no source-visible declaration/u);
  const deeper = withProjectionGenericParameters(scoped, [parameter("other", "T")]);
  assert.equal(requireSourceGenericName("other", deeper), "T_3");
});

test("generic argument and declaration projection has one canonical owner without old forwarding exports", () => {
  for (const name of [
    "sourceGenericArgumentFor",
    "targetGenericArgumentFor",
    "providerGenericParametersFor",
    "providerGenericBindingsFor",
    "sourceGenericParameterNames",
    "sourceGenericParameterArguments",
    "targetGenericParameterArguments",
  ]) {
    assert.equal(typeof typeArguments[name], "function", `${name}: canonical argument owner`);
    assert.equal(Object.hasOwn(typeProjection, name), false, `${name}: old type owner is not an alias`);
  }
});

test("generic projection preserves native type, lifetime and exact const identities and defaults", () => {
  const value = { ...parameter("value", "Value"), defaultType: { kind: "primitive", name: "u64" } };
  const size = { kind: "const", identity: { itemId: "size", canonicalPath: ["example", "size"] },
    name: "Size", type: { kind: "primitive", name: "usize" },
    defaultValue: { kind: "integer", value: "9007199254740993" } };
  const lifetime = { kind: "parameter", identity: { itemId: "held", canonicalPath: ["example", "held"] }, name: "held" };
  const held = { kind: "lifetime", lifetime, outlives: [] };
  const parameters = [held, value, size];
  const context = withProjectionGenericParameters({ imports: new Map() }, parameters);
  const declarations = typeArguments.providerGenericParametersFor(parameters, context);
  const bindings = typeArguments.providerGenericBindingsFor(parameters, context);
  const arguments_ = typeArguments.targetGenericParameterArguments(parameters, context);

  assert.equal(declarations.length, 3, "all native generic kinds remain source-visible");
  assert.equal(declarations[1].defaultType.kind, "source-primitive", "native scalar default remains a scalar");
  assert.equal(declarations[1].defaultType.name, "uint64", "native scalar width is retained");
  assert.equal(declarations[2].defaultType.kind, "bigint-literal", "large native const defaults do not round through Number");
  assert.equal(declarations[2].defaultType.value, "9007199254740993", "authored const metadata is exact");
  assert.equal(bindings[1].targetIdentity, value.identity.itemId, "type binder identity is original");
  assert.equal(bindings[1].defaultArgument.type.name, "uint64", "native type default matches source declaration");
  assert.equal(bindings[2].targetIdentity, size.identity.itemId, "const binder identity is original");
  assert.equal(bindings[2].defaultArgument.value.value, "9007199254740993", "native const default is exact");
  assert.equal(arguments_[0].lifetime.identity, lifetime.identity.itemId, "lifetime binder identity is original");
  assert.equal(arguments_[1].type.identity, value.identity.itemId, "type application uses the original binder");
  assert.equal(arguments_[2].value.identity, size.identity.itemId, "const application uses the original binder");
  const sourceArguments = typeArguments.sourceGenericParameterArguments(parameters, context);
  const names = typeArguments.sourceGenericParameterNames(parameters, context);
  for (const [index, name] of names.entries()) {
    assert.equal(sourceArguments[index].kind, "type-parameter", `${index}: source application remains a parameter`);
    assert.equal(sourceArguments[index].name, name, `${index}: source application uses the canonical name`);
  }
  const nativeConst = typeArguments.targetGenericArgumentFor({ kind: "const", value: size.defaultValue }, context, "parameter");
  assert.equal(nativeConst.value === size.defaultValue, true, "constant projection does not allocate a replacement value");
  assert.throws(() => typeArguments.targetGenericArgumentFor({ kind: "lifetime", lifetime: {
    kind: "elided", ownerIdentity: "function", position: "parameter:0",
  } }, context, "parameter"), /An elided Rust lifetime cannot occupy an explicit generic argument slot/u,
  "an omitted lifetime does not silently become an explicit generic argument");
});
