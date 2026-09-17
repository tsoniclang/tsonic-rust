import assert from "node:assert/strict";
import test from "node:test";
import { selectRustValueCarrierReconciliation } from "../../../dist/policy/types/value-carrier-reconciliation.js";
import { rustProjectUpcastSourceMatches } from "../../../dist/analysis/facts/value-carrier-queries.js";

const carrier = name => ({ kind: "target-named", id: `proof.${name}` });
const source = carrier("Union");
const target = carrier("Base");
const variants = ["First", "Second", "Third"].map((name, index) => ({ name: `Variant${index}`, carrier: carrier(name) }));
const definitions = { sourceUnionVariants: value => value === source ? variants : undefined };
const targetDefinition = {};
const policy = relationship => ({
  definitionForCarrier: value => value === target ? targetDefinition : undefined,
  relationship,
});

test("union upcast selection proves every exact variant against the same base instantiation", () => {
  const visited = [];
  const selected = selectRustValueCarrierReconciliation(source, target, policy((value, definition) => {
    assert.equal(definition, targetDefinition);
    visited.push(value);
    return { kind: "related", targetType: target };
  }), definitions);
  assert.equal(selected.kind, "project-upcast");
  assert.deepEqual(visited, variants.map(variant => variant.carrier));
  assert.equal(rustProjectUpcastSourceMatches(selected.fact, definitions), true);
});

test("union upcast selection rejects unrelated, ambiguous and mismatched generic base branches", () => {
  for (const relationship of [
    { kind: "unrelated" },
    { kind: "ambiguous", targetTypes: [target] },
    { kind: "related", targetType: carrier("DifferentInstantiation") },
  ]) {
    const result = selectRustValueCarrierReconciliation(source, target, policy(value =>
      value === variants[1].carrier ? relationship : { kind: "related", targetType: target }), definitions);
    assert.equal(result.kind, "incompatible");
    assert.equal(result.reason, relationship.kind === "ambiguous" ? "ambiguous" : "unrelated");
  }
});

test("union upcast consumption rejects missing, reordered, duplicate and changed variants", () => {
  const fact = { sourceCarrier: source, targetCarrier: target, sourceVariants: variants };
  assert.equal(rustProjectUpcastSourceMatches(fact, definitions), true);
  for (const sourceVariants of [undefined, [], variants.slice(1), [...variants].reverse(),
    [variants[0], variants[0], variants[2]],
    [{ ...variants[0], carrier: target }, ...variants.slice(1)],
    [{ ...variants[0], name: "Missing" }, ...variants.slice(1)]]) {
    assert.equal(rustProjectUpcastSourceMatches({ ...fact, sourceVariants }, definitions), false);
  }
  assert.equal(rustProjectUpcastSourceMatches({ sourceCarrier: target, targetCarrier: target }, definitions), true);
  assert.equal(rustProjectUpcastSourceMatches({ ...fact, sourceCarrier: target }, definitions), false);
});
