import assert from "node:assert/strict";
import test from "node:test";
import { rustCallableProtocol, rustCallableTargetType, rustUnitTargetType, rustSourcePrimitiveTargetType,
  rustJsValueTargetType } from "../../dist/target-model/types/index.js";
import { rustStaticLifetime } from "../../dist/target-model/lifetimes/index.js";
import { rustTypeFromCarrier } from "../../dist/backend/planner/types/carrier-syntax.js";
import { printRustType } from "../../dist/print/source/types.js";
import { rebindRustCallableCarrier } from "../../dist/policy/types/callables/method-values.js";
import { rustCallableInvocationSignaturesMatch } from "../../dist/policy/conversions/callable-input.js";

test("owned callable carriers have one explicit error slot and reject the superseded arity", () => {
  const result = rustSourcePrimitiveTargetType("uint64");
  const carrier = rustCallableTargetType([], result, rustStaticLifetime, rustJsValueTargetType());
  assert.equal(carrier.genericArguments.length, 4);
  assert.equal(rustCallableProtocol(carrier)?.error.id, rustJsValueTargetType().id);
  assert.equal(rustCallableProtocol({ ...carrier, genericArguments: carrier.genericArguments.slice(0, 3) }) === undefined, true);
  assert.equal(printRustType(rustTypeFromCarrier(carrier)), "rt::Callable<'static, (), Result<u64, js_abi::JsValue>>");
  const rebound = rebindRustCallableCarrier(carrier, [rustUnitTargetType()], result);
  assert.equal(rustCallableProtocol(rebound)?.error.id, rustJsValueTargetType().id);
});

test("native callbacks retain their package result and cannot masquerade as JS-rejection callbacks", () => {
  const result = rustSourcePrimitiveTargetType("uint64");
  const native = rustCallableTargetType([], result, rustStaticLifetime);
  const js = rustCallableTargetType([], result, rustStaticLifetime, rustJsValueTargetType());
  assert.equal(printRustType(rustTypeFromCarrier(native)), "rt::Callable<'static, (), rt::TsonicResult<u64>>");
  assert.equal(rustCallableInvocationSignaturesMatch(native, js), false);
  assert.equal(rustCallableInvocationSignaturesMatch(js, js), true);
});
