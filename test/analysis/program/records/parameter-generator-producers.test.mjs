import assert from "node:assert/strict";
import { assertRustInheritedRecordConflict, assertRustInheritedRecordCorrespondence } from "../../../helpers/records.mjs";
import test from "node:test";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";
import { createRustSourceParameterAbiProducer } from "../../../../dist/analysis/program/records/calls/source-parameter-abi.js";
import { getRustGeneratorProtocol, rustGeneratorTargetType, rustAsyncGeneratorTargetType, rustStringTargetType } from "../../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";
import { selectRustSourceValueConversion } from "../../../../dist/policy/conversions/selection.js";
import { rustValueConversionContract } from "../../../../dist/policy/conversions/contracts.js";
import { rustFoundationForCarrier } from "../../../../dist/analysis/foundation/requirements.js";
import { rustFoundationForValueConversion } from "../../../../dist/analysis/foundation/conversion-requirements.js";
import { maximumRustFoundation } from "../../../../dist/target-model/foundation/model.js";
import { emptyRustTypeDefinitions } from "../../../../dist/target-model/types/source-union-definitions.js";
import { rustSourceUnionTargetType } from "../../../../dist/target-model/types/carriers/source-types.js";

const integer = { kind: "source-primitive", name: "int32" };
const wide = { kind: "source-primitive", name: "int64" };
const lifetime = { kind: "parameter", identity: "source::input", name: "input" };
const parameter = {};
const reference = {};
const protocol = { kind: "sync", yieldType: integer, returnType: wide, nextType: integer };
const retention = { capturedParameters: [parameter], storage: { kind: "static" } };
const abi = { form: "required", valueCarrier: integer, parameterCarrier: integer, mode: "value" };
const construct = {
  generator: (builder, subject) => builder.generators.suspend(subject, protocol, retention),
  sourceParameterAbi: (builder, subject) => builder.sourceParameterAbis.parameter(subject, abi),
  sourceBinding: (builder, subject) => builder.sourceBindings.lexical(subject, parameter, "input"),
};

test("three families expose immutable readers and exactly one domain producer instead of generic setters", () => {
  const builder = createRustProgramRecordBuilder();
  const sealed = builder.seal([]);
  for (const family of Object.keys(construct)) {
    assert.equal(Object.isFrozen(builder[family]), true, family);
    assert.deepEqual(Object.keys(builder[family]), ["get"], family);
    assert.equal(builder[family].get === sealed[family].get, true, family);
    assert.equal(builder[family].get({}) === undefined, true, family);
  }
  for (const producer of [builder.generators, builder.sourceParameterAbis, builder.sourceBindings]) {
    assert.equal(Object.isFrozen(producer), true);
    assert.equal(Object.hasOwn(producer, "set"), false);
  }
});

for (const [family, admit] of Object.entries(construct)) {
  test(`${family} preserves equal-repeat identity, exact source identities, inherited values and child isolation`, () => {
    const parent = createRustProgramRecordBuilder();
    const subject = {};
    admit(parent, subject);
    const fact = parent[family].get(subject);
    assert.equal(fact !== undefined && Object.isFrozen(fact), true);
    assertRustInheritedRecordCorrespondence(family, subject, fact, candidate => admit(candidate, subject));
    assert.throws(() => admit(parent, subject), /Duplicate Rust semantic plan/u);
    assert.equal(parent[family].get(subject) === fact, true);
    assert.equal(parent[family].get({ ...subject }) === undefined, true);
    const sealed = parent.seal([]);
    const child = createRustProgramRecordBuilder(undefined, sealed);
    assert.equal(child[family].get(subject) === fact, true);
    admit(child, subject);
    assert.equal(child[family].get(subject) === fact, true);
    const fresh = {};
    admit(child, fresh);
    assert.equal(child[family].get(fresh) !== undefined, true);
    assert.equal(sealed[family].get(fresh) === undefined, true);
    assert.equal(child.seal([])[family].get(subject) === fact, true);
  });

  test(`${family} rejects all writes after sealing, including equal and inherited admissions`, () => {
    const parent = createRustProgramRecordBuilder();
    const inherited = {};
    admit(parent, inherited);
    const child = createRustProgramRecordBuilder(undefined, parent.seal([]));
    const local = {};
    admit(child, local);
    child.seal([]);
    for (const subject of [inherited, local, {}]) assert.throws(() => admit(child, subject), /after analysis is sealed/u);
    assert.throws(() => child.seal([]), /can be sealed only once/u);
  });
}

