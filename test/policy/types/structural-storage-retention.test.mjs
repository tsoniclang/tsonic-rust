import assert from "node:assert/strict";
import test from "node:test";
import { retainRustStructuralInstantiation } from "../../../dist/analysis/source-evidence/types/resolution/structural-instantiations.js";
import { retainRustSourceUnionInstantiation } from "../../../dist/analysis/source-evidence/types/resolution/source-unions.js";
import { rustSourceUnionTargetType, rustSourcePrimitiveTargetType, rustStructuralObjectTargetType,
  rustCallableTargetType, rustVecTargetType, rustOptionTargetType } from "../../../dist/target-model/types/index.js";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";

test("structural retention projects the actual source member and preserves physical purpose and bindings", () => {
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
  const observed = [];
  const registrations = [];
  const context = {
    callableRepresentation: "storage", sourceStorageResolution: { kind: "resolved", subject, bindings },
    sourceStorage: { subject(node, kind, projection) {
      observed.push({ node, kind, projection });
      const member = projection.at(-1);
      assert.equal(node === subject.node && kind === subject.kind, true, "the original physical subject and kind are preserved");
      assert.equal(member.kind === "member" ? member.declaration === sourceDeclaration
        : member.kind === "array-element" || member.kind === "tuple-element", true,
      "each component uses its exact native aggregate or actual source member identity");
      return { kind: "resolved", subject: { node, kind, projection } };
    } },
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
  assert.equal(observed.length, 1, "one canonical field projection is selected once");
  assert.equal(observed[0].projection.length === 2 && observed[0].projection[0] === subject.projection[0], true,
    "the existing tuple prefix survives member projection");
  assert.equal(registrations.length === 1 && registrations[0].fields[0].declarations[0] === sourceDeclaration, true,
    "publication retains the exact original source declaration correspondence");
  assert.equal(context.sourceStorageResolution.bindings === bindings, true, "source bindings are never reconstructed or replaced");
  const before = observed.length;
  assert.equal(retainRustStructuralInstantiation(sourceType, carrier, carrier,
    { ...context, sourceStorageResolution: { kind: "unresolved", reason: "missing physical scope" } }, options), false,
  "an unresolved physical scope cannot acquire signature-only permission");
  assert.equal(retainRustStructuralInstantiation(sourceType, carrier, carrier,
    { ...context, sourceStorageResolution: { kind: "resolved", subject: undefined, bindings } }, options), false,
  "a missing physical subject cannot become a logical signature traversal");
  assert.equal(observed.length, before, "unresolved physical traversals never fabricate a projected subject");
  assert.equal(retainRustStructuralInstantiation(sourceType, carrier, carrier,
    { ...context, callableRepresentation: "signature", sourceStorageResolution: undefined }, options), true,
  "an explicitly logical signature preserves its original admission role");
  assert.equal(observed.length, before, "signature-only retention does not demand physical storage");
  const arraySource = {};
  const arrayContext = { ...context, currentSemantics: { types: { ...context.currentSemantics.types,
    isArrayLike: type => type === arraySource, isTypeReference: type => type === arraySource,
    typeArguments: () => [sourceType] } } };
  assert.equal(retainRustStructuralInstantiation(arraySource, rustVecTargetType(carrier), rustVecTargetType(carrier),
    arrayContext, options), true, "array retention extends the existing physical prefix before resolving a nested member");
  assert.equal(observed.at(-1).projection.length === 3 && observed.at(-1).projection[1].kind === "array-element" &&
    observed.at(-1).projection[2].declaration === sourceDeclaration, true, "array and member components remain ordered and source-owned");
  const tupleSource = {};
  const tuple = { kind: "tuple", elements: [carrier] };
  const tupleContext = { ...context, currentSemantics: { types: { ...context.currentSemantics.types,
    isTuple: type => type === tupleSource, tupleElementInfos: () => [{ type: sourceType }] } } };
  assert.equal(retainRustStructuralInstantiation(tupleSource, tuple, tuple, tupleContext, options), true,
    "tuple retention appends its exact source index before nested field admission");
  assert.equal(observed.at(-1).projection.length === 3 && observed.at(-1).projection[1].kind === "tuple-element" &&
    observed.at(-1).projection[1].index === 0 && observed.at(-1).projection[2].declaration === sourceDeclaration, true,
  "the new tuple index cannot replace the existing original tuple prefix or source member identity");
  assert.equal(retainRustStructuralInstantiation(tupleSource, tuple, tuple,
    { ...tupleContext, sourceStorage: { subject: () => ({ kind: "unresolved", reason: "foreign tuple component" }) } }, options), false,
  "an unproved aggregate component fails closed instead of reusing its parent or signature context");
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
