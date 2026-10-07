import assert from "node:assert/strict";
import test from "node:test";
import { rustProjectGenericContractCorrespondence } from "../../../dist/policy/types/project-generic-contract.js";

function fixture() {
  const selected = {};
  const implementation = {};
  const syntax = new Map([[selected, [{}]], [implementation, [{}]]]);
  const contracts = new Map([[selected, [{ kind: "type", declaration: syntax.get(selected)[0], sourceName: "T", identity: "checked:T" }]],
    [implementation, [{ kind: "type", declaration: syntax.get(implementation)[0], sourceName: "Item", identity: "native:Item" }]]]);
  const context = { ast: { typeParameters: declaration => syntax.get(declaration) ?? [] },
    sourceLifetimes: { contractFor: declaration => contracts.has(declaration) ? { parameters: contracts.get(declaration) } : undefined } };
  return { selected, implementation, syntax, contracts, context };
}

test("native overload generic correspondence preserves exact declaration slots rather than binder spelling", () => {
  const input = fixture();
  const selected = rustProjectGenericContractCorrespondence(input.selected, input.implementation, input.context);
  assert.equal(selected !== undefined, true, "checked T and native Item have one exact ordinal correspondence");
  assert.equal(selected.selected === input.contracts.get(input.selected), true);
  assert.equal(selected.implementation === input.contracts.get(input.implementation), true);
  assert.equal(Object.isFrozen(selected), true);
  const own = rustProjectGenericContractCorrespondence(input.selected, input.selected, input.context);
  assert.equal(own.selected === own.implementation, true, "ordinary declarations retain their own canonical contract");
  for (const declaration of [input.selected, input.implementation]) {
    input.contracts.get(declaration)[0].kind = "lifetime";
  }
  assert.equal(rustProjectGenericContractCorrespondence(input.selected, input.implementation, input.context) !== undefined, true,
    "exact lifetime binders use the same correspondence owner");
});

test("overload generic correspondence rejects missing, foreign, wrong-kind and inconsistent declaration evidence", () => {
  for (const mutate of [
    input => input.contracts.delete(input.selected),
    input => input.contracts.delete(input.implementation),
    input => { input.contracts.get(input.selected)[0].declaration = {}; },
    input => { input.contracts.get(input.implementation)[0].declaration = {}; },
    input => { input.contracts.get(input.implementation)[0].kind = "lifetime"; },
    input => input.contracts.get(input.implementation).push(input.contracts.get(input.implementation)[0]),
    input => input.syntax.get(input.implementation).push({}),
    input => input.syntax.set(input.implementation, []),
  ]) {
    const input = fixture();
    mutate(input);
    assert.equal(rustProjectGenericContractCorrespondence(input.selected, input.implementation, input.context) === undefined, true,
      "native binders cannot be guessed or inherited from a foreign declaration");
  }
  const context = { ast: { typeParameters: () => [] }, sourceLifetimes: {
    contractFor() { throw new Error("zero-binder declarations need no invented generic evidence"); },
  } };
  const selected = rustProjectGenericContractCorrespondence({}, {}, context);
  assert.equal(selected.selected.length, 0);
  assert.equal(selected.implementation.length, 0);
});
