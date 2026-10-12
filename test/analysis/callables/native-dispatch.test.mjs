import assert from "node:assert/strict";
import test from "node:test";
import { createRustNativeCallableDispatchPlan } from "../../../dist/analysis/callables/native-dispatch.js";

test("native dispatch preserves open and invoked protocols but omits closed forward-only slots", () => {
  const closed = { ownerFileName: "/closed.ts" };
  const invoked = { ownerFileName: "/closed.ts" };
  const open = { ownerFileName: "/open.ts" };
  const plan = createRustNativeCallableDispatchPlan({ ast: { getFileName: file => file.fileName },
    closedSourceFiles: new Set([{ fileName: "/closed.ts" }]),
    native: { protocols: [closed, invoked, open], calls: [{ input: { protocol: invoked } }] } });
  assert.equal(plan.requiredFor(closed), false, "exact closed forward-only protocol");
  assert.equal(plan.requiredFor(invoked), true, "exact invoked protocol");
  assert.equal(plan.requiredFor(open), true, "native public ABI");
  assert.equal(plan.requiredFor({ ...closed }), true, "foreign evidence cannot remove dispatch");
});