for (const kind of ["sync", "async"]) for (const storage of [
  { kind: "static" }, { kind: "receiver" }, { kind: "lifetime", lifetime },
]) {
  test(`generator construction preserves the selected ${kind}/${storage.kind} protocol and storage identities`, () => {
    const builder = createRustProgramRecordBuilder();
    const subject = {};
    const selected = { ...protocol, kind };
    const ownedReceiver = { carrier: rustStringTargetType(), occurrences: [reference] };
    const selectedRetention = { ...retention, storage, ownedReceiver };
    builder.generators.suspend(subject, selected, selectedRetention);
    const fact = builder.generator.get(subject);
    assert.equal(fact !== undefined, true);
    for (const field of ["yieldType", "returnType", "nextType"]) assert.equal(fact[field] === selected[field], true, field);
    assert.equal(fact.kind, kind);
    assert.equal(fact.capturedParameters === selectedRetention.capturedParameters, true);
    assert.equal(fact.storage === storage && fact.ownedReceiver === ownedReceiver, true);
    const logical = kind === "sync" ? rustGeneratorTargetType(selected) : rustAsyncGeneratorTargetType(selected);
    assert.equal(rustTargetTypeRefEquals(fact.resultCarrier, logical), true,
      "the source signature retains only Y/R/N while the exact retention lifetime remains in its required storage fact");
    assert.equal("reentry" in fact, false, "the generator record does not encode a runtime reentry policy");
    const result = getRustGeneratorProtocol(fact.resultCarrier);
    assert.equal(result?.kind, kind);
    assert.equal(rustTargetTypeRefEquals(result?.nextType, integer), true);
    assert.equal(builder.minimumFoundation(), "core", "transport preserves the existing generator foundation rule");
  });
}

test("generator equality rejects every changed protocol, captured identity, lifetime and owned receiver without replacement", () => {
  const ownedReceiver = { carrier: integer, occurrences: [reference, parameter] };
  const originalRetention = { ...retention, storage: { kind: "lifetime", lifetime }, ownedReceiver };
  const cases = [
    [{ ...protocol, kind: "async" }, originalRetention],
    [{ ...protocol, yieldType: wide }, originalRetention],
    [{ ...protocol, returnType: integer }, originalRetention],
    [{ ...protocol, nextType: wide }, originalRetention],
    [protocol, { ...originalRetention, capturedParameters: [] }],
    [protocol, { ...originalRetention, capturedParameters: [{}] }],
    [protocol, { ...originalRetention, storage: { kind: "receiver" } }],
    [protocol, { ...originalRetention, storage: { kind: "lifetime", lifetime: { ...lifetime, identity: "other" } } }],
    [protocol, { ...originalRetention, ownedReceiver: undefined }],
    [protocol, { ...originalRetention, ownedReceiver: { ...ownedReceiver, carrier: wide } }],
    [protocol, { ...originalRetention, ownedReceiver: { ...ownedReceiver, occurrences: [parameter, reference] } }],
    [protocol, { ...originalRetention, ownedReceiver: { ...ownedReceiver, occurrences: [{}] } }],
    [protocol, { ...originalRetention, capturedParameters: [parameter, parameter] }],
  ];
  for (const [index, [selectedProtocol, selectedRetention]] of cases.entries()) {
    const parent = createRustProgramRecordBuilder();
    const subject = {};
    parent.generators.suspend(subject, protocol, originalRetention);
    const fact = parent.generator.get(subject);
    assertRustInheritedRecordConflict("generator", subject, fact,
      candidate => candidate.generators.suspend(subject, selectedProtocol, selectedRetention), /Conflicting Rust semantic plan 'tsonic\.rust\.generator'/u, String(index));
    assert.equal(parent.generator.get(subject) === fact, true, String(index));
    const child = createRustProgramRecordBuilder(undefined, parent.seal([]));
    assert.throws(() => child.generators.suspend(subject, selectedProtocol, selectedRetention), /Conflicting Rust semantic plan 'tsonic\.rust\.generator'/u, String(index));
    assert.equal(child.generator.get(subject) === fact, true, String(index));
  }
});

