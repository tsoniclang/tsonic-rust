import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustFrozenReceiverCaptures } from "../../../dist/analysis/objects/frozen-receiver-captures.js";
import { createRustFrozenDataWriteRegistry } from "../../../dist/analysis/objects/frozen-data-writes.js";
import { rustTargetOperationFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustObjectReferenceViewKey } from "../../../dist/analysis/facts/object-reference-views.js";
import { closedMetadataKey } from "../../../dist/target-model/metadata/closed-data.js";

const carrier = identity => ({ kind: "target-named", id: identity, genericArguments: [] });
const ownerCarrier = carrier("test.Owner");
const owner = { kind: "class", declaration: {}, carrier: ownerCarrier };

function capture(declaration, modes) {
  const references = modes.map(mode => ({ mode }));
  return { declaration, reference: references[0], references, receiver: {} };
}

function fixture({
  groups = [capture({}, ["write"])], freezeCarrier = ownerCarrier, resultCarrier = freezeCarrier,
  freezePath = "tsonic_rust_runtime::freeze_object", views = [], referenceViews = [],
  owners = [owner], lineage = () => [owner], relationship = (source, target) =>
    closedMetadataKey(source) === closedMetadataKey(target.carrier) ? { kind: "related" } : { kind: "unrelated" },
  unions = new Map(), sharesStorage = () => false, shapes = [], canonical = new Map(),
  readonlyFields = new Set(), privateFields = new Set(), operations = new Map(),
} = {}) {
  const freeze = {};
  const arrows = groups.map(group => ({ arrow: true, group }));
  const recordedViews = referenceViews.map(view => ({ view }));
  const root = { children: [...arrows, freeze, ...recordedViews] };
  const sourceArguments = [{ carrier: freezeCarrier, form: "value", role: "parameter", disposition: "runtime" }];
  const freezeOperation = { kind: "provider-operation", resultCarrier, abi: {
    target: { form: "call", path: freezePath }, sourceArguments,
  } };
  const storageDeclaration = declaration => canonical.get(declaration) ?? declaration;
  const input = {
    ast: {
      is: { IsArrowFunction: node => node.arrow === true },
      forEachChild(node, visit) { for (const child of node.children ?? []) visit(child); },
      name: declaration => privateFields.has(declaration) ? { private: true } : undefined,
      kindName: name => name.private ? "KindPrivateIdentifier" : "KindIdentifier",
    },
    sourceFiles: [root],
    facts: { getFact(node, key) {
      if (key === rustObjectReferenceViewKey) return node.view;
      if (key !== rustTargetOperationFactKey) return undefined;
      if (node === freeze) return freezeOperation;
      if (operations.has(node)) return operations.get(node);
      const group = groups.find(selected => selected.references.includes(node));
      return group === undefined ? undefined : { kind: "source-field", storage: "project-object",
        declaration: group.declaration, valueSemantics: { kind: "stored" }, accessMode: node.mode };
    } },
    projectTypes: {
      definitions: owners,
      openCarrier: selected => selected.carrier,
      definitionForCarrier: selected => owners.find(candidate =>
        closedMetadataKey(candidate.carrier) === closedMetadataKey(selected)),
      definitionContainingDeclaration: declaration => declaration.owner ?? owner,
      relationship, classLineage: lineage,
    },
    captures: {
      capturesFor: node => node.group === undefined ? [] : [node.group],
      storageDeclaration,
      storageReadonly: declaration => readonlyFields.has(declaration),
    },
    views,
    structuralShapes: { sharesStorage, definitions: shapes },
    typeDefinitions: { sourceUnionVariants: selected => unions.get(closedMetadataKey(selected)) },
  };
  return { input, groups, sourceArguments, freezeOperation,
    analyze: () => analyzeRustFrozenReceiverCaptures(input) };
}

for (const mode of ["write", "read-write"]) test(`only exact retained ${mode} demands the outer token`, () => {
  const selected = fixture({ groups: [capture({}, [mode])] });
  const group = selected.groups[0];
  const plan = selected.analyze();
  assert.equal(plan.capturesFieldIdentity(group.declaration), true);
  assert.equal(plan.capturesFieldIdentity(group.declaration, group.reference), true);
  assert.equal(plan.capturesFieldIdentity(group.declaration, {}), false);
  assert.equal(plan.capturesFieldIdentity({}, group.reference), false);
  assert.equal(Object.isFrozen(plan), true);
});

test("one field's read and child-content environments do not inherit another environment's write token", () => {
  const declaration = {};
  const reader = capture(declaration, ["read"]);
  const childWriter = capture({}, ["read"]);
  const writer = capture(declaration, ["read", "write", "read"]);
  const selected = fixture({ groups: [reader, childWriter, writer] });
  const plan = selected.analyze();
  assert.equal(plan.capturesFieldIdentity(declaration), true);
  assert.equal(plan.capturesFieldIdentity(declaration, reader.reference), false);
  assert.equal(plan.capturesFieldIdentity(childWriter.declaration), false);
  for (const reference of writer.references)
    assert.equal(plan.capturesFieldIdentity(declaration, reference), true, "the exact writer group owns one token");
});

