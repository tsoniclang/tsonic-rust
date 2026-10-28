import assert from "node:assert/strict";
import test from "node:test";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { providerVirtualDeclarationFactKey } from "@tsonic/tsts";
import { providerIndexedPolicyFixture } from "../../../../tsonic/test/fixtures/provider-indexed-policy.mjs";
import { resolveRustProviderIndexedAccess } from "../../../dist/analysis/source-evidence/types/resolution/indexed-access.js";
import { rustNamedTargetType, rustOptionTargetType, rustSourceOptionalTargetType } from "../../../dist/target-model/types/index.js";

const integer = { kind: "source-primitive", name: "uint64" };

function fixture(options = {}) {
  const selected = providerIndexedPolicyFixture(options.keys);
  const parameters = options.noSourceParameters ? [] : [{ kind: "type", targetIdentity: "T", sourceName: "T" }];
  const argument = { kind: "type", type: integer };
  const physical = { kind: "type", type: { kind: "source-primitive", name: "bool" } };
  const selectedPhysical = options.wrongPhysical ? { kind: "type", type: integer } : physical;
  const carrier = rustNamedTargetType("native.box", "native::Box", options.physicalArguments ? [selectedPhysical, argument] : [argument]);
  const ownerCarrier = options.missingGeneric ? rustNamedTargetType("native.box", "native::Box") : carrier;
  const memberCarrier = options.noSourceParameters ? integer : { kind: "type-parameter", identity: "T", name: "T" };
  const genericArgument = { kind: "type", type: memberCarrier };
  const generic = rustNamedTargetType("native.box", "native::Box", options.physicalArguments ? [physical, genericArgument] : [genericArgument]);
  const owner = { providerId: "fixture", providerVersion: "1", providerModuleId: "native", moduleSpecifier: "@fixture/native", exportId: "box", exportName: "Box" };
  const facts = new Map();
  const rows = selected.evidence.members.map((member, index) => {
    const identity = { ...owner, memberId: `field-${index}`,
      ...(member.selection.kind === "index" ? { signatureId: `index-${index}` } : {}) };
    if (!options.missingFact || index === 0) for (const subject of member.subjects) facts.set(subject, options.wrongSignature
      ? { ...identity, signatureId: "wrong-signature" } : identity);
    return { ...identity, operationKind: member.selection.kind === "index" && !options.wrongKind ? "indexer" : "property",
      target: { form: "receiver-field", name: `field_${index}` },
      resultCarrier: options.conflicting && index === 1
        ? { kind: "source-primitive", name: "int64" } : options.nativeOptional
          ? rustOptionTargetType(memberCarrier)
          : memberCarrier };
  });
  const get = (subject, key) => key === providerVirtualDeclarationFactKey && !options.unowned ? facts.get(subject) : undefined;
  const context = {
    ast: selected.source.ast, source: { ...selected.source, sourceFacts: { getFact: get } }, currentSemantics: selected.semantics,
    sourceStorage: { storageSubjectFor: () => ({ kind: "unresolved" }) },
    semantics: file => selected.source.semantics.forFile(file), semanticsFor: () => selected.semantics,
    records: createRustRecordFixture({ runtimeCarrier: { get: node => {
      if (options.forbidOwnerResolution) assert.fail("non-provider indexed evidence cannot materialize a native owner");
      return node === selected.evidence.owner ? {
        carrier: options.referenceOwner ? { kind: "reference", mutable: options.mutableOwner === true, referent: ownerCarrier } : ownerCarrier,
      } : undefined;
    } } }),
  };
  const resolutionOptions = {
    providerTypes: [{ ...owner, targetCarrier: options.wrongOwner ? rustNamedTargetType("native.other", "native::Other") : generic, genericParameters: parameters }],
    providerRows: options.missingRelation ? [] : options.duplicate ? [...rows, rows[0]] : rows,
  };
  return resolveRustProviderIndexedAccess(selected.node, context, resolutionOptions);
}

test("provider indexed type policy closes native generics and optional properties", () => {
  assert.deepEqual(fixture(), integer);
  assert.deepEqual(fixture({ keys: '"value" | "other"' }), integer);
  assert.deepEqual(fixture({ keys: '"optional"' }), rustSourceOptionalTargetType(integer));
  assert.deepEqual(fixture({ keys: '"optional"', nativeOptional: true }), rustSourceOptionalTargetType(integer));
  assert.deepEqual(fixture({ nativeOptional: true }), rustOptionTargetType(integer));
  assert.deepEqual(fixture({ keys: "string", nativeOptional: true }), rustOptionTargetType(integer));
  assert.deepEqual(fixture({ physicalArguments: true }), integer);
  assert.deepEqual(fixture({ noSourceParameters: true }), integer);
  assert.deepEqual(fixture({ noSourceParameters: true, physicalArguments: true }), integer);
  assert.deepEqual(fixture({ referenceOwner: true }), integer);
  assert.deepEqual(fixture({ referenceOwner: true, mutableOwner: true }), integer);
  assert.deepEqual(fixture({ referenceOwner: true, keys: "string", nativeOptional: true }), rustOptionTargetType(integer));
  assert.equal(fixture({ unowned: true }), undefined);
});

test("ordinary indexed types decline provider selection before any owner materialization", () => {
  assert.equal(fixture({ unowned: true, forbidOwnerResolution: true }), undefined,
    "a source indexed type has no provider decision or speculative structural owner");
});

test("provider indexed type policy rejects incomplete, ambiguous and mismatched evidence", () => {
  for (const options of [
    { missingRelation: true }, { duplicate: true }, { wrongOwner: true }, { missingGeneric: true },
    { keys: '"value" | "other"', conflicting: true }, { keys: '"value" | "other"', missingFact: true },
    { physicalArguments: true, wrongPhysical: true },
    { noSourceParameters: true, physicalArguments: true, wrongPhysical: true },
    { keys: "string", missingRelation: true }, { keys: "string", duplicate: true },
    { keys: "string", wrongOwner: true }, { keys: "string", missingGeneric: true },
    { keys: "string", wrongSignature: true }, { keys: "string", wrongKind: true },
    { referenceOwner: true, wrongOwner: true }, { referenceOwner: true, missingGeneric: true },
    { referenceOwner: true, physicalArguments: true, wrongPhysical: true },
  ]) assert.deepEqual(fixture(options), { kind: "opaque", id: "provider-indexed-type-evidence-unavailable" }, JSON.stringify(options));
});