test("a generator preserves every supported captured-parameter count without a reentry policy", () => {
  for (const capturedParameters of [[], [parameter], [parameter, reference]]) {
    const builder = createRustProgramRecordBuilder();
    const subject = {};
    builder.generators.suspend(subject, protocol, { ...retention, capturedParameters });
    assert.equal(builder.generator.get(subject)?.capturedParameters === capturedParameters, true,
      "the exact source capture inventory is preserved");
    assert.equal("reentry" in builder.generator.get(subject), false, "native reentry is not a source fact");
  }
});

for (const form of ["required", "optional", "default", "rest"]) {
  test(`parameter ABI constructs exactly the selected ${form} form, with and without optional native premises`, () => {
    const builder = createRustProgramRecordBuilder();
    const required = {};
    builder.sourceParameterAbis.parameter(required, { ...abi, form });
    assert.deepEqual(builder.sourceParameterAbi.get(required), { ...abi, form });
    const subject = {};
    const conversion = selectRustSourceValueConversion(integer, wide);
    assert.equal(conversion !== undefined, true, "real native integer entry conversion");
    const selected = { form, valueCarrier: wide, parameterCarrier: integer, mode: "ref", inputLifetime: lifetime,
      entryConversion: Object.freeze({ conversion, contract: rustValueConversionContract(conversion) }) };
    builder.sourceParameterAbis.parameter(subject, selected);
    const fact = builder.sourceParameterAbi.get(subject);
    assert.equal(fact !== undefined && Object.isFrozen(fact), true);
    for (const field of Object.keys(selected)) assert.equal(fact[field] === selected[field], true, field);
    const expected = maximumRustFoundation(maximumRustFoundation(rustFoundationForCarrier(wide), rustFoundationForCarrier(integer)),
      rustFoundationForValueConversion(conversion));
    assert.equal(builder.minimumFoundation(), expected);
  });
}

test("parameter ABI identity propagation never admits an arbitrary DTO or invents a missing selected source", () => {
  const parent = createRustProgramRecordBuilder();
  const source = {};
  const use = {};
  const other = {};
  parent.sourceParameterAbis.use(other, source);
  assert.equal(parent.sourceParameterAbi.get(other) === undefined, true);
  parent.sourceParameterAbis.parameter(source, abi);
  parent.sourceParameterAbis.use(use, source);
  assert.equal(parent.sourceParameterAbi.get(use) === parent.sourceParameterAbi.get(source), true);
  const child = createRustProgramRecordBuilder(undefined, parent.seal([]));
  child.sourceParameterAbis.use(other, use);
  assert.equal(child.sourceParameterAbi.get(other) === parent.sourceParameterAbi.get(source), true);
  assert.equal(parent.sourceParameterAbi.get(other) === undefined, true);
  child.seal([]);
  for (const pair of [[other, source], [{}, {}]]) assert.throws(() => child.sourceParameterAbis.use(...pair), /after analysis is sealed/u);
});