test("a selected freeze alone does not demand eager identity for read-only or shallow captures", () => {
  for (const groups of [[capture({}, ["read"])], [capture({}, ["read"]), capture({}, ["read"])]]) {
    const plan = fixture({ groups }).analyze();
    for (const group of groups) {
      assert.equal(plan.capturesFieldIdentity(group.declaration), false);
      assert.equal(plan.capturesFieldIdentity(group.declaration, group.reference), false);
    }
  }
});

test("canonical inherited storage retains exact capture membership, not a same-named field", () => {
  const base = {};
  const override = {};
  const group = capture(override, ["write"]);
  const selected = fixture({ groups: [group], canonical: new Map([[override, base]]),
    operations: new Map([[group.reference, { kind: "source-field", declaration: base,
      storage: "project-object", valueSemantics: { kind: "stored" }, accessMode: "write" }]]) });
  const plan = selected.analyze();
  assert.equal(plan.capturesFieldIdentity(base), true);
  assert.equal(plan.capturesFieldIdentity(override, group.reference), true);
  assert.equal(plan.capturesFieldIdentity({}, group.reference), false);
});

test("readonly, private, accessor, alias and mismatched operation evidence cannot demand a data-store token", () => {
  const group = capture({}, ["write"]);
  const direct = { kind: "source-field", declaration: group.declaration, storage: "project-object",
    valueSemantics: { kind: "stored" }, accessMode: "write" };
  for (const options of [
    { readonlyFields: new Set([group.declaration]) },
    { privateFields: new Set([group.declaration]) },
    ...[undefined, { ...direct, declaration: {} }, { ...direct, storage: "structural-object" },
      { ...direct, valueSemantics: { kind: "accessor", writable: true } },
      { ...direct, valueSemantics: { kind: "receiver-alias" } },
      { ...direct, accessMode: "read" }].map(operation => ({ operations: new Map([[group.reference, operation]]) })),
  ]) assert.equal(fixture({ groups: [group], ...options }).analyze().capturesFieldIdentity(group.declaration), false);
});

test("freeze demand belongs to the finalized input, never the result carrier or a similar API name", () => {
  const selected = fixture({ resultCarrier: carrier("test.Unrelated") });
  assert.equal(selected.analyze().capturesFieldIdentity(selected.groups[0].declaration), true);
  for (const options of [{ freezeCarrier: carrier("test.Unrelated") }, { freezePath: "test::freeze_object" }]) {
    const negative = fixture(options);
    assert.equal(negative.analyze().capturesFieldIdentity(negative.groups[0].declaration), false);
  }
});

test("existing identity-preserving structural views close multihop and cyclic alias transport once", () => {
  const wide = carrier("test.Wide");
  const narrow = carrier("test.Narrow");
  const selected = fixture({ freezeCarrier: narrow,
    views: [{ sourceCarrier: ownerCarrier, targetCarrier: wide }],
    referenceViews: [
      { kind: "structural", sourceCarrier: wide, targetCarrier: narrow },
      { kind: "structural", sourceCarrier: narrow, targetCarrier: wide },
    ] });
  assert.equal(selected.analyze().capturesFieldIdentity(selected.groups[0].declaration), true);
  selected.input.views[0] = { sourceCarrier: ownerCarrier, targetCarrier: carrier("test.OtherWide") };
  assert.equal(selected.analyze().capturesFieldIdentity(selected.groups[0].declaration), false);
});

test("only exact sealed physical storage admits a generic structural instantiation", () => {
  const template = carrier("test.Template");
  const instance = carrier("test.Instance");
  const selected = fixture({ freezeCarrier: instance,
    views: [{ sourceCarrier: ownerCarrier, targetCarrier: template }],
    sharesStorage: (left, right) => left === template && right === instance });
  assert.equal(selected.analyze().capturesFieldIdentity(selected.groups[0].declaration), true);
  selected.input.structuralShapes.sharesStorage = () => false;
  assert.equal(selected.analyze().capturesFieldIdentity(selected.groups[0].declaration), false);
});

