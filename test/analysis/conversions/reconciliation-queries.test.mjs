import assert from "node:assert/strict";
import test from "node:test";
import { createRustProgramRecordBuilder } from "../../../dist/analysis/program/records/create.js";
import { recordRustConversionSelection, recordRustOptionProjection, recordRustValueCarrierReconciliation } from "../../../dist/analysis/program/records/types/value-carrier-admission.js";
import { rustOptionTargetType, rustUnitTargetType } from "../../../dist/target-model/types/index.js";

const source = { kind: "source-primitive", name: "uint8" };
const target = { kind: "source-primitive", name: "int32" };
const wide = { kind: "source-primitive", name: "int64" };
const conversion = { kind: "exact-integer", source, target };
const scalar = { kind: "conversion", fact: { sourceCarrier: source, targetCarrier: target, conversion } };
const optional = { kind: "conversion", fact: { sourceCarrier: source, targetCarrier: rustOptionTargetType(target),
  conversion: { kind: "option-some", source, element: target, elementConversion: conversion } } };

function counted(builder) {
  const counts = { contextual: 0, option: 0, lifetime: 0, upcast: 0, conversion: 0 };
  const records = { ...builder,
    contextualValueConversions: { ...builder.contextualValueConversions, convert(...args) {
      counts.contextual += 1; return builder.contextualValueConversions.convert(...args);
    } },
    optionProjections: { ...builder.optionProjections,
      some(...args) { counts.option += 1; return builder.optionProjections.some(...args); },
      none(...args) { counts.option += 1; return builder.optionProjections.none(...args); } },
    callScopedLifetimes: { ...builder.callScopedLifetimes, reconcile(...args) {
      counts.lifetime += 1; return builder.callScopedLifetimes.reconcile(...args);
    } },
    projectUpcasts: { ...builder.projectUpcasts, project(...args) {
      counts.upcast += 1; return builder.projectUpcasts.project(...args);
    } },
    conversions: { ...builder.conversions, converted(...args) {
      counts.conversion += 1; return builder.conversions.converted(...args);
    } },
  };
  return { records, counts };
}

test("the complete optional and scalar reconciliation query consumes one canonical payload and presence", () => {
  const builder = createRustProgramRecordBuilder();
  const builderRequiredRecords = [];
  const { records, counts } = counted(builder);
  const node = {};
  recordRustValueCarrierReconciliation(records, builderRequiredRecords, node, optional);
  const payload = builder.contextualValueConversion.get(node);
  const presence = builder.optionProjection.get(node);
  for (const request of [optional, scalar, { ...scalar, fact: { ...scalar.fact, conversion: { ...conversion } } }]) {
    recordRustValueCarrierReconciliation(records, builderRequiredRecords, node, request);
  }
  assert.equal(counts.contextual, 1);
  assert.equal(counts.option, 1);
  assert.equal(builder.contextualValueConversion.get(node) === payload && builder.optionProjection.get(node) === presence, true);
  const child = createRustProgramRecordBuilder(undefined, builder.seal(builderRequiredRecords));
  const childRequiredRecords = [];
  const inherited = counted(child);
  recordRustValueCarrierReconciliation(inherited.records, childRequiredRecords, node, optional);
  recordRustValueCarrierReconciliation(inherited.records, childRequiredRecords, node, scalar);
  assert.equal(inherited.counts.contextual + inherited.counts.option, 0, "inherited query never calls either actual constructor");
  for (const change of [
    { ...scalar, fact: { ...scalar.fact, sourceCarrier: wide } },
    { ...scalar, fact: { ...scalar.fact, targetCarrier: wide } },
    { ...scalar, fact: { ...scalar.fact, conversion: { ...conversion, target: wide } } },
  ]) assert.throws(() => recordRustValueCarrierReconciliation(inherited.records, childRequiredRecords, node, change),
    /Conflicting Rust semantic plan 'tsonic\.rust\.contextualValueConversion'/u);
  assert.equal(child.contextualValueConversion.get(node) === payload, true);
});

