import assert from "node:assert/strict";
import test from "node:test";
import { proveRustCopiedMethodFlow } from "../../../dist/analysis/objects/copied-methods.js";

const sources = entries => new Map(entries.map(([identity, values]) => [identity, new Set(values)]));

test("grounded copied methods remain receiver-independent through self and rest/spread cycles", () => {
  const incoming = sources([["original", ["rest"]], ["copy", ["original", "copy"]], ["rest", ["copy"]]]);
  assert.deepEqual(proveRustCopiedMethodFlow(["original", "copy", "rest"], incoming, new Map([["original", true]])),
    new Set(["original", "copy", "rest"]));
});

test("a copied method cycle cannot manufacture an implementation", () => {
  const incoming = sources([["first", ["second"]], ["second", ["first"]], ["self", ["self"]]]);
  assert.deepEqual(proveRustCopiedMethodFlow(["first", "second", "self"], incoming, new Map()), new Set());
});

test("every receiver-dependent implementation poisons its transitive copied destinations", () => {
  const incoming = sources([["first", ["second"]], ["second", ["first"]], ["third", ["second"]]]);
  assert.deepEqual(proveRustCopiedMethodFlow(["first", "second", "third", "independent"], incoming,
    new Map([["first", true], ["second", false], ["independent", true]])), new Set(["independent"]));
});

test("an ungrounded or absent source is not hidden by another independent implementation", () => {
  const incoming = sources([["first", ["unknown"]], ["unknown", ["unknown"]], ["second", ["missing"]]]);
  assert.deepEqual(proveRustCopiedMethodFlow(["first", "unknown", "second"], incoming,
    new Map([["first", true], ["second", true]])), new Set());
});

test("proof is independent of visitation order and rejects a mixed-source join", () => {
  const identities = ["safe", "unsafe", "join", "last"];
  const incoming = sources([["join", ["safe", "unsafe"]], ["last", ["join"]]]);
  const implementations = new Map([["safe", true], ["unsafe", false]]);
  for (const order of [identities, [...identities].reverse()]) {
    assert.deepEqual(proveRustCopiedMethodFlow(order, incoming, implementations), new Set(["safe"]));
  }
});
