import assert from "node:assert/strict";
import test from "node:test";
import { planRustProjectFieldDispatchRole, planRustProjectFieldDispatchRoles } from "../../../../dist/backend/planner/objects/project-field-dispatch.js";

test("an infallible read does not request a fallible setter's enclosing ABI", () => {
  const plan = { declaration: {}, readonly: false,
    read: { selfMode: "ref", fallible: false }, write: { selfMode: "rc", fallible: true } };
  assert.deepEqual(planRustProjectFieldDispatchRole(plan, "read", {}), { selfMode: "ref", fallible: false });
});

test("a readonly field has no fabricated writable role", () => {
  const plan = { declaration: {}, readonly: true, read: { selfMode: "ref", fallible: false } };
  assert.equal(planRustProjectFieldDispatchRole(plan, "write", {}), undefined);
  assert.deepEqual(planRustProjectFieldDispatchRoles(plan, {}), { read: { selfMode: "ref", fallible: false } });
});

test("paired infallible field access preserves the independent receiver modes", () => {
  const plan = { declaration: {}, readonly: false,
    read: { selfMode: "rc", fallible: false }, write: { selfMode: "ref", fallible: false } };
  assert.deepEqual(planRustProjectFieldDispatchRoles(plan, {}), { read: plan.read, write: plan.write });
});
