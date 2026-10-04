import assert from "node:assert/strict";
import test from "node:test";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { selectRustSourceValueConversion } from "../../../dist/policy/conversions/selection.js";
import { rustValueConversionContract } from "../../../dist/target-model/conversions/contracts.js";
import { rustUnionPayloadAdmission } from "../../../dist/target-model/conversions/union-injection.js";
import { rustUnionInjectionPath } from "../../../dist/target-model/types/union-relations.js";
import {
  rustAbsenceTargetType, rustJsErrorTargetType, rustJsPromiseTargetTypeWithLifetime,
  rustSourcePrimitiveTargetType, rustSourceUnionTargetType, rustStringTargetType, rustUnitTargetType,
  rustJsValueTargetType, rustTsValueTargetType,
} from "../../../dist/target-model/types/index.js";
import { lowerRustValueConversion } from "../../../dist/backend/planner/expressions/value-conversions.js";
import { fakeAstReader, fakeSourceFile, fakeStatement } from "../../helpers/fake-compile-input.mjs";
import { rustSourceErrorTargetType, rustWritableSourceErrorTargetType, rustMutableJsErrorTargetType } from "../../../dist/target-model/types/carriers/source-error.js";
import { rustOptionTargetType } from "../../../dist/target-model/types/index.js";

test("native Error payload conversion composes through the one Option and union grammar", () => {
  const source = rustJsErrorTargetType();
  const payload = rustSourceErrorTargetType();
  const target = rustSourceUnionTargetType("/src/index.ts", "Failure");
  const definitions = unionDefinitions([[target, [{ name: "Error", carrier: payload },
    { name: "Text", carrier: rustStringTargetType() }]]]);
  const conversion = selectRustSourceValueConversion(source, target, definitions);
  assert.equal(conversion?.kind, "source-union-variant");
  assert.equal(conversion.payloadConversion.kind, "program-error");
  assert.equal(rustValueConversionContract(conversion, definitions)?.fallible, false);
  for (const [actual, expected, kind] of [[source, rustOptionTargetType(target), "option-some"],
    [rustOptionTargetType(source), rustOptionTargetType(target), "option-map"]]) {
    const selected = selectRustSourceValueConversion(actual, expected, definitions);
    assert.equal(selected?.kind, kind);
    const contract = rustValueConversionContract(selected, definitions);
    assert.deepEqual(contract.source, actual);
    assert.deepEqual(contract.target, expected);
    assert.equal(contract.fallible, false);
  }
  for (const route of [{ kind: "runtime", boundary: "provider-native", extra: true },
    { kind: "runtime", boundary: "target-runtime", extra: true }, { kind: "project", variant: "Wrong" },
    { kind: "source-created" }]) {
    const changed = { ...conversion, payloadConversion: { ...conversion.payloadConversion, route } };
    assert.equal(rustValueConversionContract(changed, definitions), undefined);
  }
  assert.equal(selectRustSourceValueConversion(source, rustWritableSourceErrorTargetType()), undefined);
  assert.equal(selectRustSourceValueConversion(payload, rustWritableSourceErrorTargetType()), undefined);
  assert.equal(selectRustSourceValueConversion(rustMutableJsErrorTargetType(), rustWritableSourceErrorTargetType())?.kind, "program-error");
  const ambiguous = unionDefinitions([[target, [{ name: "Native", carrier: source }, { name: "View", carrier: payload }]]]);
  assert.equal(selectRustSourceValueConversion(source, target, ambiguous), undefined);
});

function unionDefinitions(rows) {
  const registry = createRustTypeDefinitionRegistry();
  for (const [carrier, variants] of rows) assert.equal(registry.registerSourceUnion({ carrier, variants }, true), true);
  return registry.seal();
}

function promiseFixture() {
  const source = rustJsPromiseTargetTypeWithLifetime(rustAbsenceTargetType(), { kind: "static" });
  const payloadCarrier = rustJsPromiseTargetTypeWithLifetime(rustUnitTargetType(), { kind: "placeholder" });
  const target = rustSourceUnionTargetType("/src/index.ts", "Completion");
  const definitions = unionDefinitions([[target, [
    { name: "Future", carrier: payloadCarrier }, { name: "Text", carrier: rustStringTargetType() },
  ]]]);
  return { source, payloadCarrier, target, definitions };
}

