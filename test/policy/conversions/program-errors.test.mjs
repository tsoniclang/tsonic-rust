import assert from "node:assert/strict";
import test from "node:test";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { selectRustProgramErrorConversion } from "../../../dist/target-model/conversions/program-error.js";
import { rustJsErrorTargetType, rustProgramErrorTargetType, rustOptionTargetType, rustSourcePrimitiveTargetType,
  rustSourceTypeCarrier, rustSourceUnionTargetType } from "../../../dist/target-model/types/index.js";
import { rustUnionLeaves } from "../../../dist/target-model/types/union-relations.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustProgramErrorConversionMatches } from "../../../dist/target-model/conversions/program-error.js";

const builtin = rustJsErrorTargetType();
const native = { kind: "target-named", id: "native.Failure" };
const project = rustSourceTypeCarrier("/src/failure.ts", "Failure", "object");
const inner = rustSourceUnionTargetType("/src/index.ts", "Inner");
const outer = rustSourceUnionTargetType("/src/index.ts", "Outer");

function definitionsFor(reordered = false) {
  const registry = createRustTypeDefinitionRegistry();
  assert.equal(registry.registerProgramErrorOrigin(native, { kind: "provider" }), true);
  assert.equal(registry.registerProgramErrorOrigin(project, { kind: "project", variant: "Failure", sourceError: true }), true);
  assert.equal(registry.registerSourceUnion({ carrier: inner, variants: [
    { name: "Builtin", carrier: builtin }, { name: "Native", carrier: native },
  ] }, true), true);
  const variants = [{ name: "Nested", carrier: inner }, { name: "Project", carrier: project }];
  assert.equal(registry.registerSourceUnion({ carrier: outer, variants: reordered ? variants.toReversed() : variants }, true), true);
  return registry.seal();
}

test("closed native error routes retain every exact nested carrier and immutable path", () => {
  for (const reordered of [false, true]) {
    const definitions = definitionsFor(reordered);
    const conversion = selectRustProgramErrorConversion(outer, undefined, definitions);
    assert.ok(conversion);
    assert.equal(conversion.kind, "program-error");
    assert.deepEqual(conversion.target, rustProgramErrorTargetType());
    assert.equal(conversion.route.kind, "union");
    assert.deepEqual(conversion.route.arms.map(({ carrier, path }) => ({ carrier, path })), rustUnionLeaves(outer, definitions));
    assert.ok(Object.isFrozen(conversion) && Object.isFrozen(conversion.route) && Object.isFrozen(conversion.route.arms));
    assert.ok(conversion.route.arms.every(arm => Object.isFrozen(arm) && Object.isFrozen(arm.path) && Object.isFrozen(arm.route)));
    assert.deepEqual(conversion.route.arms.find(arm => rustTargetTypeRefEquals(arm.carrier, builtin)).route, { kind: "runtime", boundary: "target-runtime" });
    assert.deepEqual(conversion.route.arms.find(arm => rustTargetTypeRefEquals(arm.carrier, native)).route, { kind: "runtime", boundary: "provider-native" });
    assert.deepEqual(conversion.route.arms.find(arm => rustTargetTypeRefEquals(arm.carrier, project)).route, { kind: "project", variant: "Failure" });
    assert.equal(rustProgramErrorConversionMatches(conversion, outer, conversion.target, definitions), true);
  }
});

test("closed native error selection rejects missing registration, unknown arms, absence and cycles", () => {
  const definitions = definitionsFor();
  for (const rejected of [native, project]) {
    const missing = { ...definitions, programErrorOrigin: carrier =>
      rustTargetTypeRefEquals(carrier, rejected) ? undefined : definitions.programErrorOrigin(carrier) };
    assert.equal(selectRustProgramErrorConversion(outer, undefined, missing), undefined);
  }
  assert.equal(selectRustProgramErrorConversion(outer), undefined);
  for (const carrier of [rustSourcePrimitiveTargetType("uint64"), rustOptionTargetType(builtin),
    rustSourceTypeCarrier("/other.ts", "Error", "object"), { ...native, id: "native.Unrelated" }]) {
    assert.equal(selectRustProgramErrorConversion(carrier, undefined, definitions), undefined);
  }
  const cycle = { programErrorOrigin: () => undefined, sourceUnionVariants: carrier => carrier === outer ? [{ name: "Recursive", carrier: outer }] : undefined };
  assert.equal(selectRustProgramErrorConversion(outer, undefined, cycle), undefined);
});

test("error-route facts reject incomplete, reordered, stale, malformed and superseded evidence", () => {
  const definitions = definitionsFor();
  const conversion = selectRustProgramErrorConversion(outer, undefined, definitions);
  assert.ok(conversion);
  const arms = conversion.route.arms;
  const changedArms = [[], new Array(arms.length), arms.slice(1), arms.toReversed(),
    [arms[0], arms[0], arms[2]], [{ ...arms[0], path: [] }, ...arms.slice(1)],
    [{ ...arms[0], carrier: native }, ...arms.slice(1)],
    [{ ...arms[0], path: arms[0].path.map(step => ({ ...step, variant: { ...step.variant, name: "Missing" } })) }, ...arms.slice(1)],
    [{ ...arms[0], route: { kind: "runtime", boundary: "source-program" } }, ...arms.slice(1)],
    [{ ...arms[0], extra: true }, ...arms.slice(1)]];
  for (const selected of changedArms) assert.equal(rustProgramErrorConversionMatches({ ...conversion,
    route: { kind: "union", arms: selected } }, outer, conversion.target, definitions), false);
  const cycle = { ...conversion.route };
  cycle.arms = [{ ...arms[0], route: cycle }, ...arms.slice(1)];
  let reads = 0;
  const accessor = { ...conversion };
  Object.defineProperty(accessor, "route", { get() { reads++; return conversion.route; }, enumerable: true });
  for (const changed of [{ ...conversion, source: inner }, { ...conversion, target: builtin },
    { ...conversion, route: { ...conversion.route, extra: true } }, { ...conversion, route: cycle }, accessor,
    { kind: "program-error", source: outer, target: conversion.target, variant: "Failure" }]) {
    assert.equal(rustProgramErrorConversionMatches(changed, outer, conversion.target, definitions), false);
  }
  assert.equal(reads, 0);
  assert.equal(rustProgramErrorConversionMatches(conversion, outer, conversion.target, definitionsFor(true)), false);
});
