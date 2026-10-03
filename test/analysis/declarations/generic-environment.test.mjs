import assert from "node:assert/strict";
import test from "node:test";
import { resolveRustEnclosingGenericParameters } from "../../../dist/analysis/declarations/generic-environment.js";
import { rustLifetimeKey } from "../../../dist/target-model/lifetimes/index.js";

test("enclosing generic selection uses exact declaration identity, not shadowed names", () => {
  const outer = {}, inner = {};
  const first = { kind: "type", declaration: {}, identity: "outer:T", targetName: "T" };
  const second = { kind: "type", declaration: {}, identity: "inner:T", targetName: "T" };
  const lifetime = { kind: "lifetime", declaration: {}, lifetime: { kind: "parameter", identity: "outer:a", name: "a" } };
  const ast = { parent: value => value === inner ? outer : undefined };
  const lifetimes = { contractFor: value => ({ parameters: value === outer ? [first, lifetime] : [second] }) };
  const parameters = resolveRustEnclosingGenericParameters(inner, [first.identity, second.identity, rustLifetimeKey(lifetime.lifetime)], ast, lifetimes);
  assert.equal(parameters[0] === first, true, "outer binder retains exact identity");
  assert.equal(parameters[1] === second, true, "inner binder retains exact identity");
  assert.equal(parameters[2] === lifetime, true, "lifetime retains exact identity");
  assert.equal(Object.isFrozen(parameters), true);
  assert.equal(resolveRustEnclosingGenericParameters(inner, ["missing"], ast, lifetimes), undefined);
  assert.equal(resolveRustEnclosingGenericParameters(inner, [], ast, lifetimes).length, 0);
});

test("enclosing generic selection closes exact transitive outlives declarations", () => {
  const owner = {};
  const firstLifetime = { kind: "parameter", identity: "outer:a", name: "a" };
  const secondLifetime = { kind: "parameter", identity: "outer:b", name: "b" };
  const first = { kind: "lifetime", declaration: {}, lifetime: firstLifetime, outlives: [secondLifetime] };
  const second = { kind: "lifetime", declaration: {}, lifetime: secondLifetime, outlives: [] };
  const value = { kind: "type", declaration: {}, identity: "outer:T", targetName: "T", outlives: [firstLifetime] };
  const ast = { parent: () => undefined };
  const lifetimes = { contractFor: () => ({ parameters: [first, value, second] }) };
  const selected = resolveRustEnclosingGenericParameters(owner, [value.identity], ast, lifetimes);
  assert.equal(selected.length, 3);
  assert.equal(selected[0] === value, true);
  assert.equal(selected[1] === first, true);
  assert.equal(selected[2] === second, true);
  assert.equal(resolveRustEnclosingGenericParameters(owner, [firstLifetime.identity], ast, lifetimes), undefined);
  assert.equal(resolveRustEnclosingGenericParameters(owner, [value.identity], ast,
    { contractFor: () => ({ parameters: [value] }) }), undefined);
  assert.equal(resolveRustEnclosingGenericParameters(owner,
    Array.from({ length: 65_537 }, (_, index) => `missing:${index}`), ast, lifetimes), undefined);
});

test("enclosing generic selection rejects cyclic and excessively deep ancestry", () => {
  const node = {};
  assert.equal(resolveRustEnclosingGenericParameters(node, ["missing"], { parent: () => node }, { contractFor: () => undefined }), undefined);
  const owners = Array.from({ length: 130 }, () => ({}));
  const ast = { parent: value => owners[owners.indexOf(value) + 1] };
  const lifetimes = { contractFor: value => value === owners[129] ? { parameters: [{ kind: "type", identity: "deep" }] } : undefined };
  assert.equal(resolveRustEnclosingGenericParameters(owners[0], ["deep"], ast, lifetimes), undefined);
});
