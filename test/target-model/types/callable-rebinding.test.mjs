import assert from "node:assert/strict";
import test from "node:test";
import { rebindRustCallableCarrier } from "../../../dist/target-model/types/carriers/callable-rebinding.js";
import { rustCallableTargetType, rustCallableProtocol } from "../../../dist/target-model/types/carriers/callables.js";
import { rustFrameCallableTargetType, rustFrameCallableValue } from "../../../dist/target-model/types/carriers/frame-callables.js";
import { rustGenericCallableTargetType, rustGenericCallableProtocol, rustGenericCallableValue } from "../../../dist/target-model/types/carriers/generic-callables.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { rustCarrierSupportsClone } from "../../../dist/target-model/types/carriers/traits.js";

const int32 = rustSourcePrimitiveTargetType("int32");
const int64 = rustSourcePrimitiveTargetType("int64");
const bool = rustSourcePrimitiveTargetType("bool");
const owner = { fileName: "/project/index.ts", declarationIdentity: "owner" };

test("finalizing a callable signature preserves native representation and frame activation identity", () => {
  const frame = rustFrameCallableTargetType([int32], int32, owner);
  const sources = [rustCallableTargetType([int32], int32), frame,
    { kind: "function-pointer", args: [int32], result: int32, abi: ["C"], isUnsafe: true },
    { kind: "closure", args: [int32], result: int32, callTrait: "FnMut", fallible: true }];
  for (const source of sources) {
    const selected = rebindRustCallableCarrier(source, [int64], bool);
    assert.equal(selected !== undefined, true);
    assert.equal(selected.kind, source.kind);
    const protocol = rustCallableProtocol(selected) ?? { parameters: selected.args, result: selected.result };
    assert.equal(rustTargetTypeRefEquals(protocol.parameters[0], int64), true);
    assert.equal(rustTargetTypeRefEquals(protocol.result, bool), true);
    assert.equal(Object.isFrozen(selected), true);
    if (source === frame) {
      assert.equal(rustFrameCallableValue(selected)?.owner.declarationIdentity, "owner");
      assert.equal(rustCarrierSupportsClone(selected), true, "frame root cloning does not require cloning its captures");
    }
    if (source.kind === "function-pointer") {
      assert.deepEqual(selected.abi, ["C"]);
      assert.equal(selected.isUnsafe, true);
    }
    if (source.kind === "closure") {
      assert.equal(selected.callTrait, "FnMut");
      assert.equal(selected.fallible, true);
    }
  }
});

test("generic and frame signature finalization retain body-only captured type bindings", () => {
  const parameter = { kind: "type-parameter", name: "Value", identity: "source:Value" };
  const captured = { kind: "type-parameter", name: "Captured", identity: "source:Captured" };
  const generic = rustGenericCallableTargetType([parameter], [parameter], parameter, owner, [captured]);
  const selected = rebindRustCallableCarrier(generic, [parameter, int64], bool,
    { typeParameters: [parameter] });
  assert.equal(selected !== undefined, true);
  const protocol = rustGenericCallableProtocol(selected, [int32]);
  assert.equal(rustTargetTypeRefEquals(protocol.parameters[0], int32), true);
  assert.equal(rustTargetTypeRefEquals(protocol.parameters[1], int64), true);
  assert.equal(rustTargetTypeRefEquals(protocol.result, bool), true);
  assert.equal(rustGenericCallableValue(selected).environment.some(type => type.identity === captured.identity), true);
  const frame = rustFrameCallableTargetType([int32], int32, owner, [captured]);
  const rebound = rebindRustCallableCarrier(frame, [int64], bool);
  assert.equal(rustFrameCallableValue(rebound).environment.some(type => type.identity === captured.identity), true);
});

test("signature finalization rejects malformed carriers and forbidden representation changes", () => {
  const frame = rustFrameCallableTargetType([int32], int32, owner);
  const sparse = new Array(1);
  assert.equal(rebindRustCallableCarrier(frame, sparse, bool) === undefined, true);
  assert.equal(rebindRustCallableCarrier(int32, [int32], bool) === undefined, true);
  assert.equal(rebindRustCallableCarrier(frame, [int32], bool, { environment: [] }) === undefined, true);
  assert.equal(rebindRustCallableCarrier(frame, [int32], bool, { typeParameters: [
    { kind: "type-parameter", name: "Value", identity: "source:Value" },
  ] }) === undefined, true);
  let evaluated = false;
  const parameters = [];
  Object.defineProperty(parameters, "0", { get() { evaluated = true; return int32; } });
  assert.equal(rebindRustCallableCarrier(frame, parameters, bool) === undefined, true);
  assert.equal(evaluated, false);
  const options = {};
  Object.defineProperty(options, "environment", { get() { evaluated = true; return []; } });
  assert.equal(rebindRustCallableCarrier(frame, [int32], bool, options) === undefined, true);
  assert.equal(rebindRustCallableCarrier(frame, [int32], bool, { typeParameters: null }) === undefined, true);
  assert.equal(rebindRustCallableCarrier(frame, [int32], bool, { extra: true }) === undefined, true);
  assert.equal(evaluated, false);
});
