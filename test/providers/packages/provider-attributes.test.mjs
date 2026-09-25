import assert from "node:assert/strict";
import test from "node:test";
import { createRustProviderPackage } from "../../../dist/public/provider.js";
import { collectRustProviderSemanticsFromDefinitions, mergeRustProviderSemantics } from "../../../dist/providers/packages/index.js";
import { attributeDefinition } from "../../helpers/rust-session/provider-attributes.mjs";

test("attribute contracts retain exact signature, placement, helper and grammar identity", () => {
  const definition = attributeDefinition();
  const semantics = collectRustProviderSemanticsFromDefinitions([definition]);
  assert.equal(semantics.attributes.length, 5);
  assert.ok(Object.isFrozen(semantics.attributes));
  assert.ok(semantics.attributes.every(Object.isFrozen));
  assert.deepEqual(
    mergeRustProviderSemantics(semantics, semantics).attributes.toSorted((left, right) => left.exportId.localeCompare(right.exportId)),
    semantics.attributes.toSorted((left, right) => left.exportId.localeCompare(right.exportId)),
  );
  assert.equal(semantics.operations.length, 0);
});

test("attribute metadata rejects conflicting identities, runtime paths and malformed grammars", () => {
  const mutations = [
    definition => { definition.attributes[0].signatureId = "missing"; },
    definition => { definition.attributes.push(structuredClone(definition.attributes[0])); },
    definition => { definition.attributes[0].path = "unsafe { injected() }"; },
    definition => { definition.attributes[0].arguments = []; },
    definition => { definition.attributes[0].placements = ["expression"]; },
    definition => { definition.attributes[2].requiredParent.exportId = "missing"; },
    definition => { definition.attributes[4].arguments[0].fields[0].memberId = "wrong"; },
    definition => { definition.attributes[4].arguments[0].fields[0].optional = true; },
    definition => { definition.attributes[4].arguments[0].fields.pop(); },
    definition => { definition.attributes[3].placements = ["function"]; },
    definition => { definition.operations.push({ exportId: definition.attributes[0].exportId, operationKind: "method",
      target: { form: "call", path: "acme_attributes::offset" }, parameterCarriers: [{ kind: "source-primitive", name: "int32" }], resultCarrier: { kind: "tuple", elements: [] } }); },
  ];
  for (const mutate of mutations) {
    const definition = attributeDefinition();
    mutate(definition);
    assert.throws(() => createRustProviderPackage(definition), /attribute|helper|derive/u);
  }
});