test("native lifetime, ordered upcast and authored conversion queries do not repeat admission", () => {
  const builder = createRustProgramRecordBuilder();
  const builderRequiredRecords = [];
  const { records, counts } = counted(builder);
  const lifetimeNode = {};
  const lifetime = { kind: "call-scoped-lifetime", fact: { sourceCarrier: source, selectedCarrier: target } };
  recordRustValueCarrierReconciliation(records, builderRequiredRecords, lifetimeNode, lifetime);
  recordRustValueCarrierReconciliation(records, builderRequiredRecords, lifetimeNode, lifetime);
  assert.equal(counts.lifetime, 1);
  assert.throws(() => recordRustValueCarrierReconciliation(records, builderRequiredRecords, lifetimeNode,
    { ...lifetime, fact: { ...lifetime.fact, selectedCarrier: wide } }), /callScopedLifetimeReconciliation/u);
  const node = {};
  const variants = [{ name: "Narrow", carrier: source }, { name: "Wide", carrier: wide }];
  const upcast = { kind: "project-upcast", fact: { sourceCarrier: source, targetCarrier: target, sourceVariants: variants } };
  recordRustValueCarrierReconciliation(records, builderRequiredRecords, node, upcast);
  recordRustValueCarrierReconciliation(records, builderRequiredRecords, node, { ...upcast,
    fact: { ...upcast.fact, sourceVariants: variants.map(value => ({ ...value })) } });
  assert.equal(counts.upcast, 1);
  for (const sourceVariants of [undefined, [], [...variants].reverse(),
    [{ ...variants[0], carrier: wide }, variants[1]], [{ ...variants[0], name: "Other" }, variants[1]]]) {
    assert.throws(() => recordRustValueCarrierReconciliation(records, builderRequiredRecords, node,
      { ...upcast, fact: { ...upcast.fact, sourceVariants } }), /tsonic\.rust\.projectUpcast/u);
  }
  const absent = {};
  recordRustValueCarrierReconciliation(records, builderRequiredRecords, absent, { kind: "project-upcast", fact: { sourceCarrier: source, targetCarrier: target } });
  recordRustValueCarrierReconciliation(records, builderRequiredRecords, absent, { kind: "project-upcast",
    fact: { sourceCarrier: source, targetCarrier: target, sourceVariants: undefined } });
  assert.equal(counts.upcast, 2, "request normalizes exactly like its actual native constructor");
  recordRustConversionSelection(records, builderRequiredRecords, node, target);
  recordRustConversionSelection(records, builderRequiredRecords, node, { ...target });
  assert.equal(counts.conversion, 1);
  assert.throws(() => recordRustConversionSelection(records, builderRequiredRecords, node, wide), /tsonic\.rust\.conversion/u);
});

test("optional queries preserve exact absence and payload-before-presence failure order", () => {
  const builder = createRustProgramRecordBuilder();
  const builderRequiredRecords = [];
  const { records, counts } = counted(builder);
  const node = {};
  const none = { kind: "none", sourceCarrier: rustUnitTargetType(), resultCarrier: optional.fact.targetCarrier };
  recordRustOptionProjection(records, builderRequiredRecords, node, none);
  const original = builder.optionProjection.get(node);
  recordRustOptionProjection(records, builderRequiredRecords, node, { ...none });
  assert.equal(counts.option, 1);
  assert.throws(() => recordRustValueCarrierReconciliation(records, builderRequiredRecords, node, optional), /tsonic\.rust\.optionProjection/u);
  assert.equal(builder.contextualValueConversion.get(node)?.targetCarrier === target, true,
    "the original payload-before-presence order is retained on refusal");
  assert.equal(builder.optionProjection.get(node) === original, true);
  const unchanged = {};
  recordRustValueCarrierReconciliation(records, builderRequiredRecords, unchanged, { kind: "conversion", fact: {
    sourceCarrier: target, targetCarrier: optional.fact.targetCarrier,
    conversion: { kind: "option-some", source: target, element: target, elementConversion: null },
  } });
  assert.equal(builder.contextualValueConversion.get(unchanged) === undefined, true);
  assert.equal(builder.optionProjection.get(unchanged)?.kind, "some");
});

test("reconciliation is closed before any record cache or incoming metadata is inspected", () => {
  const builder = createRustProgramRecordBuilder();
  const builderRequiredRecords = [];
  builder.seal(builderRequiredRecords);
  const unexpected = new Proxy({}, { get: () => assert.fail("closed query inspects its request") });
  assert.throws(() => recordRustValueCarrierReconciliation(builder, builderRequiredRecords, {}, unexpected), /after analysis is sealed/u);
  assert.throws(() => recordRustOptionProjection(builder, builderRequiredRecords, {}, unexpected), /after analysis is sealed/u);
  assert.throws(() => recordRustConversionSelection(builder, builderRequiredRecords, {}, unexpected), /after analysis is sealed/u);
});
