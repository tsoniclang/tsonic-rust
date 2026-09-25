import assert from "node:assert/strict";
import test from "node:test";
import { providerVirtualDeclarationFactKey } from "@tsonic/tsts";
import { providerIndexedPolicyFixture } from "../../../../tsonic/test/fixtures/provider-indexed-policy.mjs";
import { resolveRustProviderIndexedAccess } from "../../../dist/policy/types/resolution/indexed-access.js";
import { rustNamedTargetType, rustOptionTargetType } from "../../../dist/target-model/types/index.js";

const integer = { kind: "source-primitive", name: "uint64" };

function fixture(options = {}) {
  const selected = providerIndexedPolicyFixture(options.keys);
  const parameters = [{ kind: "type", sourceName: "T" }];
  const argument = { kind: "type", type: integer };
  const carrier = rustNamedTargetType("native.box", "native::Box", [argument]);
  const generic = rustNamedTargetType("native.box", "native::Box", [{ kind: "type", type: { kind: "type-parameter", name: "T" } }]);
  const owner = { providerId: "fixture", providerVersion: "1", providerModuleId: "native", moduleSpecifier: "@fixture/native", exportId: "box", exportName: "Box" };
  const facts = new Map();
  const rows = selected.evidence.properties.map((member, index) => {
    const identity = { ...owner, memberId: `field-${index}` };
    if (!options.missingFact || index === 0) for (const subject of member.subjects) facts.set(subject, identity);
    return { ...identity, operationKind: "property", target: { form: "receiver-field", name: `field_${index}` },
      resultCarrier: options.conflicting && index === 1
        ? { kind: "source-primitive", name: "int64" } : { kind: "type-parameter", name: "T" } };
  });
  const get = (subject, key) => key === providerVirtualDeclarationFactKey && !options.unowned ? facts.get(subject) : undefined;
  const context = {
    ast: selected.source.ast, source: selected.source, currentSemantics: selected.semantics,
    semantics: file => selected.source.semantics.forFile(file), semanticsFor: () => selected.semantics,
    facts: { get, resolve: get, getRuntimeCarrierFact: node => node === selected.evidence.owner ? { carrier: options.missingGeneric
      ? rustNamedTargetType("native.box", "native::Box") : carrier } : undefined },
  };
  return resolveRustProviderIndexedAccess(selected.node, context, {
    providerTypes: [{ ...owner, targetCarrier: options.wrongOwner ? rustNamedTargetType("native.other", "native::Other") : generic, genericParameters: parameters }],
    providerRows: options.missingRelation ? [] : options.duplicate ? [...rows, rows[0]] : rows,
  });
}

test("provider indexed type policy closes native generics and optional properties", () => {
  assert.deepEqual(fixture(), integer);
  assert.deepEqual(fixture({ keys: '"value" | "other"' }), integer);
  assert.deepEqual(fixture({ keys: '"optional"' }), rustOptionTargetType(integer));
  assert.equal(fixture({ unowned: true }), undefined);
});

test("provider indexed type policy rejects incomplete, ambiguous and mismatched evidence", () => {
  for (const options of [
    { missingRelation: true }, { duplicate: true }, { wrongOwner: true }, { missingGeneric: true },
    { keys: '"value" | "other"', conflicting: true }, { keys: '"value" | "other"', missingFact: true },
  ]) assert.deepEqual(fixture(options), { kind: "opaque", id: "provider-indexed-type-evidence-unavailable" }, JSON.stringify(options));
});