test("union injection composes one exact native payload admission without changing equality", () => {
  const { source, payloadCarrier, target, definitions } = promiseFixture();
  assert.equal(rustUnionInjectionPath(source, target, definitions), undefined);
  assert.deepEqual(rustUnionPayloadAdmission(source, target, definitions).carrier, payloadCarrier);
  const conversion = selectRustSourceValueConversion(source, target, definitions);
  assert.deepEqual(conversion, { kind: "source-union-variant", source, target, variantName: "Future",
    payloadCarrier, payloadConversion: { kind: "native-representation", source, target: payloadCarrier } });
  assert.ok(Object.isFrozen(conversion));
  const contract = rustValueConversionContract(conversion, definitions);
  assert.equal(contract.lowering, "source-union-variant");
  assert.equal(contract.payloadConversion.lowering, "identity");
  assert.equal(contract.payloadConversion.fallible, false);
  assert.deepEqual(contract.payloadConversion.source, source);
  assert.deepEqual(contract.payloadConversion.target, payloadCarrier);
  const identity = selectRustSourceValueConversion(payloadCarrier, target, definitions);
  assert.equal(identity.payloadConversion, null);
  assert.deepEqual(identity.payloadCarrier, payloadCarrier);
  assert.equal(rustValueConversionContract(identity, definitions).payloadConversion, null);
});

test("exact union payload admission is generic and constructs nested native variants once", () => {
  const source = rustAbsenceTargetType();
  const payloadCarrier = rustUnitTargetType();
  const inner = rustSourceUnionTargetType("/src/index.ts", "Inner");
  const target = rustSourceUnionTargetType("/src/index.ts", "Outer");
  const definitions = unionDefinitions([
    [inner, [{ name: "Complete", carrier: payloadCarrier }, { name: "Flag", carrier: rustSourcePrimitiveTargetType("bool") }]],
    [target, [{ name: "Nested", carrier: inner }, { name: "Text", carrier: rustStringTargetType() }]],
  ]);
  const conversion = selectRustSourceValueConversion(source, target, definitions);
  const contract = rustValueConversionContract(conversion, definitions);
  const wholeInner = rustUnionPayloadAdmission(inner, target, definitions);
  assert.ok(wholeInner);
  assert.deepEqual(wholeInner.path.map(step => step.variant.name), ["Nested"]);
  assert.deepEqual(wholeInner.carrier, inner);
  assert.deepEqual(contract.path.map(step => step.variant.name), ["Nested", "Complete"]);
  const node = fakeStatement({ kindName: "Identifier", pos: 0, end: 5 });
  const sourceFile = fakeSourceFile({ fileName: "/src/index.ts", text: "value", statements: [node] });
  const context = { input: { program: { source: { ast: fakeAstReader([sourceFile]) }, typeDefinitions: definitions,
    names: { nameForSourceType: (_file, name) => name }, configuration: { edition: "2024" } } },
    sourceFile, diagnostics: [], moduleName: "index", moduleNameByFileName: new Map([["/src/index.ts", "index"]]),
    externalCrateNameByFileName: new Map() };
  const expression = { kind: "call", path: "produce", args: [] };
  const planned = lowerRustValueConversion(contract, expression, context, node);
  assert.equal(planned.kind, "call");
  assert.match(planned.path, /Outer::Nested$/u);
  assert.match(planned.args[0].path, /Inner::Complete$/u);
  assert.equal(planned.args[0].args[0], expression);
  assert.deepEqual(context.diagnostics, []);
  assert.doesNotMatch(JSON.stringify(planned), /clone|map|Box|Rc|RefCell|as_mut|cast|Promise/u);
});

test("union payload admission rejects ambiguous, width-changing, error-changing and escaping lifetime choices", () => {
  const { source, payloadCarrier, target, definitions } = promiseFixture();
  for (const candidate of [
    rustJsPromiseTargetTypeWithLifetime(rustSourcePrimitiveTargetType("uint64"), { kind: "static" }),
    rustJsPromiseTargetTypeWithLifetime(rustAbsenceTargetType(), { kind: "static" }, rustJsErrorTargetType()),
    rustJsPromiseTargetTypeWithLifetime(rustAbsenceTargetType(), { kind: "bound", binderIdentity: "binder", identity: "scope", name: "scope" }),
    { ...source, id: "unrelated.Promise" },
  ]) assert.equal(selectRustSourceValueConversion(candidate, target, definitions), undefined);
  const staticTarget = rustSourceUnionTargetType("/src/index.ts", "StaticOnly");
  const staticDefinitions = unionDefinitions([[staticTarget, [{ name: "Future", carrier: source }]]]);
  assert.equal(selectRustSourceValueConversion(payloadCarrier, staticTarget, staticDefinitions), undefined);
  const ambiguous = rustSourceUnionTargetType("/src/index.ts", "Ambiguous");
  const ambiguousDefinitions = unionDefinitions([[ambiguous, [
    { name: "Owned", carrier: source }, { name: "Elided", carrier: payloadCarrier },
  ]]]);
  assert.equal(rustUnionPayloadAdmission(source, ambiguous, ambiguousDefinitions), undefined);
  assert.equal(selectRustSourceValueConversion(source, ambiguous, ambiguousDefinitions), undefined);
  const wide = rustSourceUnionTargetType("/src/index.ts", "Wide");
  const wideDefinitions = unionDefinitions([[wide, [{ name: "Value", carrier: rustSourcePrimitiveTargetType("int64") }]]]);
  assert.equal(selectRustSourceValueConversion(rustSourcePrimitiveTargetType("int32"), wide, wideDefinitions), undefined);
  const recursive = { programErrorOrigin: () => undefined, sourceUnionVariants: () => [{ name: "Self", carrier: target }] };
  assert.equal(rustUnionPayloadAdmission(source, target, recursive), undefined);
});

