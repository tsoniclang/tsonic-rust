import assert from "node:assert/strict";
import test from "node:test";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { analyzeRustReceiverCaptureEmission, validatedRustCapturedFieldStorageFact } from "../../../dist/analysis/storage/receiver-captures.js";
import { createRustReceiverCaptureEmissionProducer } from "../../../dist/analysis/program/records/callables/receiver-captures.js";
import { rustClosureCaptureEquals } from "../../../dist/target-model/records/operations/equality.js";
import { int32Carrier, stringCarrier } from "../../helpers/rust-session.mjs";

function membershipFixture() {
  const declaration = {};
  const receiver = {};
  const references = [{}, {}];
  const callable = {};
  const field = { declaration, receiver, reference: references[0], references,
    carrier: int32Carrier, storage: { kind: "cell", initialization: "ready" } };
  const capture = { captures: [], receivers: [], receiverFields: [field] };
  const source = { declaration, receiver, reference: references[0], references };
  const admit = (selected = field, membership = source, carriers = new Map(references.map(reference => [reference, int32Carrier]))) => {
    const producer = createRustReceiverCaptureEmissionProducer(() => {});
    const selectedCapture = { ...capture, receiverFields: [selected] };
    const issues = analyzeRustReceiverCaptureEmission({
      source: { ast: { kindName: () => "KindArrowFunction" } },
      records: createRustRecordFixture({
        closureCapture: { get: node => node === callable ? selectedCapture : undefined },
        runtimeCarrier: { get: node => carriers.has(node) ? { carrier: carriers.get(node) } : undefined },
        capturedFieldStorage: { get: node => node === declaration ? { storage: field.storage, valueCarrier: field.carrier } : undefined },
      }),
      projectTypes: { definitionForCarrier: () => undefined },
      objectRepresentations: { representationFor: () => undefined, receiverCaptures: {
        receiversFor: () => [], capturesFor: () => [membership], fixedSelfFor: () => undefined,
      } },
    }, [callable], producer);
    return { issues, records: producer.records };
  };
  return { declaration, receiver, references, field, capture, source, admit };
}

test("canonical inherited storage retains exact capture membership, not a same-named field", () => {
  const selected = membershipFixture();
  const positive = selected.admit();
  assert.equal(positive.issues.length, 0, "the exact admitted source membership");
  assert.equal("capturedFieldIdentity" in positive.records, false, "no freeze-only capture family");
  for (const changed of [
    { ...selected.field, declaration: {} },
    { ...selected.field, receiver: {} },
    { ...selected.field, reference: {} },
    { ...selected.field, references: [selected.references[0]] },
    { ...selected.field, references: [...selected.references].reverse(), reference: selected.references[1] },
    { ...selected.field, carrier: stringCarrier },
    { ...selected.field, storage: { kind: "borrow-cell", initialization: "ready" } },
  ]) {
    assert.equal(selected.admit(changed).issues.some(issue =>
      issue.evidence.includes("target.capability=rust.backend.receiver-field-capture")), true,
    "a foreign owner, occurrence, carrier or storage is rejected");
  }
});

test("receiver-field admission rejects missing or foreign reference carriers without inventing identity", () => {
  const selected = membershipFixture();
  for (const carriers of [
    new Map(),
    new Map([[selected.references[0], int32Carrier]]),
    new Map(selected.references.map(reference => [reference, stringCarrier])),
  ]) {
    assert.equal(selected.admit(selected.field, selected.source, carriers).issues.length > 0, true,
      "every exact checked reference carrier remains required");
  }
});

test("ordinary capture equality preserves ordered membership and storage after freeze removal", () => {
  const selected = membershipFixture();
  assert.equal(rustClosureCaptureEquals(selected.capture, {
    ...selected.capture, receiverFields: [{ ...selected.field, references: [...selected.references] }],
  }), true, "equivalent native capture evidence");
  for (const changed of [
    { ...selected.field, declaration: {} }, { ...selected.field, receiver: {} },
    { ...selected.field, reference: {} }, { ...selected.field, carrier: stringCarrier },
    { ...selected.field, references: [selected.references[0]] },
    { ...selected.field, references: [...selected.references].reverse(), reference: selected.references[1] },
    { ...selected.field, storage: { kind: "borrow-cell", initialization: "ready" } },
    { ...selected.field, unchecked: true },
  ]) {
    assert.equal(rustClosureCaptureEquals(selected.capture, {
      ...selected.capture, receiverFields: [changed],
    }), false, "membership, exact carrier and native storage are not weakened");
  }
});

test("generic inherited storage uses the canonical declaration, not a concrete substitute or same-named field", () => {
  const declaration = {};
  const canonical = {};
  const generic = { kind: "type-parameter", name: "Value", identity: "fixture.Value" };
  const fact = { storage: { kind: "borrow-cell", initialization: "deferred" }, valueCarrier: int32Carrier };
  const program = (storageDeclaration = canonical, storageCarrier = generic) => ({
    records: createRustRecordFixture({
      capturedFieldStorage: { get: node => node === declaration ? fact : undefined },
      runtimeCarrier: { get: node => node === declaration ? { carrier: int32Carrier }
        : node === canonical ? { carrier: storageCarrier } : undefined },
    }),
    objectRepresentations: { receiverCaptures: {
      isCaptured: node => node === declaration,
      storageDeclaration: () => storageDeclaration, storageReadonly: () => false,
      storageImmutable: () => false, isDeferred: () => true,
    } },
  });
  assert.equal(validatedRustCapturedFieldStorageFact(declaration, program()) === fact, true, "exact generic physical storage");
  assert.equal(validatedRustCapturedFieldStorageFact(declaration, program({})), undefined, "a foreign canonical owner is rejected");
  assert.equal(validatedRustCapturedFieldStorageFact(declaration, program(canonical, int32Carrier)), undefined,
    "instantiated Copy does not replace the generic native storage");
});
