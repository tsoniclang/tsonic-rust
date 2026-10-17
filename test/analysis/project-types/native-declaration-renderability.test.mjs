import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, artifactText, compileRust, acmeTestingPackage } from "../../helpers/rust-session.mjs";
import { selectRustNativeTypeCarrier, selectRustNativeCallTypeCarrier, rustNativeSourceTypePath, rustNativeStructuralTypePath } from "../../../dist/policy/types/model/native-type-selection.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustNamedTargetType, rustNamedTypeCarrierValue } from "../../../dist/target-model/types/carriers/native.js";
import { rustTypeFromCarrier } from "../../../dist/backend/planner/types/render.js";
import { printRustType } from "../../../dist/print/source/types.js";
import { compoundTypeFamilyOwnerFiles } from "../../fixtures/compound-type-family-owners.mjs";
import { rustRuntimeErrorTargetType, rustRuntimeErrorTypeIdentity } from "../../../dist/target-model/operations/error-boundary.js";
import { admitRustNativeValueDeclaration } from "../../../dist/analysis/declarations/native-value-declarations.js";
import { rustRuntimeRecordFieldTargetType } from "../../../dist/target-model/types/carriers/runtime-carriers.js";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { nativeDeclarationSelectionInput } from "../../helpers/native-type-selection.mjs";
import { rustProducerErrorTargetType } from "../../../dist/target-model/types/carriers/producer-errors.js";
import { rustNativeErrorJoinTargetType } from "../../../dist/target-model/types/native-error-joins.js";
import { selectRustNativeTypeItemNames } from "../../../dist/analysis/names/source-output-identities.js";

const integer = { kind: "source-primitive", name: "int32" };

function selectionInput(overrides = {}) {
  return {
    typeDefinitions: emptyRustTypeDefinitions,
    typeParameterNames: undefined,
    pathFor: () => undefined,
    additionalArgumentsFor: () => undefined,
    programErrorCarrier: () => undefined,
    producerErrorCarrier: () => undefined,
    nativeErrorJoinCarrier: () => undefined,
    structuralCarrier: () => undefined,
    ...overrides,
  };
}

function declaration(source, name) {
  return source.ast.statements(source.getSourceFile("/src/index.ts"))
    .find(node => source.ast.text(source.ast.name(node)) === name);
}

test("native record state, index and fields carry selected native type data before publication", () => {
  const { source, program } = analyzeRust({ files: { "index.ts": `
export interface Entry { value: number; next: Entry | undefined; }
export interface Entries { [key: string]: number; }
` } });
  for (const name of ["Entry", "Entries"]) {
    const selected = program.nativeDeclarations.get(declaration(source, name));
    assert.equal(selected?.kind, "interface", `${name}: the existing native declaration is admitted`);
    assert.equal(rustNamedTypeCarrierValue(selected.nativeCarrier) !== undefined, true,
      `${name}: the open native type is selected, not a source carrier to reclassify`);
    assert.equal(rustNamedTypeCarrierValue(selected.nativeStateCarrier) !== undefined, true,
      `${name}: exact native state type is selected`);
    assert.equal(Object.isFrozen(selected.nativeCarrier) && Object.isFrozen(selected.nativeStateCarrier), true,
      `${name}: native type selections are immutable`);
    for (const field of selected.fields) {
      assert.equal(field.nativeCarrier !== undefined, true, `${name}.${field.sourceName}: required native field type`);
      assert.equal(field.declaration === program.projectTypes.objectLayoutForDefinition(selected.definition)
        .fields[field.storageIndex].declaration, true, `${name}.${field.sourceName}: original physical slot identity`);
      assert.equal(Object.isFrozen(field.nativeCarrier), true, `${name}.${field.sourceName}: immutable native field type`);
    }
    if (name === "Entries") {
      assert.equal(selected.index.nativeKeyCarrier !== undefined && selected.index.nativeValueCarrier !== undefined, true,
        "index storage has both exact selected native types");
    }
  }
});

test("conditional implementations publish their exact selected owner, trait and output types", () => {
  const { program } = analyzeRust({ files: compoundTypeFamilyOwnerFiles, packages: [acmeTestingPackage()] });
  const conditional = program.nativeDeclarations.implementations.filter(entry => entry.implementation.family.kind === "conditional");
  assert.equal(conditional.length > 0, true, "the complete checked source exercises conditional implementations");
  for (const selected of conditional) {
    assert.equal(selected.nativeTypes !== null, true, "a conditional implementation cannot omit native type evidence");
    assert.equal(Object.isFrozen(selected.nativeTypes), true, "the native implementation selection is immutable");
    for (const role of ["owner", "trait", "output"]) {
      assert.equal(selected.nativeTypes[role] !== undefined, true, `${role}: required selected native type`);
    }
  }
});

