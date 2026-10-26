import assert from "node:assert/strict";
import test from "node:test";
import { selectRustObjectNativeLifetimeContract } from "../../../dist/policy/types/objects/representation.js";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { createRustRecordFixture } from "../../helpers/records.mjs";
import { prepareRustProjectCallableFieldStorage } from "../../../dist/analysis/callables/project-field-storage.js";
import { rustGenericCallableTargetType, rustGenericCallableValue } from "../../../dist/target-model/types/carriers/generic-callables.js";
import { rustFrameCallableTargetType } from "../../../dist/target-model/types/carriers/frame-callables.js";
import { rustCallableInputTargetType, rustCallableTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { receiverFieldCaptureEdges } from "../../../../tsonic/test/fixtures/receiver-field-capture-edges.mjs";
import { rustStructuralObjectTargetType, rustStructuralObjectCarrierValue } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustCallableProtocol } from "../../../dist/target-model/types/carriers/callables.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustRuntimeCallableTargetType } from "../../../dist/target-model/types/carriers/runtime-carriers.js";
import { rustNamedTargetType, rustNamedTypeCarrierValue } from "../../../dist/target-model/types/carriers/native.js";
import { closeRustRetainedCallableCarrier } from "../../../dist/policy/ownership/retained-storage.js";
import { rustOptionElementCarrier, rustOptionTargetType } from "../../../dist/target-model/types/carriers/optional.js";
import { rustCallableConversionSource } from "../../../dist/target-model/conversions/callable-physical.js";

const bool = { kind: "source-primitive", name: "bool" };
const parameter = { kind: "type-parameter", identity: "Value", name: "Value" };
const origin = { fileName: "/source.ts", declarationIdentity: "/source.ts:1" };
const generic = rustGenericCallableTargetType([parameter], [parameter], parameter, origin);
const frame = rustFrameCallableTargetType([bool], bool, { kind: "lexical", origin });
const ordinary = rustCallableTargetType([bool], bool);

test("owned physical callable fields close only their open storage environment at the original declaring owner", () => {
  const inputLifetime = { kind: "parameter", identity: "field:argument", name: "argument" };
  const reference = { kind: "reference", referent: bool, mutable: false, lifetime: inputLifetime };
  const error = rustNamedTargetType("rust.core.Infallible", "core::convert::Infallible");
  const completion = rustNamedTargetType("rust.core.Result", "core::result::Result", [
    { kind: "type", type: reference }, { kind: "type", type: error },
  ]);
  for (const [label, ownerParameters, environment, expected] of [
    ["owned open", [], { kind: "placeholder" }, "static"],
    ["borrowed open", [{ kind: "lifetime" }], { kind: "placeholder" }, "placeholder"],
    ["selected named", [], inputLifetime, "parameter"],
  ]) {
    const declaration = {};
    const owner = { genericParameters: ownerParameters };
    const inherited = { genericParameters: [] };
    const logical = rustCallableTargetType([reference], reference, environment);
    const physical = rustRuntimeCallableTargetType(environment, [reference], completion);
    const construction = prepareRustProjectCallableFieldStorage({ ast: {},
      objectRepresentations: { nativeLifetimeFor: selected => selectRustObjectNativeLifetimeContract(selected, false) },
      records: createRustRecordFixture({ runtimeCarrier: { get: node => node === declaration ? { carrier: logical } : undefined } }),
      projectTypes: { definitions: [inherited], objectLayoutForDefinition: () => ({ fields: [{ declaration }] }),
        definitionContainingDeclaration: node => node === declaration ? owner : undefined },
      storage: { subject: node => ({ kind: "resolved", subject: { node, kind: "member", projection: [] } }), failureReason: () => undefined },
    }, () => ({ kind: "selected", carrier: physical, sources: [], inputs: [] }));
    const selected = construction.get(declaration);
    const before = rustNamedTypeCarrierValue(physical);
    const after = rustNamedTypeCarrierValue(selected);
    assert.equal(after !== undefined, true, `${label}: the physical callable representation is preserved`);
    assert.equal(after.genericArguments[0].lifetime.kind, expected, `${label}: original declaring storage owns the open environment`);
    assert.equal(after.genericArguments[1] === before.genericArguments[1], true, `${label}: borrowed invocation inputs retain exact identity`);
    assert.equal(after.genericArguments[2] === before.genericArguments[2], true, `${label}: result and error channels retain exact identity`);
    assert.equal(after.traits === before.traits && after.genericDefaults === before.genericDefaults && after.upcasts === before.upcasts,
      true, `${label}: native traits, defaults and upcasts are not reconstructed`);
    if (expected !== "static") assert.equal(selected === physical, true, `${label}: actual selected environments are never retagged`);
    assert.equal(construction.seal().kind, "resolved", `${label}: canonical physical storage seals without reselecting`);
    assert.equal(construction.get(declaration) === selected, true, `${label}: publication retains the selected storage identity`);
  }
});

