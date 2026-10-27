import assert from "node:assert/strict";
import test from "node:test";
import { bindRustCallableInputLifetimes } from "../../dist/target-model/types/carriers/callable-input-lifetimes.js";
import { rustTargetTypeRefEquals } from "../../dist/target-model/types/equality.js";
import { rustCallableTargetType } from "../../dist/target-model/types/carriers/callables.js";

const unit = { kind: "unit" };
const integer = { kind: "source-primitive", name: "int32" };
const borrow = (lifetime) => ({ kind: "reference", referent: integer, mutable: false,
  ...(lifetime === undefined ? {} : { lifetime }) });
const invocation = { kind: "invocation" };

test("invocation-only borrowed inputs bind independent native lifetimes", () => {
  const selected = bindRustCallableInputLifetimes([borrow(), borrow({ kind: "placeholder" })], unit, { kind: "invocation" });
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
  const selected = bindRustCallableInputLifetimes([borrow(explicit), nested, borrow()], unit, { kind: "invocation" });
  assert.equal(selected !== undefined, true, "explicit and nested binder scopes remain closed");
  assert.equal(selected.binder.parameters.length, 1);
  assert.notEqual(selected.binder.parameters[0].lifetime.name, explicit.name);
  assert.equal(rustTargetTypeRefEquals(selected.parameters[0], borrow(explicit)), true);
  assert.equal(rustTargetTypeRefEquals(selected.parameters[1], nested), true);
});

test("invocation-only result elision requires one exact native input lifetime", () => {
  const selected = bindRustCallableInputLifetimes([borrow()], borrow(), { kind: "invocation" });
  assert.equal(selected !== undefined, true, "one native elided input determines the result");
  assert.equal(selected.parameters[0].lifetime.identity, selected.result.lifetime.identity);
  const explicit = { kind: "parameter", identity: "explicit:output", name: "output" };
  const explicitSelected = bindRustCallableInputLifetimes([borrow(explicit), borrow(explicit)], borrow(), { kind: "invocation" });
  assert.equal(explicitSelected !== undefined, true, "one explicit native input lifetime remains authoritative");
  assert.equal(explicitSelected.binder.parameters.length, 0);
  assert.equal(explicitSelected.result.lifetime.identity, explicit.identity);
  assert.equal(bindRustCallableInputLifetimes([], borrow(), { kind: "invocation" }) === undefined, true, "no invented output lifetime");
  assert.equal(bindRustCallableInputLifetimes([borrow(), borrow()], borrow(), { kind: "invocation" }) === undefined, true,
    "ambiguous native output lifetimes reject");
});

test("owned output lifetime binding requires its exact closed output contract without rewriting bare borrows", () => {
  const lifetime = { kind: "parameter", identity: "owned:environment", name: "environment" };
  const result = rustCallableTargetType([], integer);
  const closed = rustCallableTargetType([], integer, lifetime);
  const selected = bindRustCallableInputLifetimes([], result, { kind: "owned-output", carrier: closed });
  assert.equal(selected !== undefined && selected.ownedOutput && selected.binder.parameters.length === 0, true,
    "an owned item output is selected without an invented invocation lifetime");
  assert.equal(rustTargetTypeRefEquals(selected.result, closed), true, "the exact already-selected named output contract is retained");
  assert.equal(bindRustCallableInputLifetimes([], borrow(), { kind: "owned-output", carrier: borrow() }) === undefined, true,
    "an unclosed bare reference cannot become an owned output");
  assert.equal(bindRustCallableInputLifetimes([], result, invocation) === undefined, true,
    "invocation-only consumers cannot select a native ownership contract");
  assert.equal(bindRustCallableInputLifetimes([], result) === undefined, true,
    "the retired two-argument binder cannot silently choose an output role");
});

test("owned output candidates cannot replace existing elision or a nonelided result", () => {
  const candidate = { kind: "owned-output", carrier: integer };
  const selected = bindRustCallableInputLifetimes([borrow()], borrow(), candidate);
  assert.equal(selected !== undefined && !selected.ownedOutput, true, "one actual input lifetime keeps its original native elision rule");
  assert.equal(selected.result.lifetime.identity, selected.parameters[0].lifetime.identity,
    "the policy candidate does not replace the native input-derived result");
  assert.equal(bindRustCallableInputLifetimes([borrow(), borrow()], borrow(), candidate) === undefined, true,
    "an owned candidate cannot make ambiguous invocation lifetimes total");
  const unchanged = bindRustCallableInputLifetimes([], unit, candidate);
  assert.equal(unchanged !== undefined && unchanged.result === unit && !unchanged.ownedOutput, true,
    "a nonelided output remains the original exact carrier");
});
