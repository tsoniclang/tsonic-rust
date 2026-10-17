import assert from "node:assert/strict";
import test from "node:test";
import { rustCallableTargetType, rustCallableProtocol } from "../../dist/target-model/types/carriers/callables.js";
import { rebindRustCallableCarrier } from "../../dist/target-model/types/carriers/callable-rebinding.js";
import { rustNamedTargetType } from "../../dist/target-model/types/carriers/native.js";
import { rustCallablePhysicalSignature } from "../../dist/target-model/conversions/callable-physical.js";
import { selectRustCallableConversion } from "../../dist/target-model/conversions/callable.js";
import { rustNativeRepresentationMatches } from "../../dist/target-model/conversions/native-representation.js";
import { rustTargetTypeRefEquals } from "../../dist/target-model/types/equality.js";

const integer = { kind: "source-primitive", name: "int32" };
const unit = { kind: "tuple", elements: [] };
const region = { kind: "parameter", identity: "owner:region", name: "region" };
const argument = type => ({ kind: "type", type });

test("ordinary Callable has one explicit environment independent from its invocation signature", () => {
  const selected = rustCallableTargetType([integer], unit, region);
  const protocol = rustCallableProtocol(selected);
  assert.equal(protocol.lifetime, region);
  assert.equal(rustCallableProtocol(rustCallableTargetType([integer], unit)).lifetime.kind, "placeholder");
  const rebound = rebindRustCallableCarrier(selected, [unit], integer);
  assert.equal(rustCallableProtocol(rebound).lifetime.identity, region.identity);
  assert.equal(rustTargetTypeRefEquals(rustCallableProtocol(rebound).result, integer), true);
  assert.equal(rustCallableProtocol({ ...selected, genericArguments: selected.genericArguments.slice(1) }) === undefined, true,
    "superseded lifetime-free Callable contract rejects");
});

test("physical Callable preserves nonstatic nonClone error payloads without imposing traits", () => {
  const error = { kind: "reference", mutable: false, lifetime: region, referent: integer };
  const result = rustNamedTargetType("rust.core.Result", "Result", [argument(integer), argument(error)], [], undefined, [], undefined, []);
  const selected = rustNamedTargetType("rust.runtime.Callable", "rt::Callable", [
    { kind: "lifetime", lifetime: region }, argument(unit), argument(result),
  ], [], undefined, [], undefined, []);
  const signature = rustCallablePhysicalSignature(selected);
  assert.equal(signature !== undefined, true);
  assert.equal(rustTargetTypeRefEquals(signature.error, error), true);
  assert.equal(rustTargetTypeRefEquals(signature.result, integer), true);
  assert.equal(signature.parameters.length, 0);
  const stale = rustNamedTargetType("rust.runtime.Callable", "rt::Callable", [argument(unit), argument(result)], [], undefined, [], undefined, []);
  assert.equal(rustCallablePhysicalSignature(stale) === undefined, true);
});

test("native environment inference cannot allocate a redundant invocation adapter or erase a borrow", () => {
  const selected = rustCallableTargetType([], integer, region);
  const inferred = rustCallableTargetType([], integer);
  assert.equal(rustNativeRepresentationMatches(selected, inferred), true);
  assert.equal(selectRustCallableConversion(selected, inferred, () => undefined) === undefined, true,
    "a native lifetime-only transition has no new closure allocation");
  assert.equal(rustNativeRepresentationMatches(selected, rustCallableTargetType([], integer, { kind: "static" })), false,
    "a retained external borrow never becomes static");
});
