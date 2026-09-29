import assert from "node:assert/strict";
import test from "node:test";
import { rustCallArgumentIsOwned } from "../../../dist/analysis/facts/parameter-passing.js";
import { rustTargetOperationFactKey } from "../../../dist/analysis/facts/operations/keys.js";
import { rustArgumentPassingKey } from "../../../dist/target-model/facts/selections.js";

function query({ operation, mode = "by-value", syntax = "call", argumentSelected = true, withParent = true }) {
  const argument = {};
  const call = {};
  const ast = {
    parent: node => node === argument && withParent ? call : undefined,
    is: {
      IsCallExpression: node => node === call && syntax === "call",
      IsNewExpression: node => node === call && syntax === "new",
    },
    arguments: node => node === call && argumentSelected ? [argument] : [],
  };
  const facts = { get: (node, key) => {
    if (node === call && key === rustTargetOperationFactKey) return operation;
    if (node === argument && key === rustArgumentPassingKey) return mode === "missing" ? undefined : { mode };
    return undefined;
  } };
  return rustCallArgumentIsOwned(argument, ast, facts);
}

test("owned input evidence requires the selected ordinary call and exact by-value argument", () => {
  for (const syntax of ["call", "new"]) {
    for (const operation of [
      { kind: "source-call" },
      { kind: "provider-operation", abi: { target: { form: "call", path: "unrelated_crate::accept" } } },
      { kind: "provider-operation", abi: { target: { form: "method", name: "accept" } } },
      { kind: "provider-operation", abi: { target: { form: "receiver-method", name: "accept" } } },
    ]) {
      assert.equal(query({ operation, syntax }), true);
      for (const mode of ["borrow-shared", "borrow-mut", "missing"]) {
        assert.equal(query({ operation, syntax, mode }), false);
      }
      assert.equal(query({ operation, syntax, argumentSelected: false }), false);
      assert.equal(query({ operation, syntax, withParent: false }), false);
      assert.equal(query({ operation, syntax: "other" }), false);
    }
  }
});

test("storage markers and native token input cannot become owned calls through a coarse argument fact", () => {
  for (const operation of [
    undefined,
    { kind: "typed-location", operation: "address-of" },
    { kind: "reference-operation", operation: "ref" },
    { kind: "flow-marker" },
    { kind: "provider-operation", abi: { target: { form: "expression-macro", path: "unrelated_crate::transform" } } },
  ]) {
    assert.equal(query({ operation }), false);
  }
});
