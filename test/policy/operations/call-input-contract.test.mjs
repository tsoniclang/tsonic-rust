import assert from "node:assert/strict";
import test from "node:test";
import { selectJsSurfaceOperation, selectJsSurfaceCallInputContract } from "../../../dist/policy/operations/source-profiles/js/index.js";
import { rustCallableTargetType, rustJsArrayTargetType, rustJsValueTargetType, rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/index.js";
import { rustClosureProtocol } from "../../../dist/target-model/types/index.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";

const integer = rustSourcePrimitiveTargetType("int64");
const boolean = rustSourcePrimitiveTargetType("bool");
const request = {
  ownerName: "Array", memberName: "every", operationKind: "call",
  receiverCarrier: rustJsArrayTargetType(integer),
  argumentCarriers: [rustCallableTargetType([rustJsValueTargetType()], boolean)],
};

test("native input selection retains one exact contract without bypassing call acceptance", () => {
  const selected = selectJsSurfaceCallInputContract(request, 0, emptyRustTypeDefinitions);
  assert.equal(selected?.fact.operationId, "tsonic.rust.js.Array.every.call.value");
  assert.deepEqual(rustClosureProtocol(selected.parameterCarriers[0])?.parameters, [integer]);
  assert.equal(selectJsSurfaceOperation(request) === undefined, true);
  assert.equal(selectJsSurfaceOperation({ ...request,
    argumentCarriers: [rustCallableTargetType([integer], boolean)] })?.fact.operationId, selected.fact.operationId);
});

test("native input selection rejects invalid positions, arity and output contracts", () => {
  for (const position of [-1, 1, NaN, Infinity, 0.5, Number.MAX_VALUE]) {
    assert.equal(selectJsSurfaceCallInputContract(request, position, emptyRustTypeDefinitions) === undefined, true);
  }
  for (const callback of [
    rustCallableTargetType([integer, integer, integer, integer], boolean),
    rustCallableTargetType([integer], integer),
    integer,
  ]) assert.equal(selectJsSurfaceCallInputContract({ ...request, argumentCarriers: [callback] },
    0, emptyRustTypeDefinitions) === undefined, true);
  assert.equal(selectJsSurfaceCallInputContract({ ...request, operationKind: "property" },
    0, emptyRustTypeDefinitions) === undefined, true);
});
