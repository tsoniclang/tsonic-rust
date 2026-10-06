import assert from "node:assert/strict";
import test from "node:test";
import { selectRustCallableOwnershipCarrier } from "../../../dist/analysis/callables/ownership-carriers.js";
import { rustGenericCallableTargetType } from "../../../dist/target-model/types/carriers/generic-callables.js";

const value = { kind: "source-primitive", name: "int32" };
const parameter = { kind: "type-parameter", identity: "owned:T", name: "T" };
const origin = { fileName: "/owned.ts", declarationIdentity: "1:2" };
const carriers = [
  { kind: "function-pointer", abi: "C", args: [value], result: value },
  ...["Fn", "FnMut", "FnOnce"].map(callTrait =>
    ({ kind: "closure", callTrait, args: [value], result: value, fallible: true })),
  rustGenericCallableTargetType([parameter], [parameter], parameter, origin),
];

function input(carrier, selection) {
  return {
    ast: {}, logicalCarrier: carrier,
    subject: { kind: "value", node: {}, projection: [] },
    ownership: { storageFor: () => selection },
    environmentFor: () => assert.fail("ordinary storage must not select a frame environment"),
    instanceFor: () => assert.fail("ordinary storage must not select a frame instance"),
  };
}

test("ordinary native and generic callables preserve their exact authored protocol without a wrapper", () => {
  for (const carrier of carriers) {
    assert.equal(carrier !== undefined, true, "well-formed native callable control");
    const result = selectRustCallableOwnershipCarrier(input(carrier, { kind: "ordinary" }));
    assert.equal(result.kind, "selected");
    assert.equal(result.carrier === carrier, true, "native ABI, call trait, fallibility and binder remain unchanged");
  }
});

test("native callable protocol support never bypasses unresolved ownership or quantified frame rejection", () => {
  for (const carrier of carriers) {
    const result = selectRustCallableOwnershipCarrier(input(carrier,
      { kind: "unresolved", reason: "exact ownership is missing" }));
    assert.equal(result.kind, "unresolved");
    assert.equal(result.reason, "exact ownership is missing");
  }
  const generic = carriers[carriers.length - 1];
  const frame = selectRustCallableOwnershipCarrier(input(generic, { kind: "frame", activation: {} }));
  assert.equal(frame.kind, "unresolved");
  assert.match(frame.reason, /quantified frame/u);
  const invalid = selectRustCallableOwnershipCarrier(input(value, { kind: "ordinary" }));
  assert.equal(invalid.kind, "unresolved", "an ordinary value is not a callable protocol");
});
