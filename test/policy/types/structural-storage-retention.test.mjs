import assert from "node:assert/strict";
import test from "node:test";
import { retainRustStructuralInstantiation } from "../../../dist/analysis/source-evidence/types/resolution/structural-instantiations.js";
import { retainRustSourceUnionInstantiation } from "../../../dist/analysis/source-evidence/types/resolution/source-unions.js";
import { rustSourceUnionTargetType, rustSourcePrimitiveTargetType, rustStructuralObjectTargetType, rustStructuralObjectCarrierValue,
  rustCallableTargetType, rustVecTargetType, rustOptionTargetType } from "../../../dist/target-model/types/index.js";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { analyzeRust } from "../../helpers/rust-session.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`structural alias retention binds selected native instances instead of their open template in ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
      import type { int32, int64 } from "@tsonic/core/types.js";
      type View<Value> = { readonly value: Value };
      type Pair<First, Second> = { readonly left: First; readonly right: Second };
      export function narrow(value: View<int32>): View<int32> { return value; }
      export function wide(value: View<int64>): View<int64> { return value; }
      export function swap(value: Pair<int32, int64>): Pair<int64, int32> {
        return { left: value.right, right: value.left };
      }
    ` } });
    const { ast } = program.source;
    const file = program.source.sourceFiles.find(file => ast.getFileName(file) === "/src/index.ts");
    assert.equal(file !== undefined, true, "the original checked alias declarations are retained");
    for (const [name, expected] of [
      ["narrow", [["value", "int32"]]],
      ["wide", [["value", "int64"]]],
      ["swap", [["left", "int64"], ["right", "int32"]]],
    ]) {
      const owner = ast.statements(file).find(node => ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === name);
      assert.equal(owner !== undefined, true, `${name}: original declaration identity`);
      const returned = program.records.sourceCallableReturn.get(owner);
      const shape = rustStructuralObjectCarrierValue(returned?.returnCarrier);
      assert.equal(shape !== undefined, true, `${name}: complete selected structural return`);
      for (const [fieldName, nativeKind] of expected) {
        const field = shape.fields.find(field => field.sourceName === fieldName);
        assert.equal(field !== undefined && field.type.kind === "source-primitive" && field.type.name === nativeKind,
          true, `${name}.${fieldName}: exact concrete native binding, not its open alias parameter`);
      }
    }
  });
}

test("structural retention proves type correspondence without querying physical components", () => {
  const sourceType = {};
  const templateType = {};
  const sourceDeclaration = {};
  const templateDeclaration = {};
  const sourceSymbol = {};
  const destinationSymbol = {};
  const scalar = rustSourcePrimitiveTargetType("int64");
  const field = { sourceName: "value", type: scalar, readonly: true, presence: "required" };
  const carrier = rustStructuralObjectTargetType("/src/index.ts", [field]);
  const template = { sourceType: templateType, carrier, fields: [{ ...field, storageIndex: 0,
    declarations: [templateDeclaration], symbols: [destinationSymbol], resultCarrier: scalar }] };
  const subject = { node: {}, kind: "input", projection: [{ kind: "tuple-element", index: 2 }] };
  const bindings = {};
  const registrations = [];
  const context = {
    callableRepresentation: "storage", sourceStorageResolution: { kind: "resolved", subject, bindings },
    sourceStorage: { subject() { assert.fail("type correspondence cannot project a runtime value or callable signature subject"); } },
    currentSemantics: { types: { aliasApplication: () => undefined, structuralMembers: () => ({ kind: "available",
      source: { calls: [], constructs: [], indexes: [] }, members: [{ kind: "present",
        source: { read: "property", declarations: [sourceDeclaration], property: {
          symbol: sourceSymbol, rootSymbols: [], type: scalar, optional: false, readonly: true } },
        destination: { read: "property", declarations: [templateDeclaration], property: {
          symbol: destinationSymbol, type: scalar, optional: false, readonly: true } },
      }] }) } },
    ast: { typeNode: () => undefined, kindName: () => "KindPropertySignature",
      is: { IsMethodDeclaration: () => false, IsGetAccessorDeclaration: () => false, IsSetAccessorDeclaration: () => false } },
  };
  const options = { sourceTypes: { structuralObjectForType: () => undefined,
    structuralObjectForCarrier: () => template, registerStructuralObject(value) {
      registrations.push(value);
      return true;
    } } };
  assert.equal(retainRustStructuralInstantiation(sourceType, carrier, carrier, context, options), true,
    "the exact source member retains its canonical structural application");
  assert.equal(registrations.length === 1 && registrations[0].fields[0].declarations[0] === sourceDeclaration, true,
    "publication retains the exact original source declaration correspondence");
  assert.equal(registrations[0].carrier === carrier && registrations[0].fields[0].resultCarrier === scalar, true,
    "type evidence never replaces the caller's exact selected destination carrier");
  assert.equal(context.sourceStorageResolution.bindings === bindings, true, "source bindings are never reconstructed or replaced");
  assert.equal(retainRustStructuralInstantiation(sourceType, carrier, carrier,
    { ...context, sourceStorageResolution: { kind: "unresolved", reason: "missing physical scope" } }, options), true,
  "an unrelated failed runtime projection is not a type-correspondence premise or a physical recovery path");
  assert.equal(retainRustStructuralInstantiation(sourceType, carrier, carrier,
    { ...context, sourceStorageResolution: { kind: "resolved", subject: undefined, bindings } }, options), true,
  "the known type-correspondence question does not require a runtime subject");
  assert.equal(retainRustStructuralInstantiation(sourceType, carrier, carrier,
    { ...context, callableRepresentation: "signature", sourceStorageResolution: undefined }, options), true,
  "an explicitly logical signature preserves its original admission role");
  const logicalSemantics = { types: { ...context.currentSemantics.types, structuralMembers() {
    const selected = context.currentSemantics.types.structuralMembers();
    return { ...selected, members: selected.members.map(member => ({ ...member,
      source: { ...member.source, declarations: [] } })) };
  } } };
  assert.equal(retainRustStructuralInstantiation(sourceType, carrier, carrier,
    { ...context, currentSemantics: logicalSemantics, callableRepresentation: "signature", sourceStorageResolution: undefined }, options), true,
  "an explicit transformed signature needs checked type correspondence, not a fabricated physical member declaration");
  assert.equal(retainRustStructuralInstantiation(sourceType, carrier, carrier,
    { ...context, currentSemantics: logicalSemantics }, options), true,
  "the same exact transformed type correspondence is not a physical storage request");
  const setterSemantics = destinationRead => ({ types: { ...context.currentSemantics.types, structuralMembers() {
    const selected = context.currentSemantics.types.structuralMembers();
    return { ...selected, members: selected.members.map(member => ({ ...member,
      source: { ...member.source, read: "unavailable" },
      destination: { ...member.destination, read: destinationRead } })) };
  } } });
  const setterContext = { ...context, currentSemantics: setterSemantics("unavailable"),
    ast: { ...context.ast, is: { ...context.ast.is, IsSetAccessorDeclaration: () => true } } };
  assert.equal(retainRustStructuralInstantiation(sourceType, carrier, carrier,
    { ...setterContext, callableRepresentation: "signature", sourceStorageResolution: undefined }, options), true,
  "an exact setter-only correspondence retains logical metadata without inventing a readable physical field");
  assert.equal(retainRustStructuralInstantiation(sourceType, carrier, carrier, setterContext, options), true,
    "descriptive setter metadata never becomes a request for readable physical storage");
  assert.equal(retainRustStructuralInstantiation(sourceType, carrier, carrier,
    { ...setterContext, currentSemantics: setterSemantics("property"), callableRepresentation: "signature" }, options), false,
  "signature purpose cannot disguise a setter-only source as a readable property destination");
  const arraySource = {};
  const arrayContext = { ...context, currentSemantics: { types: { ...context.currentSemantics.types,
    isArrayLike: type => type === arraySource, isTypeReference: type => type === arraySource,
    typeArguments: () => [sourceType] } } };
  assert.equal(retainRustStructuralInstantiation(arraySource, rustVecTargetType(carrier), rustVecTargetType(carrier),
    arrayContext, options), true, "array element type correspondence does not project the ambient runtime subject");
  const tupleSource = {};
  const tuple = { kind: "tuple", elements: [carrier] };
  const tupleContext = { ...context, currentSemantics: { types: { ...context.currentSemantics.types,
    isTuple: type => type === tupleSource, tupleElementInfos: () => [{ type: sourceType }] } } };
  assert.equal(retainRustStructuralInstantiation(tupleSource, tuple, tuple, tupleContext, options), true,
    "tuple element type correspondence preserves its exact checked index and native carrier");
  assert.equal(retainRustStructuralInstantiation(tupleSource, tuple, tuple,
    { ...tupleContext, sourceStorage: { subject: () => assert.fail("a type tuple does not request physical components") } }, options), true,
  "a callable's runtime subject cannot be mistaken for the stored result tuple");
  const selectedCallable = rustCallableTargetType([scalar], scalar, { kind: "static" });
  const callableField = { ...field, type: selectedCallable };
  const callableCarrier = rustStructuralObjectTargetType("/src/index.ts", [callableField]);
  const callableOptions = { sourceTypes: { ...options.sourceTypes,
    structuralObjectForCarrier: () => ({ ...template, carrier: callableCarrier,
      fields: [{ ...template.fields[0], type: selectedCallable, resultCarrier: selectedCallable }] }) } };
  const callableContext = { ...context, currentSemantics: { types: { ...context.currentSemantics.types,
    structuralMembers() {
      const selected = context.currentSemantics.types.structuralMembers();
      return { ...selected, members: selected.members.map(member => ({ ...member,
        source: { ...member.source, property: { ...member.source.property, type: sourceType } },
        destination: { ...member.destination, property: { ...member.destination.property, type: sourceType } } })) };
    }, signatureInfos: () => [{ parameters: [{ type: scalar }], returnType: scalar }],
  } } };
  assert.equal(retainRustStructuralInstantiation(sourceType, callableCarrier, callableCarrier, callableContext, callableOptions), true,
    "callable type components retain their exact already selected lifetime and error contract");
  assert.equal(registrations.at(-1).carrier === callableCarrier &&
    registrations.at(-1).fields[0].resultCarrier === selectedCallable, true,
  "signature correspondence publishes the exact destination callable without re-closing or replacing its native metadata");
});

function unionDefinition(payloads, origin = "generated") {
  const definitions = createRustTypeDefinitionRegistry();
  const carrier = rustSourceUnionTargetType("/src/index.ts", `Union${payloads.length}`,
    [], origin, origin === "generated" ? { kind: "physical", types: payloads } : { kind: "source" });
  assert.equal(definitions.registerSourceUnion({ carrier, variants: payloads.map((carrier, index) => ({
    name: `Variant${index}`, carrier,
  })) }, false), true);
  return { carrier, sourceTypes: definitions.seal() };
}

test("native-only generated payloads do not invent structural instantiation obligations", () => {
  const number = rustSourcePrimitiveTargetType("float64");
  const truth = rustSourcePrimitiveTargetType("bool");
  const { carrier, sourceTypes } = unionDefinition([number, truth]);
  for (const stored of [carrier, rustVecTargetType(carrier), rustOptionTargetType(carrier),
    rustCallableTargetType([carrier], carrier)]) {
    assert.equal(retainRustStructuralInstantiation({}, stored, stored, {}, { sourceTypes }), true);
  }
});

test("authored union payload storage retains the same source proof obligations", () => {
  const number = rustSourcePrimitiveTargetType("float64");
  const shape = rustStructuralObjectTargetType("/src/index.ts", [
    { sourceName: "value", type: number, readonly: true, presence: "required" },
  ]);
  const plain = unionDefinition([number, rustSourcePrimitiveTargetType("bool")], "authored");
  assert.equal(retainRustStructuralInstantiation({}, plain.carrier, plain.carrier, {}, {
    sourceTypes: plain.sourceTypes,
  }), true);
  const structured = unionDefinition([shape, number], "authored");
  assert.equal(retainRustStructuralInstantiation({}, structured.carrier, structured.carrier, {
    currentSemantics: { types: { aliasApplication: () => undefined } },
  }, { sourceTypes: { ...structured.sourceTypes, sourceUnionForCarrier: () => undefined } }), false);
});

test("recursive authored storage discovery uses exact applications and bounded expansion", () => {
  const number = rustSourcePrimitiveTargetType("float64");
  const tree = rustSourceUnionTargetType("/src/tree.ts", "Tree");
  const application = argument => rustSourceUnionTargetType("/src/tree.ts", "GenericTree", [
    { kind: "type", type: argument },
  ]);
  let visits = 0;
  const sourceTypes = { sourceUnionVariants: () => {
    visits++;
    return [{ name: "Leaf", carrier: number }, { name: "Children", carrier: rustVecTargetType(
      rustSourceUnionTargetType("/src/tree.ts", "Tree")) }];
  } };
  assert.equal(retainRustStructuralInstantiation({}, tree, tree, {}, { sourceTypes }), true);
  assert.equal(visits, 1);
  visits = 0;
  assert.equal(retainRustStructuralInstantiation({}, application(number), application(number), {}, {
    sourceTypes: { sourceUnionVariants: () => {
      visits++;
      return [{ name: "Changing", carrier: application({ kind: "type-parameter", identity: `type:${visits}`, name: "Value" }) }];
    } },
  }), false);
  assert.equal(visits, 4096);
});

test("generated structural payloads retain exact selected-source proof obligations", () => {
  const shape = rustStructuralObjectTargetType("/src/index.ts", [
    { sourceName: "value", type: rustSourcePrimitiveTargetType("int64"), readonly: false, presence: "required" },
  ]);
  const { carrier, sourceTypes } = unionDefinition([shape, rustSourcePrimitiveTargetType("bool")]);
  const context = { currentSemantics: { types: { aliasApplication: () => undefined } } };
  assert.equal(retainRustStructuralInstantiation({}, carrier, carrier, context, {
    sourceTypes: { ...sourceTypes, sourceUnionForCarrier: () => undefined },
  }), false);
});

test("storage retention rejects missing or excessive native payload evidence", () => {
  const number = rustSourcePrimitiveTargetType("float64");
  const { carrier } = unionDefinition([number, rustSourcePrimitiveTargetType("bool")]);
  for (const variants of [undefined, [], Array(4097).fill({ carrier: number })]) {
    assert.equal(retainRustStructuralInstantiation({}, carrier, carrier, {}, {
      sourceTypes: { sourceUnionVariants: () => variants },
    }), false);
  }
  let nested = number;
  for (let index = 0; index < 4096; index++) nested = rustVecTargetType(nested);
  assert.equal(retainRustStructuralInstantiation({}, nested, nested, {}, { sourceTypes: {} }), false);
});

function retentionFixture() {
  const declaration = {};
  const sourceType = {};
  const members = [{}, {}];
  const source = unionDefinition([rustSourcePrimitiveTargetType("int64"), rustSourcePrimitiveTargetType("bool")], "authored");
  const template = { declaration, sourceType, carrier: source.carrier,
    variants: source.sourceTypes.sourceUnionVariants(source.carrier).map((variant, index) => ({ ...variant, sourceTypes: [members[index]] })) };
  const registrations = [];
  const sourceTypes = { ...source.sourceTypes, sourceUnionForCarrier: () => undefined, structuralObjectForType: () => undefined,
    registerSourceUnion: union => { registrations.push(union); return true; } };
  const types = {
    isUnion: type => type === sourceType, unionOrIntersectionTypes: () => members,
    isNullish: () => false, isVoidLike: () => false, propertyInfos: () => [],
    aliasApplication: () => undefined, isTypeReference: () => false, couldContainTypeVariables: () => false,
    isIdentical: (left, right) => left === right, stringLiteralValue: () => undefined, booleanLiteralValue: () => undefined,
  };
  const semantics = { types, declarations: { typeSymbol: () => undefined, symbolDeclarations: () => [] } };
  const context = { currentSemantics: semantics, currentSourceFile: declaration,
    source: { navigation: { isProjectDeclaration: node => node === declaration }, sourceFacts: { getFact: () => undefined } },
    sourceLifetimes: { contractFor: () => ({ parameters: [] }) },
    sourceUnionInstantiationPath: [{ sourceType, carrier: source.carrier }] };
  return { declaration, sourceType, members, template, sourceTypes, semantics, context, registrations,
    retain() { return retainRustSourceUnionInstantiation(sourceType, template, source.carrier, context, { sourceTypes }, declaration); } };
}

test("recursive source retention closes only exact fully validated nominal applications", () => {
  const fixture = retentionFixture();
  assert.equal(fixture.retain() !== undefined, true);
  assert.equal(fixture.registrations.length, 0, "exact active nominal edge is not recursively registered");
  fixture.context.sourceUnionInstantiationPath = [];
  assert.equal(fixture.retain() !== undefined, true);
  assert.equal(fixture.registrations.length, 1, "nonrecursive application completes its own registration");
});

test("recursive source retention cannot bypass member, owner, carrier or selected-property proof", () => {
  for (const [label, mutate] of [
    ["foreign source declaration", fixture => { fixture.template.declaration = {}; }],
    ["missing source member", fixture => { fixture.members.pop(); }],
    ["repeated source member", fixture => { fixture.members[1] = fixture.members[0]; }],
    ["unmatched source member", fixture => { fixture.members[1] = {}; }],
    ["foreign native owner", fixture => { fixture.template.carrier = rustSourceUnionTargetType("/other.ts", "Union2"); }],
    ["wrong native arm", fixture => { fixture.sourceTypes.sourceUnionVariants = () => [
      { name: "Wrong", carrier: rustSourcePrimitiveTargetType("int64") }, fixture.template.variants[1],
    ]; }],
    ["missing property identity", fixture => { fixture.semantics.types.propertyInfos = () => [{ symbol: {}, rootSymbols: [] }]; }],
    ["unowned selected property", fixture => {
      fixture.semantics.types.propertyInfos = () => [{ symbol: {}, rootSymbols: [] }];
      fixture.semantics.declarations.symbolDeclarations = () => [{}];
    }],
    ["bounded active applications", fixture => {
      fixture.context.sourceUnionInstantiationPath = Array.from({ length: 128 }, () => ({ sourceType: {}, carrier: fixture.template.carrier }));
    }],
  ]) {
    const fixture = retentionFixture();
    mutate(fixture);
    assert.equal(fixture.retain() === undefined, true, label);
    assert.equal(fixture.registrations.length, 0, `${label}: no unproved registration`);
  }
  for (const foreign of ["source", "carrier"]) {
    const fixture = retentionFixture();
    fixture.context.sourceUnionInstantiationPath = [{
      sourceType: foreign === "source" ? {} : fixture.sourceType,
      carrier: foreign === "carrier" ? rustSourceUnionTargetType("/other.ts", "Union2") : fixture.template.carrier,
    }];
    fixture.sourceTypes.registerSourceUnion = () => false;
    assert.equal(fixture.retain() === undefined, true, `${foreign}: unrelated active application cannot claim success`);
  }
});
