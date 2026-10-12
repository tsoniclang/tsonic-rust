import assert from "node:assert/strict";
import test from "node:test";
import { createRustNativeCallableDispatchPlan } from "../../../dist/analysis/callables/native-dispatch.js";

test("native dispatch preserves open and invoked protocols but omits closed forward-only slots", () => {
  const closed = { ownerFileName: "/closed.ts" };
  const invoked = { ownerFileName: "/closed.ts" };
  const open = { ownerFileName: "/open.ts" };
  const plan = createRustNativeCallableDispatchPlan({ ast: { getFileName: file => file.fileName },
    closedSourceFiles: new Set([{ fileName: "/closed.ts" }]),
    navigation: { declarationUses: () => [] },
    native: { protocols: [closed, invoked, open], inputs: [], calls: [{ input: { protocol: invoked } }] } });
  assert.equal(plan.requiredFor(closed), false, "exact closed forward-only protocol");
  assert.equal(plan.requiredFor(invoked), true, "exact invoked protocol");
  assert.equal(plan.requiredFor(open), true, "native public ABI");
  assert.equal(plan.requiredFor({ ...closed }), true, "foreign evidence cannot remove dispatch");
});

test("implicit runtime invocation retains dispatch; only exact direct returns omit it", () => {
  const reference = {};
  const direct = { kind: "return", expression: reference };
  const indirect = { kind: "return", expression: {} };
  const parameter = {};
  const protocol = { ownerFileName: "/closed.ts" };
  const ast = { getFileName: file => file.fileName, parent: () => direct,
    is: { IsExpressionStatement: () => false, IsReturnStatement: node => node.kind === "return" },
    as: { AsReturnStatement: node => ({ Expression: node.expression }) } };
  const input = { ast, closedSourceFiles: new Set([{ fileName: "/closed.ts" }]),
    navigation: { declarationUses: subject => subject === parameter ? [{ reference }] : [] },
    native: { protocols: [protocol], calls: [], inputs: [{ subject: { node: parameter }, protocol }] } };
  assert.equal(createRustNativeCallableDispatchPlan(input).requiredFor(protocol), false, "exact forwarding only");
  for (const parent of [undefined, { kind: "call" }, indirect]) {
    const plan = createRustNativeCallableDispatchPlan({ ...input, ast: { ...ast, parent: () => parent } });
    assert.equal(plan.requiredFor(protocol), true, "runtime, unresolved or indirect use retains its ABI");
  }
});
