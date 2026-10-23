import assert from "node:assert/strict";
import test from "node:test";
import { resolveSourceProfileCarrierFromArguments, selectRustSourceProfileCompletionKind } from "../../../dist/policy/operations/source-profiles/type-carriers.js";
import { rustFutureOutputCarrier } from "../../../dist/target-model/types/carriers/primitives.js";
import { rustJsPromiseOutputTargetType } from "../../../dist/target-model/types/carriers/promises.js";
import { rustSourcePrimitiveTargetType } from "../../../dist/target-model/types/carriers/native.js";

test("early native task demand and full source profile carrier selection share one completion policy", () => {
  const output = rustSourcePrimitiveTargetType("int32");
  for (const name of ["Promise", "PromiseLike"]) for (const jsEnabled of [false, true]) {
    const label = `${name}/${jsEnabled ? "js" : "native"}`;
    assert.equal(selectRustSourceProfileCompletionKind(name, jsEnabled), jsEnabled ? "js-promise" : "native-future",
      label + ": demand selection requires no invented output carrier or later error analysis");
    const carrier = resolveSourceProfileCarrierFromArguments(name, [output], { jsEnabled, sourceErrorCarrier: undefined });
    assert.equal((jsEnabled ? rustJsPromiseOutputTargetType(carrier) : rustFutureOutputCarrier(carrier)) === output, true,
      label + ": the existing full carrier owner consumes the same policy and preserves its real output");
    assert.equal(resolveSourceProfileCarrierFromArguments(name, [], { jsEnabled, sourceErrorCarrier: undefined }) === undefined,
      true, label + ": a known completion family does not invent missing type arguments");
  }
  for (const name of ["Generator", "Array", "Task", "UserPromise"]) {
    assert.equal(selectRustSourceProfileCompletionKind(name, false) === undefined, true,
      name + ": unrelated checked profile identities are not native future approximations");
    assert.equal(selectRustSourceProfileCompletionKind(name, true) === undefined, true,
      name + ": unrelated checked profile identities are not JS Promise approximations");
  }
});