test("stored callable completion preserves source optional metadata and authored optional witness identity", () => {
  const error = rustNamedTargetType("rust.core.Infallible", "core::convert::Infallible");
  const completion = rustNamedTargetType("rust.core.Result", "core::result::Result", [
    { kind: "type", type: bool }, { kind: "type", type: error },
  ]);
  const physical = rustRuntimeCallableTargetType({ kind: "placeholder" }, [], completion);
  const option = { ...rustOptionTargetType(physical), sourceAbsence: true };
  const binder = { kind: "type-parameter", identity: "field:optional", name: "OptionalField", optionalStorageValue: physical };
  for (const original of [option, binder]) {
    const selected = closeRustRetainedCallableCarrier(original, { kind: "static" });
    const payload = rustOptionElementCarrier(selected);
    assert.equal(rustNamedTypeCarrierValue(payload)?.genericArguments[0].lifetime.kind, "static", "only the stored payload environment closes");
    assert.equal(selected.kind, original.kind, "the optional container or authored binder representation is unchanged");
    if (original === option) assert.equal(selected.sourceAbsence, true, "one source absence retains its existing metadata");
    else assert.equal(selected.identity === binder.identity && selected.name === binder.name, true, "the quantified optional witness is preserved exactly");
    assert.equal(closeRustRetainedCallableCarrier(selected, { kind: "static" }) === selected, true, "completed storage is stable by identity");
  }
});

test("physical member selection completes structural getter storage once without rewriting input lifetimes", () => {
  const declaration = Object.freeze({ field: "read" });
  const owner = Object.freeze({ class: "Owner", genericParameters: [] });
  const inputLifetime = { kind: "parameter", identity: "read:input", name: "input" };
  const reference = { kind: "reference", referent: bool, mutable: false, lifetime: inputLifetime };
  const logical = rustCallableTargetType([reference], reference);
  const physical = rustCallableTargetType([reference], reference, { kind: "static" });
  const target = rustStructuralObjectTargetType("/source.ts", [
    { sourceName: "read", type: logical, presence: "required", readonly: true },
  ], "reference");
  const subject = Object.freeze({ node: declaration, kind: "member", projection: [] });
  let queries = 0;
  const construction = prepareRustProjectCallableFieldStorage({ ast: {},
    objectRepresentations: { nativeLifetimeFor: selected => selectRustObjectNativeLifetimeContract(selected, false) },
    records: createRustRecordFixture({ runtimeCarrier: { get: node => node === declaration ? { carrier: logical } : undefined } }),
    projectTypes: { definitions: [owner], definitionContainingDeclaration: () => owner,
      objectLayoutForDefinition: () => ({ fields: [{ declaration }] }),
      instantiateMemberCarrier: (selected, receiver, carrier) => selected === declaration && receiver === bool ? carrier : undefined },
    storage: { subject: () => ({ kind: "resolved", subject }), failureReason: () => undefined },
  }, (selected, carrier) => {
    assert.equal(selected === subject && carrier === logical, true, "the original member owns the one exact native storage request");
    queries++;
    return { kind: "selected", carrier: physical, sources: [], inputs: [] };
  });
  const views = [{ declaration: owner, sourceCarrier: bool, targetCarrier: target,
    fields: [{ declaration, storageIndex: 0, field: { resultCarrier: logical } }] }];
  let completed;
  const issues = construction.completeViews(views, { completePhysicalCarrier(source, selected) {
    assert.equal(source === target, true, "the original structural contract retains its owner identity");
    completed = selected;
    return { kind: "resolved", carrier: selected };
  } });
  assert.equal(issues.length, 0, "physical field evidence is available before canonical structural close");
  const protocol = rustCallableProtocol(rustStructuralObjectCarrierValue(completed)?.fields[0].type);
  assert.equal(protocol?.lifetime.kind, "static", "the destination receives the actually selected native environment");
  assert.equal(protocol.parameters[0] === reference && protocol.result === reference, true,
    "signature-only borrowed input and result lifetimes are never rewritten as owned storage");
  assert.equal(rustTargetTypeRefEquals(protocol.error, rustCallableProtocol(logical).error), true,
    "the getter's separate declared error channel is not taken from its stored callable");
  assert.equal(construction.get(declaration) === physical, true, "the field reader publishes the original physical selection by identity");
  assert.equal(construction.seal().kind, "resolved", "the completed physical field closes through the same owner");
  assert.equal(queries, 1, "preclose completion and sealing share one native field query");
});