test("composed union facts reject old shapes, wrong presence, forged payloads, stale paths, getters and cycles", () => {
  const { source, payloadCarrier, target, definitions } = promiseFixture();
  const conversion = selectRustSourceValueConversion(source, target, definitions);
  const old = { kind: "source-union-variant", source, target, variantName: "Future" };
  const cycle = { ...conversion.payloadConversion };
  cycle.source = cycle;
  let getterCalls = 0;
  const getter = { ...conversion.payloadConversion };
  Object.defineProperty(getter, "target", { enumerable: true, get() { getterCalls++; throw new Error("must not execute"); } });
  for (const invalid of [
    old,
    { ...conversion, payloadConversion: null },
    { ...conversion, payloadConversion: undefined },
    { ...conversion, payloadConversion: 3 },
    { ...conversion, payloadConversion: {} },
    { ...conversion, payloadCarrier: source },
    { ...conversion, variantName: "Text" },
    { ...conversion, additional: true },
    { ...conversion, payloadConversion: { ...conversion.payloadConversion, extra: true } },
    { ...conversion, payloadConversion: { ...conversion.payloadConversion, source: payloadCarrier } },
    { ...conversion, payloadConversion: { ...conversion.payloadConversion, target: source } },
    { ...conversion, payloadConversion: { kind: "bottom-coercion", source, target: payloadCarrier } },
    { ...conversion, payloadConversion: getter },
    { ...conversion, payloadConversion: cycle },
  ]) assert.equal(rustValueConversionContract(invalid, definitions), undefined);
  assert.equal(getterCalls, 0);
  assert.equal(rustValueConversionContract(conversion), undefined);
  const stale = unionDefinitions([[target, [{ name: "Other", carrier: payloadCarrier }]]]);
  assert.equal(rustValueConversionContract(conversion, stale), undefined);
  const identity = selectRustSourceValueConversion(payloadCarrier, target, definitions);
  assert.equal(rustValueConversionContract({ ...identity, payloadConversion: conversion.payloadConversion }, definitions), undefined);
});

test("authored closed unions compose broad payload admission without erasing exact native members", () => {
  const integer = rustSourcePrimitiveTargetType("uint64");
  const text = rustStringTargetType();
  for (const broad of [rustJsValueTargetType(), rustTsValueTargetType()]) {
    const target = rustSourceUnionTargetType("/src/index.ts", "BroadResult");
    const definitions = unionDefinitions([[target, [
      { name: "Broad", carrier: broad }, { name: "Text", carrier: text },
    ]]]);
    const boxed = selectRustSourceValueConversion(integer, target, definitions);
    assert.equal(boxed?.kind, "source-union-variant");
    assert.equal(boxed.variantName, "Broad");
    assert.deepEqual(boxed.payloadCarrier, broad);
    const contract = rustValueConversionContract(boxed, definitions);
    assert.ok(contract);
    assert.equal(contract.payloadConversion.fallible, false);
    assert.deepEqual(contract.payloadConversion.source, integer);
    assert.deepEqual(contract.payloadConversion.target, broad);
    const exact = selectRustSourceValueConversion(text, target, definitions);
    assert.equal(exact.variantName, "Text");
    assert.equal(exact.payloadConversion, null);
    assert.equal(rustValueConversionContract({ ...boxed, variantName: "Text" }, definitions), undefined);
    assert.equal(rustValueConversionContract({ ...boxed, payloadCarrier: text }, definitions), undefined);
    assert.equal(selectRustSourceValueConversion({ kind: "type-parameter", name: "T", identity: "open" }, target, definitions), undefined);
  }
  const ambiguous = rustSourceUnionTargetType("/src/index.ts", "AmbiguousBroad");
  const definitions = unionDefinitions([[ambiguous, [
    { name: "Native", carrier: rustTsValueTargetType() }, { name: "JS", carrier: rustJsValueTargetType() },
  ]]]);
  assert.equal(rustUnionPayloadAdmission(integer, ambiguous, definitions), undefined);
  assert.equal(selectRustSourceValueConversion(integer, ambiguous, definitions), undefined);
});
