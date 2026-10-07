import assert from "node:assert/strict";
import test from "node:test";
import { rustClosureCaptureFactKey } from "../../../../dist/analysis/facts/operations/keys.js";
import { rustCallableTargetType } from "../../../../dist/target-model/types/index.js";
import { rustRecursiveReceiverFieldContext, validateRustRecursiveReceiverField } from "../../../../dist/backend/planner/expressions/receiver-captures.js";
import { planRustConstructionBody } from "../../../../dist/backend/planner/declarations/classes/construction-body.js";
import { int32Carrier, stringCarrier } from "../../../helpers/rust-session.mjs";
import { fakeAstReader, fakeSourceFile, fakeStatement } from "../../../helpers/fake-compile-input.mjs";

const callable = fakeStatement({ kindName: "KindArrowFunction" });
const sourceFile = fakeSourceFile({ statements: [callable] });
const declaration = {};
const receiver = {};
const references = [{}, {}];
const carrier = rustCallableTargetType([int32Carrier], int32Carrier);
const field = { declaration, receiver, reference: references[0], references, carrier };
const fact = { captures: [], receivers: [], receiverFields: [], recursiveDeclaration: declaration, recursiveField: field };

function context({ selected = field, carriers = new Map(references.map(reference => [reference, carrier])) } = {}) {
  return { sourceFile, diagnostics: [], input: { program: {
    source: { ast: fakeAstReader([sourceFile]) },
    facts: { getRuntimeCarrierFact: reference => {
      const selectedCarrier = carriers.get(reference);
      return selectedCarrier === undefined ? undefined : { carrier: selectedCarrier };
    } },
    objectRepresentations: { receiverCaptures: { fixedSelfFor: node => node === callable ? selected : undefined } },
  } } };
}

test("fixed field self facts carry one exact dense relation without competing field storage", () => {
  assert.equal(rustClosureCaptureFactKey.equals(fact, { ...fact, recursiveField: { ...field } }), true);
  for (const changed of [
    { ...field, declaration: {} }, { ...field, receiver: {} }, { ...field, reference: {} },
    { ...field, references: [] }, { ...field, references: [references[0], {}] },
    { ...field, references: Array(2) }, { ...field, references: [...references].reverse() },
    { ...field, carrier: stringCarrier }, { ...field, unchecked: true },
  ]) assert.equal(rustClosureCaptureFactKey.equals(fact, { ...fact, recursiveField: changed }), false);
  for (const changed of [
    { ...fact, recursiveDeclaration: {} }, { ...fact, recursiveField: undefined },
    { ...fact, recursiveField: { ...field, declaration: undefined }, recursiveDeclaration: undefined },
    { ...fact, receiverFields: [{ ...field, storage: { kind: "shared", initialization: "deferred" } }] },
  ]) assert.equal(rustClosureCaptureFactKey.equals(fact, changed), false);
});

test("fixed self schema rejects accessors without reading their hidden values", () => {
  let reads = 0;
  for (const key of ["declaration", "receiver", "reference", "references", "carrier"]) {
    const changed = { ...field };
    Object.defineProperty(changed, key, { enumerable: true, get() { reads += 1; return field[key]; } });
    assert.equal(rustClosureCaptureFactKey.equals(fact, { ...fact, recursiveField: changed }), false);
  }
  assert.equal(reads, 0, "metadata validation never executes a getter");
});

test("planner consumes only the independently sealed field origin and reference carriers", () => {
  const exact = context();
  assert.equal(validateRustRecursiveReceiverField(callable, fact, carrier, exact), true);
  assert.equal(exact.diagnostics.length, 0);
  for (const changed of [
    { ...fact, recursiveField: undefined }, { ...fact, recursiveDeclaration: {} },
    { ...fact, recursiveField: { ...field, declaration: {} } },
    { ...fact, recursiveField: { ...field, receiver: {} } },
    { ...fact, recursiveField: { ...field, references: [references[0]] } },
    { ...fact, recursiveField: { ...field, references: [...references].reverse(), reference: references[1] } },
    { ...fact, recursiveField: { ...field, carrier: stringCarrier } },
    { ...fact, recursiveField: { ...field, unchecked: true } },
    { ...fact, invocationOwner: "shared-state" },
    { ...fact, captures: [{ declaration: {}, reference: {}, carrier: stringCarrier, storage: "value" }] },
    { ...fact, receivers: [{ owner: {}, reference: references[0], references: [references[0]], carrier }] },
    { ...fact, receiverFields: [{ ...field, storage: { kind: "shared", initialization: "deferred" } }] },
  ]) {
    const selected = context();
    assert.equal(validateRustRecursiveReceiverField(callable, changed, carrier, selected), false);
    assert.equal(selected.diagnostics.length, 1, "mismatched self relation rejects before planning");
  }
  for (const carriers of [new Map(), new Map([[references[0], carrier], [references[1], stringCarrier]])]) {
    const selected = context({ carriers });
    assert.equal(validateRustRecursiveReceiverField(callable, fact, carrier, selected), false);
    assert.equal(selected.diagnostics.length, 1);
  }
  const unselected = context();
  unselected.input.program.objectRepresentations.receiverCaptures.fixedSelfFor = () => undefined;
  assert.equal(validateRustRecursiveReceiverField(callable, fact, carrier, unselected), false);
});

