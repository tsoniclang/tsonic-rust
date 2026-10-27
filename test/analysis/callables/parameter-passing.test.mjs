import { createRustRecordFixture } from "../../helpers/records.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { rustCallArgumentIsOwned } from "../../../dist/analysis/callables/values/parameter-passing.js";



const integer = { kind: "source-primitive", name: "int32" };

// A provider call reads its argument mode from its finalized ABI input; a source call reads the argument-passing record.
function providerAbiInputs(mode) {
  if (mode === "missing") return [];
  return [{ source: { kind: "argument", sourceIndex: 0 },
    mode: mode === "borrow-shared" ? "ref" : mode === "borrow-mut" ? "mut-ref" : "value",
    sourceCarrier: integer, parameterCarrier: integer,
    conversion: { kind: "identity", sourceCarrier: integer, targetCarrier: integer, fallible: false } }];
}

function query({ operation: authored, mode = "by-value", syntax = "call", argumentSelected = true, withParent = true }) {
  const operation = authored?.kind === "provider-operation" && authored.abi.target.form !== "expression-macro"
    ? { ...authored, abi: { ...authored.abi, targetReceiver: { kind: "none" }, targetArguments: providerAbiInputs(mode) } }
    : authored;
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
  const records = createRustRecordFixture({targetOperation: { get: (node) => {
    if (node === call)
        return operation;
    if (node === argument && false)
        return mode === "missing" ? undefined : { mode };
    return undefined;
} },
argumentPassing: { get: (node) => {
    if (node === call && false)
        return operation;
    if (node === argument)
        return mode === "missing" ? undefined : { mode };
    return undefined;
} }});
  return rustCallArgumentIsOwned(argument, ast, records);
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