test("a native reference alias retains its exact authored lifetime and selected target", () => {
  const files = { "index.ts": `
import type { Life, Ref } from "@tsonic/rust/types.js";
import type { int32 } from "@tsonic/core/types.js";
export type Borrowed<Region extends Life> = Ref<int32, Region>;
export function keep<Region extends Life>(value: Borrowed<Region>): Borrowed<Region> { return value; }
` };
  const { source, program } = analyzeRust({ files });
  const alias = declaration(source, "Borrowed");
  const selected = program.nativeDeclarations.get(alias);
  assert.equal(selected?.kind, "alias", "the authored native alias remains participating");
  assert.equal(selected.fact.kind, "native-alias", "the source fact retains the exact native alias classification");
  assert.equal(selected.nativeCarrier.kind, "reference", "the published native form is already a reference");
  assert.equal(selected.nativeCarrier.lifetime.identity, selected.fact.target.lifetime.identity,
    "selection retains the source region identity instead of inventing a lifetime");
  assert.equal(selected.nativeCarrier.referent.name, "int32", "the exact native-width referent remains int32");
  assert.equal(Object.isFrozen(selected.nativeCarrier), true, "the selected alias target is immutable");
  const { result } = compileRust({ files });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(issue => issue.code).join(","));
  assert.match(artifactText(result, "src/index.rs"), /type Borrowed<'Region> = &'Region i32;/u,
    "the retained alias renders the selected native reference and authored region");
});

test("runtime payload selection keeps recursive source correspondence without unresolved payload types", () => {
  const files = { "index.ts": "export type Value = { value: number } | { next: Value };" };
  const { source, program } = analyzeRust({ files });
  const selected = program.nativeDeclarations.get(declaration(source, "Value"));
  assert.equal(selected.fact.kind, "runtime", "the actual recursive source needs native payload storage");
  assert.equal(selected.payloadTemplate !== null, true, "the physical payload correspondence is required");
  assert.equal(selected.payloadTemplate.variants.length, selected.fact.variants.length, "no native variant disappears");
  assert.equal(selected.payloadTemplate.variants.every(variant => Object.isFrozen(variant.carrier)), true,
    "every selected variant type is immutable");
  const { result } = compileRust({ files });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(issue => issue.code).join(","));
  assert.match(artifactText(result, "src/index.rs"), /pub enum Value/u, "the retained recursive union is emitted");
});

test("native type selection requires actual metadata and never guesses an opaque or foreign native form", () => {
  for (const [label, carrier] of [["opaque", { kind: "opaque", id: "missing-native" }],
    ["unregistered native", { kind: "target-named", id: "foreign.Unknown" }],
    ["pointer mode", { kind: "pointer", pointee: integer, mutability: "target-defined" }]]) {
    const selected = selectRustNativeTypeCarrier(carrier, selectionInput(), "general");
    assert.equal(selected.kind, "rejected", `${label}: an unresolved native form is not admitted`);
    assert.equal(selected.subject === carrier, true, `${label}: original rejected carrier identity is retained`);
    assert.equal(selected.reason.length > 0, true, `${label}: precise owning native refusal`);
  }
});