for (const [label, carrier, required] of [
  ["ordinary callable", ordinary, true],
  ["generic callable", generic, true],
  ["frame callable", frame, true],
  ["formal callable input", rustCallableInputTargetType([bool], bool), true],
  ["nested generic storage", { kind: "tuple", elements: [bool, generic] }, true],
  ["plain native field", bool, false],
  ["fixed function pointer signature", { kind: "function-pointer", args: [generic], result: generic }, false],
  ["native closure signature", { kind: "closure", args: [generic], result: generic, callTrait: "Fn" }, false],
]) test(`project field ${label} has exactly its actual physical storage obligation`, () => {
  assert.equal(carrier !== undefined, true, `${label}: the canonical carrier constructor accepts its actual contract`);
  const declaration = Object.freeze({ label });
  const definition = Object.freeze({ genericParameters: [] });
  const subject = Object.freeze({ node: declaration, kind: "member", projection: [] });
  let selections = 0;
  const construction = prepareRustProjectCallableFieldStorage({
    objectRepresentations: { nativeLifetimeFor: selected => selectRustObjectNativeLifetimeContract(selected, false) },
    ast: {}, records: createRustRecordFixture({ runtimeCarrier: { get: node => node === declaration ? { carrier } : undefined } }),
    projectTypes: { definitions: [definition], definitionContainingDeclaration: () => definition,
      objectLayoutForDefinition: () => ({ fields: [{ declaration }] }) },
    storage: { subject(node, kind) {
      assert.equal(node === declaration && kind === "member", true, `${label}: selection uses its actual original member`);
      return { kind: "resolved", subject };
    }, failureReason: () => undefined },
  }, (selected, logical) => {
    selections++;
    assert.equal(selected === subject && logical === carrier, true, `${label}: the native owner receives the complete unchanged field input`);
    return { kind: "unresolved", reason: "fixture has no admitted physical constructor" };
  });
  const sealed = construction.seal();
  assert.equal(selections, required ? 1 : 0, `${label}: native signatures are not traversed as stored payloads`);
  assert.equal(sealed.kind, required ? "rejected" : "resolved", `${label}: missing required physical storage is never silently omitted`);
  if (required) {
    assert.equal(sealed.diagnostics.length, 1, `${label}: the one field has one owning refusal`);
    assert.equal(sealed.diagnostics[0].sourceNode === declaration, true, `${label}: refusal keeps the original field identity`);
    assert.equal(sealed.diagnostics[0].message, "fixture has no admitted physical constructor", `${label}: the native owner's exact refusal survives`);
  } else assert.equal(sealed.value.get(declaration), undefined, `${label}: plain native storage has no invented callable body`);
});

for (const surfaces of [[], ["js"]]) test(`checked generic receiver fields publish physical storage in ${surfaces[0] ?? "native"}`, () => {
  const example = receiverFieldCaptureEdges.find(value => value.name === "generic-callable-aliases");
  assert.equal(example !== undefined, true, "the original alias/replacement native program remains the control");
  const { program } = analyzeRust({ surfaces, files: { "index.ts": example.source } });
  const { ast } = program.source;
  const fields = [];
  const visit = node => {
    if (ast.is.IsPropertyDeclaration(node) && ast.text(ast.name(node)) === "choose") fields.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(fields.length, 1, "the source has one actual generic field slot");
  const declaration = fields[0];
  const logical = program.records.runtimeCarrier.get(declaration)?.carrier;
  assert.equal(rustGenericCallableValue(logical) !== undefined, true, "the original checked logical field is quantified");
  const physical = program.callableValues.projectFieldStorage.get(declaration);
  assert.equal(rustGenericCallableValue(physical)?.physical !== undefined, true, "the native field has its completed physical family");
  assert.equal(program.callableValues.projectFieldStorage.get(declaration) === physical, true,
    "the published reader retains the single original native storage selection");
  assert.equal(Object.isFrozen(physical), true, "the final native storage is immutable");
});

for (const surfaces of [[], ["js"]]) test(`checked inherited callable fields publish owned physical storage in ${surfaces[0] ?? "native"}`, () => {
  const example = receiverFieldCaptureEdges.find(value => value.name === "generic-overridden-fields");
  assert.equal(example !== undefined, true, "the original inherited native program is the control");
  const { program } = analyzeRust({ surfaces, files: { "index.ts": example.source } });
  const { ast } = program.source;
  const fields = [];
  const visit = node => {
    if (ast.is.IsPropertyDeclaration(node) && ast.text(ast.name(node)) === "read") fields.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(fields.length, 1, "the inherited field retains one original source declaration");
  const declaration = fields[0];
  const owner = program.projectTypes.definitionContainingDeclaration(declaration);
  assert.equal(owner !== undefined, true, "the physical field retains its original generic class owner");
  const selected = program.callableValues.projectFieldStorage.get(declaration);
  assert.equal(rustCallableConversionSource(selected)?.lifetime?.kind, "static", "owned physical storage has no elided environment lifetime");
  const carrier = program.projectTypes.openCarrier(owner);
  const emitted = program.records.projectClassFields.get(owner, carrier)?.find(field => field.declaration === declaration);
  assert.equal(emitted !== undefined, true, "the state layout retains the actual selected field");
  assert.equal(rustCallableConversionSource(emitted.carrier)?.lifetime?.kind, "static", "state publication preserves the selected owned environment");
  const instantiated = program.projectTypes.instantiateMemberCarrier(declaration, carrier, selected);
  assert.equal(rustTargetTypeRefEquals(emitted.carrier, instantiated), true, "the state field is exactly the original physical selection under its receiver bindings");
});