test("parameter ABI retains carrier foundation requirements and all existing conflict dimensions", () => {
  const parent = createRustProgramRecordBuilder();
  const subject = {};
  const selected = { ...abi, inputLifetime: lifetime };
  parent.sourceParameterAbis.parameter(subject, selected);
  const fact = parent.sourceParameterAbi.get(subject);
  const conversion = selectRustSourceValueConversion(integer, wide);
  assert.equal(conversion !== undefined, true);
  const changes = [{ form: "optional" }, { valueCarrier: wide }, { parameterCarrier: wide }, { mode: "mut-ref" },
    { inputLifetime: { ...lifetime, identity: "other" } }, { inputLifetime: undefined },
    { entryConversion: Object.freeze({ conversion, contract: rustValueConversionContract(conversion) }) }];
  const child = createRustProgramRecordBuilder(undefined, parent.seal([]));
  for (const change of changes) {
    assert.throws(() => child.sourceParameterAbis.parameter(subject, { ...selected, ...change }), /Conflicting Rust semantic plan 'tsonic\.rust\.sourceParameterAbi'/u);
    assert.equal(child.sourceParameterAbi.get(subject) === fact, true);
  }
  const allocating = {};
  child.sourceParameterAbis.parameter(allocating, { ...abi, valueCarrier: rustStringTargetType() });
  assert.equal(child.minimumFoundation(), rustFoundationForCarrier(rustStringTargetType()));
  const conflictingUse = {};
  child.sourceParameterAbis.parameter(conflictingUse, { ...abi, valueCarrier: wide });
  assert.throws(() => child.sourceParameterAbis.use(conflictingUse, subject), /Conflicting Rust semantic plan 'tsonic\.rust\.sourceParameterAbi'/u);
  assert.equal(child.sourceParameterAbi.get(conflictingUse)?.valueCarrier === wide, true);
});

test("derived parameter use queries validate the complete ABI without admitting it twice", () => {
  let admissions = 0;
  let sealed = false;
  const producer = createRustSourceParameterAbiProducer(() => {
    if (sealed) throw new Error("after analysis is sealed");
  }, () => { admissions += 1; }, emptyRustTypeDefinitions);
  const source = {};
  const use = {};
  const conversion = selectRustSourceValueConversion(integer, wide);
  const entryConversion = Object.freeze({ conversion, contract: rustValueConversionContract(conversion) });
  const selected = { ...abi, inputLifetime: lifetime, entryConversion };
  producer.parameter(source, selected);
  producer.use(use, source);
  const canonical = producer.records.get(use);
  assert.equal(canonical === producer.records.get(source), true, "first use retains the entire canonical ABI");
  assert.equal(admissions, 2, "one source admission and one derived-use admission");
  producer.use(use, source);
  producer.use(source, source);
  assert.equal(admissions, 2, "matching use requests are not further admissions");
  const changes = [{ form: "optional" }, { valueCarrier: wide }, { parameterCarrier: wide }, { mode: "mut-ref" },
    { inputLifetime: { ...lifetime, identity: "other" } }, { inputLifetime: undefined }, { entryConversion: undefined }];
  for (const change of changes) {
    const other = {};
    producer.parameter(other, { ...selected, ...change });
    const before = admissions;
    assert.throws(() => producer.use(use, other), /Conflicting Rust semantic plan 'tsonic\.rust\.sourceParameterAbi'/u);
    assert.equal(producer.records.get(use) === canonical, true, Object.keys(change).join());
    assert.equal(admissions, before, "a rejected request performs no admission");
  }
  let inheritedAdmissions = 0;
  const child = createRustSourceParameterAbiProducer(() => {}, () => { inheritedAdmissions += 1; },
    emptyRustTypeDefinitions, producer.records);
  child.use(use, source);
  assert.equal(child.records.get(use) === canonical, true, "inherited canonical use is not shadowed");
  assert.equal(inheritedAdmissions, 0, "inherited correspondence is a query, not an admission");
  sealed = true;
  assert.throws(() => producer.use(use, source), /after analysis is sealed/u);
  assert.throws(() => producer.use({}, {}), /after analysis is sealed/u);
});