test("declaration admission rejects each unavailable native slot before publishing its form", () => {
  const { source, program } = analyzeRust({ files: { "index.ts": `
import type { Life, Ref } from "@tsonic/rust/types.js";
import type { int32 } from "@tsonic/core/types.js";
export interface Entry { value: number; }
export interface Entries { [key: string]: number; }
export type Borrowed<Region extends Life> = Ref<int32, Region>;
export type Value = { value: number } | { next: Value };
export function keep<Region extends Life>(value: Borrowed<Region>): Borrowed<Region> { return value; }
` } });
  const input = { ast: source.ast, semanticsFor: createTargetSourceProgram(source).semantics.forNode,
    records: program.records, names: program.names, projectTypes: program.projectTypes,
    typeDefinitions: program.typeDefinitions, sourceLifetimes: program.sourceLifetimes,
    objectRepresentations: program.objectRepresentations, typeFamilies: program.typeFamilies,
    ...nativeDeclarationSelectionInput(program) };
  const entry = declaration(source, "Entry");
  const field = source.ast.members(entry)[0];
  const entries = declaration(source, "Entries");
  const index = source.ast.members(entries)[0];
  const alias = declaration(source, "Borrowed");
  const union = declaration(source, "Value");
  const unavailable = { kind: "opaque", id: "fixture:unavailable-native-slot" };
  const carrierInput = (subject, carrier) => ({ ...input, records: { ...input.records, runtimeCarrier: {
    get: node => node === subject ? { carrier } : input.records.runtimeCarrier.get(node),
  } } });
  const aliasFact = input.records.typeAliasDeclaration.get(alias);
  const templateFor = input.typeDefinitions.sourceUnionPayloadTemplate;
  const template = program.nativeDeclarations.get(union).payloadTemplate;
  assert.equal(template !== null, true, "the actual source supplies a native union payload contract");
  const cases = [
    ["record field", entry, carrierInput(field, unavailable), field, "RUST_INTERFACE_FIELD_TYPE_NOT_REPRESENTABLE"],
    ["record state", entry, { ...input, nativeStateCarrierFor: () => unavailable }, entry, "RUST_INTERFACE_NATIVE_TYPE_NOT_REPRESENTABLE"],
    ["missing record state", entry, { ...input, nativeStateCarrierFor: () => undefined }, entry, "RUST_INTERFACE_NATIVE_STATE_NOT_CLOSED"],
    ["index value", entries, carrierInput(index, rustRuntimeRecordFieldTargetType(integer, unavailable)), index,
      "RUST_INTERFACE_INDEX_TYPE_NOT_REPRESENTABLE"],
    ["native alias", alias, { ...input, records: { ...input.records, typeAliasDeclaration: {
      get: node => node === alias ? { ...aliasFact, target: unavailable } : input.records.typeAliasDeclaration.get(node),
    } } }, alias, "RUST_TYPE_ALIAS_NATIVE_TYPE_NOT_REPRESENTABLE"],
    ["union payload", union, { ...input, typeDefinitions: { ...input.typeDefinitions,
      sourceUnionPayloadTemplate: carrier => {
        const selected = templateFor(carrier);
        return selected === undefined ? undefined : { ...selected,
          variants: selected.variants.map((variant, position) => position === 0 ? { ...variant, carrier: unavailable } : variant) };
      },
    } }, union, "RUST_TYPE_ALIAS_PAYLOAD_TYPE_NOT_REPRESENTABLE"],
  ];
  for (const [label, subject, selectedInput, expectedNode, code] of cases) {
    const selected = admitRustNativeValueDeclaration(subject, selectedInput);
    assert.equal(selected.kind, "rejected", `${label}: unresolved native storage is refused at admission`);
    assert.equal(selected.form === undefined, true, `${label}: no native declaration is published`);
    assert.equal(selected.diagnostics.length, 1, `${label}: one deciding owner reports the refusal`);
    assert.equal(selected.diagnostics[0].code, code, `${label}: precise native admission code`);
    assert.equal(selected.diagnostics[0].sourceNode === expectedNode, true, `${label}: identical source declaration or member`);
  }
});

test("one native selector enforces position and retains the exact callable lifetime binder", () => {
  const closure = { kind: "closure", callTrait: "FnMut", args: [integer], result: integer };
  assert.equal(selectRustNativeTypeCarrier(closure, selectionInput(), "general").kind, "rejected",
    "anonymous callable types are not manufactured for stored native fields");
  assert.equal(selectRustNativeTypeCarrier(closure, selectionInput(), "parameter").kind, "resolved",
    "the same native anonymous callable is legal in its parameter position");
  const lifetime = { kind: "bound", binderIdentity: "callback", identity: "callback:value", name: "value" };
  const carrier = { kind: "function-pointer", args: [{ kind: "reference", referent: integer, mutable: false, lifetime }],
    result: integer, lifetimeBinder: { identity: "callback", parameters: [{ lifetime, outlives: [] }] } };
  const selected = selectRustNativeTypeCarrier(carrier, selectionInput(), "general");
  assert.equal(selected.kind, "resolved", "a nameable higher-ranked function pointer remains supported");
  assert.equal(selected.carrier.lifetimeBinder.identity, "callback", "the exact native binder identity survives selection");
  assert.equal(printRustType(rustTypeFromCarrier(selected.carrier)), "for<'value> fn(&'value i32) -> i32",
    "binder and argument lifetimes are preserved in native syntax");
});

