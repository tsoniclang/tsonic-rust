import assert from "node:assert/strict";
import test from "node:test";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { recordRustParameterAbiSelection } from "../../../dist/analysis/callables/values/parameter-facts.js";
import { selectRustSourceValueConversion } from "../../../dist/policy/conversions/selection.js";
import { rustValueConversionContract } from "../../../dist/policy/conversions/contracts.js";

const integer = { kind: "source-primitive", name: "int32" };
const wide = { kind: "source-primitive", name: "int64" };
const lifetime = { kind: "parameter", identity: "parameter::input", name: "input" };
const abi = { form: "required", valueCarrier: integer, parameterCarrier: integer, mode: "value" };

function fixture() {
  const builder = createRustProgramRecordBuilder();
  let admissions = 0;
  let names = 0;
  const walk = {
    finalizedParameters: new WeakSet(), rejectedExpressions: new WeakSet(), resolving: new Set(),
    context: {
      requiredRecords: [],
      records: { ...builder, sourceParameterAbis: { ...builder.sourceParameterAbis, parameter(...arguments_) {
        admissions++;
        builder.sourceParameterAbis.parameter(...arguments_);
      } } },
      ast: { name() { names++; return undefined; } },
      source: { navigation: {} }, diagnostics: [],
    },
  };
  return { builder, walk, counts: () => ({ admissions, names }) };
}

test("one completed source parameter owns ABI admission and binding inspection", () => {
  const current = fixture();
  const parameter = {};
  assert.equal(recordRustParameterAbiSelection(current.walk, parameter, abi), true);
  const fact = current.builder.sourceParameterAbi.get(parameter);
  assert.equal(recordRustParameterAbiSelection(current.walk, parameter, {
    ...abi, valueCarrier: { ...integer }, parameterCarrier: { ...integer },
  }), true);
  assert.equal(current.builder.sourceParameterAbi.get(parameter) === fact, true, "native ABI identity is canonical");
  assert.equal(current.builder.runtimeCarrier.get(parameter)?.carrier === integer, true);
  assert.deepEqual(current.counts(), { admissions: 1, names: 1 }, "a repeated complete query has no admission or binding replay");
  current.builder.seal(current.walk.context.requiredRecords);
  assert.throws(() => recordRustParameterAbiSelection(current.walk, parameter, abi), /after analysis is sealed/u);
  assert.deepEqual(current.counts(), { admissions: 1, names: 1 }, "the phase guard runs before cached work");
});

test("a cached parameter refuses every changed native ABI dimension before publishing or inspecting bindings", () => {
  const current = fixture();
  const parameter = {};
  const selected = { ...abi, mode: "ref", inputLifetime: lifetime,
    parameterCarrier: { kind: "reference", referent: integer, mutable: false, lifetime } };
  assert.equal(recordRustParameterAbiSelection(current.walk, parameter, selected), true);
  const canonical = current.builder.sourceParameterAbi.get(parameter);
  const conversion = selectRustSourceValueConversion(integer, wide);
  assert.equal(conversion !== undefined, true, "use a selected native widening conversion");
  for (const change of [{ form: "optional" }, { valueCarrier: wide }, { parameterCarrier: integer },
    { mode: "mut-ref" }, { inputLifetime: { ...lifetime, identity: "other" } },
    { inputLifetime: undefined }, { entryConversion: Object.freeze({ conversion, contract: rustValueConversionContract(conversion) }) }]) {
    assert.throws(() => recordRustParameterAbiSelection(current.walk, parameter, { ...selected, ...change }),
      /Conflicting Rust semantic plan 'tsonic\.rust\.sourceParameterAbi'/u, Object.keys(change).join());
    assert.equal(current.builder.sourceParameterAbi.get(parameter) === canonical, true);
  }
  assert.deepEqual(current.counts(), { admissions: 1, names: 1 });
});

test("a rejected binding is not cached as a completed parameter", () => {
  const current = fixture();
  const parameter = {};
  const pattern = {};
  const malformedElement = {};
  current.walk.context.ast.name = () => pattern;
  current.walk.context.ast.kindName = node => node === pattern ? "KindArrayBindingPattern" : "KindIdentifier";
  current.walk.context.ast.elements = () => [malformedElement];
  assert.equal(recordRustParameterAbiSelection(current.walk, parameter, abi), false);
  assert.equal(current.walk.finalizedParameters.has(parameter), false, "no success state for an incomplete binding");
  assert.deepEqual(current.walk.context.diagnostics.map(issue => issue.code), ["RUST_BINDING_PATTERN_NOT_CLOSED"]);
});
