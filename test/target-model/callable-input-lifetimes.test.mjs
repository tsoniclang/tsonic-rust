import assert from "node:assert/strict";
import test from "node:test";
import { bindRustCallableInputLifetimes } from "../../dist/target-model/types/carriers/callable-input-lifetimes.js";
import { rustTargetTypeRefEquals } from "../../dist/target-model/types/equality.js";

const unit = { kind: "unit" };
const integer = { kind: "source-primitive", name: "int32" };
const borrow = (lifetime) => ({ kind: "reference", referent: integer, mutable: false,
  ...(lifetime === undefined ? {} : { lifetime }) });

test("invocation-only borrowed inputs bind independent native lifetimes", () => {
  const selected = bindRustCallableInputLifetimes([borrow(), borrow({ kind: "placeholder" })], unit);
  assert.equal(selected !== undefined, true, "closed native higher-ranked input");
  assert.equal(selected.binder.parameters.length, 2);
  assert.notEqual(selected.parameters[0].lifetime.identity, selected.parameters[1].lifetime.identity);
  assert.equal(selected.binder.parameters.some(parameter => parameter.lifetime.kind === "static"), false);
});

test("invocation-only lifetime binding preserves explicit and nested native binders", () => {
  const explicit = { kind: "parameter", identity: "explicit", name: "input" };
  const nestedLifetime = { kind: "bound", binderIdentity: "nested", identity: "nested:input", name: "input" };
  const nested = { kind: "function-pointer", args: [borrow(nestedLifetime)], result: borrow(nestedLifetime),
    lifetimeBinder: { identity: "nested", parameters: [{ lifetime: nestedLifetime, outlives: [] }] } };
  const selected = bindRustCallableInputLifetimes([borrow(explicit), nested, borrow()], unit);
  assert.equal(selected !== undefined, true, "explicit and nested binder scopes remain closed");
  assert.equal(selected.binder.parameters.length, 1);
  assert.notEqual(selected.binder.parameters[0].lifetime.name, explicit.name);
  assert.equal(rustTargetTypeRefEquals(selected.parameters[0], borrow(explicit)), true);
  assert.equal(rustTargetTypeRefEquals(selected.parameters[1], nested), true);
});

test("invocation-only result elision requires one exact native input lifetime", () => {
  const selected = bindRustCallableInputLifetimes([borrow()], borrow());
  assert.equal(selected !== undefined, true, "one native elided input determines the result");
  assert.equal(selected.parameters[0].lifetime.identity, selected.result.lifetime.identity);
  const explicit = { kind: "parameter", identity: "explicit:output", name: "output" };
  const explicitSelected = bindRustCallableInputLifetimes([borrow(explicit), borrow(explicit)], borrow());
  assert.equal(explicitSelected !== undefined, true, "one explicit native input lifetime remains authoritative");
  assert.equal(explicitSelected.binder.parameters.length, 0);
  assert.equal(explicitSelected.result.lifetime.identity, explicit.identity);
  assert.equal(bindRustCallableInputLifetimes([], borrow()) === undefined, true, "no invented output lifetime");
  assert.equal(bindRustCallableInputLifetimes([borrow(), borrow()], borrow()) === undefined, true,
    "ambiguous native output lifetimes reject");
});