test("parameter ABI foundation uses entry conversions and the exact provided source union definitions", () => {
  const floating = { kind: "source-primitive", name: "float64" };
  const checked = { kind: "semantic-conversion", id: "checked-f64-to-i32-trunc" };
  const first = createRustProgramRecordBuilder();
  first.sourceParameterAbis.parameter({}, { ...abi, parameterCarrier: floating,
    entryConversion: Object.freeze({ conversion: checked, contract: rustValueConversionContract(checked) }) });
  assert.equal(first.minimumFoundation(), "alloc", "the checked conversion contributes its error carrier independently");
  const union = rustSourceUnionTargetType("fixture.Parameter", "Parameter");
  const variants = [{ name: "Integer", carrier: integer }, { name: "Text", carrier: rustStringTargetType() }];
  let definitionReads = 0;
  const definitions = { ...emptyRustTypeDefinitions, sourceUnionVariants: carrier => {
    definitionReads++;
    return rustTargetTypeRefEquals(carrier, union) ? variants : undefined;
  } };
  const conversion = { kind: "source-union-variant", source: integer, target: union,
    variantName: "Integer", payloadCarrier: integer, payloadConversion: null };
  const builder = createRustProgramRecordBuilder(definitions);
  const parameter = {};
  const entryConversion = Object.freeze({ conversion, contract: rustValueConversionContract(conversion, definitions) });
  builder.sourceParameterAbis.parameter(parameter, { ...abi, valueCarrier: union, entryConversion });
  assert.equal(definitionReads > 0, true, "the constructor's exact definition context reaches the existing native contract");
  assert.equal(builder.minimumFoundation(), "core", "an unused allocating union variant adds no cost");
  assert.equal(builder.sourceParameterAbi.get(parameter)?.entryConversion === entryConversion, true);
  const beforeReads = definitionReads;
  for (let index = 0; index < 32; index++) assert.equal(builder.sourceParameterAbi.get(parameter)?.entryConversion === entryConversion, true);
  builder.seal([]);
  assert.equal(definitionReads, beforeReads, "reads and sealing do not compute the conversion again");
  const missing = createRustProgramRecordBuilder();
  assert.throws(() => missing.sourceParameterAbis.parameter({}, { ...abi, valueCarrier: union, entryConversion }),
    /no valid lowering contract/u);
});

test("source binding constructs lexical and module variants from exact selected names and declarations", () => {
  const builder = createRustProgramRecordBuilder();
  const local = {};
  const module = {};
  const lexical = builder.sourceBindings.lexical(local, parameter, "SameAuthoredName");
  const exported = builder.sourceBindings.module(module, parameter, "SameAuthoredName", "/src/library.ts");
  assert.deepEqual(lexical, { scope: "lexical", sourceName: "SameAuthoredName", sourceDeclaration: parameter });
  assert.deepEqual(exported, { scope: "module", sourceName: "SameAuthoredName", fileName: "/src/library.ts", sourceDeclaration: parameter });
  assert.equal(builder.sourceBinding.get(local) === lexical && builder.sourceBinding.get(module) === exported, true);
  assert.equal(Object.hasOwn(lexical, "fileName"), false);
  assert.equal(builder.minimumFoundation(), "core");
});

test("source binding conflicts preserve source identity, scope, name and module filename without changing inherited data", () => {
  for (const scope of ["lexical", "module"]) {
    const parent = createRustProgramRecordBuilder();
    const subject = {};
    const publish = (builder, declaration = parameter, name = "input", file = "/src/library.ts") => scope === "lexical"
      ? builder.sourceBindings.lexical(subject, declaration, name) : builder.sourceBindings.module(subject, declaration, name, file);
    publish(parent);
    const fact = parent.sourceBinding.get(subject);
    const child = createRustProgramRecordBuilder(undefined, parent.seal([]));
    for (const args of [[{}, "input"], [parameter, "other"], ...(scope === "module" ? [[parameter, "input", "/src/other.ts"]] : [])]) {
      assert.throws(() => publish(child, ...args), /Conflicting Rust semantic plan 'tsonic\.rust\.sourceBinding'/u);
      assert.equal(child.sourceBinding.get(subject) === fact, true);
    }
    const otherScope = scope === "lexical" ? () => child.sourceBindings.module(subject, parameter, "input", "/src/library.ts")
      : () => child.sourceBindings.lexical(subject, parameter, "input");
    assert.throws(otherScope, /Conflicting Rust semantic plan 'tsonic\.rust\.sourceBinding'/u);
    assert.equal(child.sourceBinding.get(subject) === fact, true);
  }
});
