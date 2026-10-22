import assert from "node:assert/strict";
import test from "node:test";
import { retainRustStructuralInstantiation } from "../../../dist/analysis/source-evidence/types/resolution/structural-instantiations.js";
import { retainRustSourceUnionInstantiation } from "../../../dist/analysis/source-evidence/types/resolution/source-unions.js";
import { rustSourceUnionTargetType, rustSourcePrimitiveTargetType, rustStructuralObjectTargetType,
  rustCallableTargetType, rustVecTargetType, rustOptionTargetType } from "../../../dist/target-model/types/index.js";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";

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
