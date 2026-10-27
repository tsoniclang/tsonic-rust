import assert from "node:assert/strict";
import test from "node:test";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { selectRustProgramErrorConversion } from "../../../dist/policy/conversions/program-error.js";
import { rustJsErrorTargetType, rustProgramErrorTargetType, rustOptionTargetType, rustSourcePrimitiveTargetType,
  rustSourceTypeCarrier, rustSourceUnionTargetType } from "../../../dist/target-model/types/index.js";
import { rustSourceErrorTargetType } from "../../../dist/target-model/types/carriers/source-error.js";
import { rustUnionLeaves } from "../../../dist/target-model/types/union-relations.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustProgramErrorConversionMatches } from "../../../dist/policy/conversions/program-error.js";
import { rustNativeErrorJoinTargetType } from "../../../dist/target-model/types/native-error-joins.js";

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

test("fixed program error destinations preserve exact native join arms and identity owners", () => {
  const definitions = definitionsFor();
  const destination = rustProgramErrorTargetType({ kind: "physical", domain: "runtime" });
  const joined = rustNativeErrorJoinTargetType("/src/index.ts", [destination, native]);
  const nested = rustNativeErrorJoinTargetType("/src/index.ts", [joined, builtin]);
  for (const source of [joined, nested]) {
    const conversion = selectRustProgramErrorConversion(source, destination, definitions);
    assert.equal(conversion?.route.kind, "union", "a fixed error slot converts the original native sum, not a replacement carrier");
    const leaves = rustUnionLeaves(source, definitions);
    assert.equal(conversion.route.arms.length, leaves.length, "every actual native error leaf has one route");
    for (const [index, arm] of conversion.route.arms.entries()) {
      assert.equal(rustTargetTypeRefEquals(arm.carrier, leaves[index].carrier), true, "the original native payload is unchanged");
      assert.equal(JSON.stringify(arm.path) === JSON.stringify(leaves[index].path), true, "all native ErrorN path components retain their exact order");
      if (rustTargetTypeRefEquals(arm.carrier, destination)) {
        assert.equal(arm.route.kind, "identity", "the identical physical owner is moved unchanged without an adapter");
      }
    }
    assert.equal(rustProgramErrorConversionMatches(conversion, source, destination, definitions), true,
      "the complete selected native sum validates against its one destination");
    const changed = { ...conversion, route: { ...conversion.route, arms: conversion.route.arms.toReversed() } };
    assert.equal(rustProgramErrorConversionMatches(changed, source, destination, definitions), false,
      "reordered native error alternatives are not the same conversion");
    const forged = { ...conversion, route: { ...conversion.route,
      arms: conversion.route.arms.map(arm => ({ ...arm, route: { kind: "identity" } })) } };
    assert.equal(rustProgramErrorConversionMatches(forged, source, destination, definitions), false,
      "a registered but different native error cannot masquerade as the destination owner");
  }
  const foreign = rustProgramErrorTargetType({ kind: "physical", domain: "project", componentId: "foreign" });
  const identity = selectRustProgramErrorConversion(destination, destination, definitions);
  assert.equal(identity?.route.kind, "identity", "an identical owner needs no conversion");
  assert.equal(rustProgramErrorConversionMatches(identity, destination, foreign, definitions), false,
    "matching program-error spellings never substitute for exact physical ownership");
  const unknown = rustNativeErrorJoinTargetType("/src/index.ts", [destination, { kind: "target-named", id: "foreign.Error" }]);
  assert.equal(selectRustProgramErrorConversion(unknown, destination, definitions), undefined,
    "every joined native provider error still requires its real registration");
});

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

test("source Error recovery rejects missing registration, unknown arms, absence and cycles", () => {
  const definitions = definitionsFor();
  const recovery = rustSourceErrorTargetType();
  for (const rejected of [native, project]) {
    const missing = { ...definitions, programErrorOrigin: carrier =>
      rustTargetTypeRefEquals(carrier, rejected) ? undefined : definitions.programErrorOrigin(carrier) };
    assert.equal(selectRustProgramErrorConversion(outer, recovery, missing) === undefined, true);
  }
  assert.equal(selectRustProgramErrorConversion(outer), undefined);
  for (const carrier of [rustSourcePrimitiveTargetType("uint64"), rustOptionTargetType(builtin),
    rustSourceTypeCarrier("/other.ts", "Error", "object"), { ...native, id: "native.Unrelated" }]) {
    assert.equal(selectRustProgramErrorConversion(carrier, recovery, definitions) === undefined, true);
  }
  const cycle = { programErrorOrigin: () => undefined, sourceUnionVariants: carrier => carrier === outer ? [{ name: "Recursive", carrier: outer }] : undefined };
  assert.equal(selectRustProgramErrorConversion(outer, undefined, cycle), undefined);
});

test("general throwing values retain an exact closed admission without acquiring Error recovery", () => {
  const definitions = definitionsFor();
  const source = rustSourcePrimitiveTargetType("uint64");
  const conversion = selectRustProgramErrorConversion(source, undefined, definitions);
  assert.equal(conversion?.route.kind, "closed-admission");
  assert.equal(rustProgramErrorConversionMatches(conversion, source, rustProgramErrorTargetType(), definitions), true);
  assert.equal(selectRustProgramErrorConversion(source, rustSourceErrorTargetType(), definitions) === undefined, true);
  assert.equal(selectRustProgramErrorConversion(rustOptionTargetType(builtin), undefined, definitions) === undefined, true);
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