test("selected native error identity never infects ordinary native name equality", () => {
  const plain = rustNamedTargetType("native.Ordinary", "native::Ordinary");
  const selected = rustNamedTargetType("native.Error", "native::Error", [], [], undefined, [], "native:error-owner");
  const ordinarySyntax = rustTypeFromCarrier(plain);
  const errorSyntax = rustTypeFromCarrier(selected);
  assert.equal(Object.hasOwn(ordinarySyntax, "identity"), false, "ordinary names retain existing equality semantics");
  assert.equal(errorSyntax.identity, "native:error-owner", "only authoritative selected native error metadata reaches syntax");
  const runtime = rustRuntimeErrorTargetType();
  assert.equal(rustNamedTypeCarrierValue(runtime).nativeErrorIdentity, rustRuntimeErrorTypeIdentity,
    "the actual canonical runtime error producer supplies its own authoritative identity");
  assert.equal(rustTypeFromCarrier(runtime).identity, rustRuntimeErrorTypeIdentity,
    "runtime error provenance survives native selection and syntax without inferring identity from an arbitrary id");
});

test("native producer and join selection retain semantic cycle guards across fresh carrier instances", () => {
  const reference = { identity: "native:producer", fileName: "/src/index.ts", channel: "invoke", genericArguments: [] };
  let producerReads = 0;
  const producer = selectRustNativeTypeCarrier(rustProducerErrorTargetType(reference), selectionInput({
    producerErrorCarrier: selected => { producerReads += 1; return rustProducerErrorTargetType({ ...selected }); },
  }), "general");
  assert.equal(producer.kind, "rejected", "fresh producer-reference objects cannot bypass semantic recursion protection");
  assert.equal(producer.reason.includes("bounded acyclic"), true, "the producer refusal names its actual recursive evidence");
  assert.equal(producerReads, 1, "the repeated semantic producer is refused before querying it again");
  const joined = rustNativeErrorJoinTargetType("/src/index.ts", [integer, integer]);
  let joinReads = 0;
  const join = selectRustNativeTypeCarrier(joined, selectionInput({
    nativeErrorJoinCarrier: selected => {
      joinReads += 1;
      return rustNativeErrorJoinTargetType(selected.fileName, [...selected.errors]);
    },
  }), "general");
  assert.equal(join.kind, "rejected", "fresh native-join objects cannot bypass semantic recursion protection");
  assert.equal(join.reason.includes("bounded acyclic"), true, "the join refusal names its actual recursive evidence");
  assert.equal(joinReads, 1, "the repeated semantic join is refused before querying it again");
});

test("native generic call inference is selected from genuine native forms, never missing metadata", () => {
  const inferred = selectRustNativeCallTypeCarrier({ kind: "closure", args: [integer], result: integer }, selectionInput());
  assert.equal(inferred.kind, "inferred", "an anonymous native callable has the existing native infer disposition");
  const explicit = selectRustNativeCallTypeCarrier(integer, selectionInput());
  assert.equal(explicit.kind, "resolved", "a nameable exact-width native argument stays explicit");
  assert.equal(explicit.carrier.name, "int32", "explicit native width is retained");
  const missing = selectRustNativeCallTypeCarrier({ kind: "opaque", id: "missing:argument" }, selectionInput());
  assert.equal(missing.kind, "rejected", "unavailable evidence cannot become native inference");
  for (const arguments_ of [undefined, [], [{ kind: "type", type: integer }, { kind: "type", type: integer }]]) {
    const invalid = selectRustNativeCallTypeCarrier({ kind: "target-named", id: "rust.core.Future", genericArguments: arguments_ },
      selectionInput());
    assert.equal(invalid.kind, "rejected", "a Future name without its exact single output is not inference evidence");
  }
});