test("open generic freeze follows only exact registered structural instantiations", () => {
  const parameter = { kind: "type-parameter", identity: "test.T", name: "T" };
  const template = { ...carrier("test.View"), genericArguments: [{ kind: "type", type: parameter }] };
  const instance = { ...carrier("test.View"), genericArguments: [{ kind: "type", type: carrier("test.Number") }] };
  const selected = fixture({ freezeCarrier: template,
    shapes: [{ sourceCarriers: [template, instance] }],
    views: [{ sourceCarrier: ownerCarrier, targetCarrier: instance }] });
  assert.equal(selected.analyze().capturesFieldIdentity(selected.groups[0].declaration), true);
  selected.input.structuralShapes.definitions = [{ sourceCarriers: [instance] }];
  assert.equal(selected.analyze().capturesFieldIdentity(selected.groups[0].declaration), false);
  selected.input.structuralShapes.definitions = [{ sourceCarriers: [template, carrier("test.UnrelatedView")] }];
  assert.equal(selected.analyze().capturesFieldIdentity(selected.groups[0].declaration), false);
});

test("a closed generic freeze does not demand other instances of the same structural template", () => {
  const parameter = { kind: "type-parameter", identity: "test.T", name: "T" };
  const template = { ...carrier("test.View"), genericArguments: [{ kind: "type", type: parameter }] };
  const selectedCarrier = { ...carrier("test.View"), genericArguments: [{ kind: "type", type: carrier("test.Number") }] };
  const otherCarrier = { ...carrier("test.View"), genericArguments: [{ kind: "type", type: carrier("test.String") }] };
  const selected = fixture({ freezeCarrier: selectedCarrier,
    shapes: [{ sourceCarriers: [template, selectedCarrier, otherCarrier] }],
    views: [{ sourceCarrier: ownerCarrier, targetCarrier: otherCarrier }] });
  assert.equal(selected.analyze().capturesFieldIdentity(selected.groups[0].declaration), false);
});

test("closed union variants preserve source owner demand without freezing unrelated members", () => {
  const union = carrier("test.Union");
  const view = carrier("test.View");
  const unrelated = { kind: "class", declaration: {}, carrier: carrier("test.Other") };
  const unrelatedGroup = capture({ owner: unrelated }, ["write"]);
  const selected = fixture({ freezeCarrier: union, owners: [owner, unrelated],
    groups: [capture({}, ["write"]), unrelatedGroup],
    unions: new Map([[closedMetadataKey(union), [{ carrier: view }]]]),
    views: [{ sourceCarrier: ownerCarrier, targetCarrier: view }] });
  const plan = selected.analyze();
  assert.equal(plan.capturesFieldIdentity(selected.groups[0].declaration), true);
  assert.equal(plan.capturesFieldIdentity(unrelatedGroup.declaration), false);
});

test("selected interface and descendant freeze reaches the exact inherited physical owner", () => {
  const contract = { kind: "interface", declaration: {}, carrier: carrier("test.Contract") };
  const descendant = { kind: "class", declaration: {}, carrier: carrier("test.Descendant") };
  const selected = fixture({ freezeCarrier: contract.carrier, owners: [owner, contract, descendant],
    relationship: (source, target) => target === contract && source === descendant.carrier
      ? { kind: "related" } : { kind: "unrelated" },
    lineage: selectedOwner => selectedOwner === descendant ? [owner, descendant] : [] });
  assert.equal(selected.analyze().capturesFieldIdentity(selected.groups[0].declaration), true);
});

test("copied records and constructor-only views do not transport the original instance identity", () => {
  const target = carrier("test.Copy");
  for (const kind of ["constructor", "unselected-copy"]) {
    const selected = fixture({ freezeCarrier: target,
      referenceViews: [{ kind, sourceCarrier: ownerCarrier, targetCarrier: target }] });
    assert.equal(selected.analyze().capturesFieldIdentity(selected.groups[0].declaration), false);
  }
});

test("missing, non-runtime or competing finalized freeze inputs fail closed", () => {
  for (const argumentsList of [[], [{ form: "spread-sequence", role: "parameter", disposition: "runtime" }],
    [{ form: "value", role: "parameter", disposition: "runtime" }],
    [{ form: "value", role: "parameter", disposition: "evaluation-only" }],
    [0, 1].map(() => ({ form: "value", role: "parameter", disposition: "runtime", carrier: ownerCarrier }))]) {
    const selected = fixture();
    selected.freezeOperation.abi.sourceArguments = argumentsList;
    assert.throws(selected.analyze, /exact finalized freeze input/u);
  }
});

test("cyclic source input cannot remove finite work protection", () => {
  const selected = fixture();
  selected.input.ast.forEachChild = (node, visit) => visit(node);
  assert.throws(selected.analyze, /finite work budget/u);
});

test("native surface never queries or manufactures frozen capture evidence", () => {
  const selected = fixture();
  const registry = createRustFrozenDataWriteRegistry();
  registry.initialize({ ...selected.input, jsEnabled: false,
    representations: { receiverCaptures: selected.input.captures } });
  assert.equal(registry.capturesFieldIdentity(selected.groups[0].declaration), false);
  assert.equal(registry.seal().capturesFieldIdentity(selected.groups[0].declaration, selected.groups[0].reference), false);
  assert.throws(() => registry.initialize({}), /already initialized/u);
});
