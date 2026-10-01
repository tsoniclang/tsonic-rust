import assert from "node:assert/strict";
import test from "node:test";
import { createRustSourceCallableAbiResolver } from "../../../dist/policy/ownership/source-callable-abi.js";
import { rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";

test("published native parameter ABI supersedes a pre-finalization missing cache entry", () => {
  const parameter = {};
  const carrier = rustSourcePrimitiveTargetType("int64");
  const abi = Object.freeze({ form: "required", valueCarrier: carrier, parameterCarrier: carrier, mode: "value" });
  let published;
  const resolver = createRustSourceCallableAbiResolver({ isNativeCallableExpression: () => true,
    parameterAbiFor: selected => selected === parameter ? published : undefined });
  assert.equal(resolver.resolveParameterAbi(parameter, {
    ast: { typeNode: () => undefined, as: { AsParameterDeclaration: () => undefined } },
  }, {}, carrier), undefined);
  published = abi;
  const sealedContext = { ast: new Proxy({}, { get() { throw new Error("Published ABI must not query syntax"); } }) };
  assert.equal(resolver.resolveParameterAbi(parameter, sealedContext, {}), abi);
  assert.equal(resolver.resolveParameterAbi(parameter, sealedContext, {}, { ...carrier }), abi);
  assert.equal(resolver.resolveParameterAbi(parameter, sealedContext, {}, rustSourcePrimitiveTargetType("uint64")), undefined);
  assert.equal(resolver.resolveParameterAbi(parameter, sealedContext, {}), abi);
});