test("one native path owner preserves selected source facades and structural support identities", () => {
  const local = { moduleName: "records", currentModuleName: "records", typeName: "Entry", nativeProtocol: false,
    externalCrate: undefined, currentCrate: undefined, externalPublicPathFor: () => undefined };
  for (const [label, overrides, expected] of [
    ["local item", {}, "Entry"],
    ["other local module", { currentModuleName: "use_site" }, "crate::records::Entry"],
    ["external facade", { externalCrate: "dependency", externalPublicPathFor: () => "dependency::api::Entry" }, "dependency::api::Entry"],
    ["native protocol", { nativeProtocol: true }, "crate::records::Entry"],
    ["external native protocol", { nativeProtocol: true, externalCrate: "dependency" }, "dependency::records::Entry"],
    ["missing facade", { externalCrate: "dependency" }, undefined],
    ["missing module", { moduleName: undefined }, undefined],
    ["missing native item", { typeName: undefined }, undefined],
  ]) assert.equal(rustNativeSourceTypePath({ ...local, ...overrides }), expected, label);
  for (const [label, overrides] of [["local", {}], ["native protocol", { nativeProtocol: true }],
    ["external native protocol", { nativeProtocol: true, externalCrate: "dependency" }]]) {
    let facadeReads = 0;
    const selected = rustNativeSourceTypePath({ ...local, ...overrides,
      externalPublicPathFor: () => { facadeReads += 1; return undefined; } });
    assert.equal(selected !== undefined, true, `${label}: its selected native path does not depend on a facade`);
    assert.equal(facadeReads, 0, `${label}: an unrelated external facade is never queried`);
  }
  const structural = { targetName: "Shape", externalModuleName: undefined, externalCrate: undefined,
    currentCrate: undefined, currentModuleName: "records", structuralShapesModuleName: "shapes_2" };
  assert.equal(rustNativeStructuralTypePath(structural), "crate::shapes_2::Shape",
    "the selected collision-free support identity is not guessed from the preferred name");
  assert.equal(rustNativeStructuralTypePath({ ...structural, currentModuleName: "shapes_2" }), "Shape",
    "local structural syntax preserves its existing unqualified form");
  assert.equal(rustNativeStructuralTypePath({ ...structural, externalModuleName: "dependency::shapes_3",
    externalCrate: "dependency" }), "dependency::shapes_3::Shape", "an external shape retains its exact selected module");
});

test("authored and native protocol item names are selected once before publication without late name arbitration", () => {
  const { source, program } = analyzeRust({ surfaces: [], files: { "index.ts": `
export interface Entry { value: number; }
export function invoke(callback: () => number): number { return callback(); }
` } });
  const entry = declaration(source, "Entry");
  const fileName = source.ast.getFileName(source.ast.getSourceFile(entry));
  const selected = program.sourcePackageFacades.nativeTypeItemFor(fileName, "Entry");
  assert.equal(selected.targetName, "Entry", "the original authored item has its final native name");
  assert.equal(selected.nativeProtocol, false, "authored identity is not reclassified as a generated native protocol");
  assert.equal(Object.isFrozen(selected), true, "the item decision is immutable before consumers read it");
  assert.equal(program.sourcePackageFacades.nativeTypeItemFor("/foreign.ts", "Entry") === undefined, true,
    "a same-spelling foreign item never borrows a local identity");
  const neverRead = new Proxy({}, { get() { throw new Error("post-publication names/native protocol selection"); } });
  const input = nativeDeclarationSelectionInput({ ...program, names: neverRead, callableValues: neverRead })
    .nativeTypeInputFor(fileName, undefined);
  const ordinary = selectRustNativeTypeCarrier(program.projectTypes.openCarrier(program.projectTypes.definitionForDeclaration(entry)),
    input, "general");
  assert.equal(ordinary.kind, "resolved", "ordinary native rendering needs only its already-selected item identity");
  const protocols = program.callableValues.native.protocols;
  assert.equal(protocols.length > 0, true, "the actual checked callback selects a real native protocol");
  for (const protocol of protocols) {
    const item = program.sourcePackageFacades.nativeTypeItemFor(protocol.ownerFileName, protocol.targetName);
    assert.equal(item.nativeProtocol, true, "the actual protocol role was chosen before publication");
    assert.equal(item.targetName, protocol.targetName, "the canonical native allocator's selected name is authoritative");
    assert.equal(item.fileName, protocol.ownerFileName, "qualification uses the actual selected owner, not an ambient source file");
    const native = selectRustNativeTypeCarrier(protocol.trait, input, "general");
    assert.equal(native.kind, "resolved", "protocol formatting does not query semantic name/protocol owners again");
    assert.equal(native.carrier.path.endsWith(`::${protocol.targetName}`), true, "the selected protocol keeps its required qualified path");
  }
  const conflict = selectRustNativeTypeItemNames({ ast: source.ast, nativeNodes: [entry], names: program.names,
    protocols: [{ ownerFileName: fileName, targetName: "Entry" }] });
  assert.equal(conflict.kind, "rejected", "conflicting authored and generated roles do not get a priority fallback");
  assert.equal(conflict.value === undefined, true, "conflicting native item data cannot be published");
  assert.equal(conflict.diagnostics[0].code, "RUST_NATIVE_TYPE_ITEM_NAME_CONFLICT", "the single pre-seal names owner rejects the conflict");
});