function construction(expression, issues = []) {
  const selected = context();
  selected.syntheticNames = { reserved: new Set(), nextSuffixByBase: new Map() };
  selected.input.program.frozenDataWrites = { capturesFieldIdentity: () => false };
  selected.input.program.callableValues = { frames: {
    definitionForOwner: () => undefined, bindingFor: () => undefined,
  } };
  selected.input.program.facts.getFact = () => undefined;
  selected.input.program.objectRepresentations.receiverCaptures = {
    fixedSelfForReference: reference => references.includes(reference) ? field : undefined,
    isCaptured: () => false,
    storageDeclaration: selectedDeclaration => selectedDeclaration,
  };
  const definition = { declaration };
  const sourceField = { declaration, owner: definition, initializer: callable };
  const point = { initializedFields: [], possiblyInitializedFields: [], published: false,
    publishBefore: false, publishAfter: false, publishMissingElse: false };
  const plan = { definition, fields: [sourceField], layers: [], issues,
    layerHasEarlyReturn: () => false, pointFor: () => point,
    expressions: [expression], expressionsWithin: () => [expression] };
  const type = { kind: "named", path: "Callable" };
  const body = planRustConstructionBody(plan,
    [{ declaration, storageIndex: 0, targetName: "recurse", carrier, type, storageType: type }],
    carrier, type, () => ({ kind: "path", path: "constructed" }), selected);
  return { body, selected };
}

test("fixed self construction skips only the proven deferred edge, not readiness or other field uses", () => {
  const expression = { kind: "capture", node: references[0], declaration, receiver };
  const { body, selected } = construction(expression);
  assert.equal(body !== undefined, true);
  const prepared = body.prepare(callable, selected);
  assert.equal(prepared !== undefined, true);
  assert.equal(prepared.context.capturedFieldOwners.size, 0, "self does not capture a construction slot");
  assert.equal(prepared.context.valueFieldLocations.size, 0);
  assert.equal(prepared.context.expressionOverrides.has(references[0]), false, "the callable invocation owns its self override");
  assert.equal(selected.diagnostics.length, 0);
  const direct = construction({ ...expression, kind: "field" });
  const read = direct.body.prepare(callable, direct.selected);
  assert.equal(read.context.expressionOverrides.has(references[0]), true, "ordinary field reads keep their construction projection");
  const altered = construction({ ...expression, declaration: {} });
  assert.equal(altered.body.prepare(callable, altered.selected) === undefined, true, "a changed readiness declaration cannot elide a field owner");
  assert.equal(altered.selected.diagnostics.length, 1);
  const unproved = construction({ ...expression, node: {} });
  assert.equal(unproved.body.prepare(callable, unproved.selected) === undefined, true, "an unknown capture still requires its physical contract");
  assert.equal(unproved.selected.diagnostics.length, 1);
  const incomplete = construction(expression, [{ node: callable, reason: "required storage is not initialized" }]);
  assert.equal(incomplete.body === undefined, true, "the existing readiness rejection remains authoritative");
  assert.equal(incomplete.selected.diagnostics.length, 1);
});

test("ordinary and lexical recursive callables do not inherit field-self evidence", () => {
  const selected = context();
  selected.input.program.objectRepresentations.receiverCaptures.fixedSelfFor = () => undefined;
  for (const capture of [{ captures: [], receivers: [], receiverFields: [] },
    { captures: [], receivers: [], receiverFields: [], recursiveDeclaration: {} }]) {
    assert.equal(validateRustRecursiveReceiverField(callable, capture, carrier, selected), true);
  }
  assert.equal(selected.diagnostics.length, 0);
});

test("field self overrides preserve unrelated storage and clone only owned value reads", () => {
  const unrelated = {};
  const existing = { expression: { kind: "path", path: "other" }, carrier: stringCarrier, valueForm: "storage" };
  const overrides = new Map([[unrelated, existing]]);
  const locations = new Map([[unrelated, {}]]);
  const owner = { kind: "path", path: "recursive" };
  const selected = rustRecursiveReceiverFieldContext(field, owner, { expressionOverrides: overrides, valueFieldLocations: locations });
  assert.equal(selected.valueFieldLocations === locations, true, "physical demand is not rebuilt in the planner");
  assert.equal(selected.expressionOverrides.get(unrelated) === existing, true, "unrelated environment is unchanged");
  assert.equal(overrides.size, 1, "the enclosing context is unchanged");
  for (const reference of references) {
    const replacement = selected.expressionOverrides.get(reference);
    assert.equal(replacement.expression === owner, true, "all exact field references share the same invocation identity");
    assert.equal(replacement.carrier === carrier, true);
    assert.equal(replacement.valueForm, "storage", "first-class reads retain the existing owning-read protocol");
  }
  assert.equal(selected.expressionOverrides.has({}), false, "a same-looking node does not select self");
});
