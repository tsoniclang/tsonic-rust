import assert from "node:assert/strict";
import test from "node:test";
import { rustSourceUnionMemberTypes } from "../../../dist/policy/types/resolution/source-unions.js";
import { acmeTestingPackage, compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { rustSourceUnionTargetType, rustSourceUnionCarrierValue, rustSourcePrimitiveTargetType, rustStructuralObjectTargetType } from "../../../dist/target-model/types/index.js";
import { substituteRustTargetTypeParameters } from "../../../dist/target-model/types/carriers/substitution.js";
import { inferRustTargetTypeParameterBindings } from "../../../dist/target-model/types/carriers/generic-inference.js";
import { createRustSourceTypeRegistry } from "../../../dist/analysis/project-types/source-type-registry.js";
import { createRustStructuralShapePlan } from "../../../dist/analysis/objects/structural-shape-plan.js";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";

test("union member retention expands checked Boolean leaves with finite exact accounting", () => {
  const falseType = Object.freeze({ identity: "false" });
  const trueType = Object.freeze({ identity: "true" });
  const booleanType = Object.freeze({ identity: "boolean" });
  const numberType = Object.freeze({ identity: "number" });
  const malformed = Object.freeze({ identity: "malformed" });
  const semantics = { types: {
    isUnion: type => type === booleanType || type === malformed,
    unionOrIntersectionTypes: type => type === booleanType ? [falseType, trueType] : [undefined],
    isNullish: () => false, isVoidLike: () => false,
  } };
  assert.deepEqual(rustSourceUnionMemberTypes([booleanType, numberType], semantics), [falseType, trueType, numberType]);
  assert.deepEqual(rustSourceUnionMemberTypes([trueType, booleanType], semantics), [trueType, falseType]);
  assert.equal(rustSourceUnionMemberTypes([malformed], semantics) === undefined, true);
  assert.equal(rustSourceUnionMemberTypes([undefined], semantics) === undefined, true);
  assert.equal(rustSourceUnionMemberTypes(Array(4097).fill(numberType), semantics) === undefined, true);
  assert.equal(rustSourceUnionMemberTypes(Array(2049).fill(booleanType), semantics) === undefined, true);
  assert.deepEqual(rustSourceUnionMemberTypes(Array(2048).fill(booleanType), semantics), [falseType, trueType]);
});
test("source union generic arguments survive substitution and reject malformed metadata", () => {
  const parameter = { kind: "type-parameter", identity: "Element", name: "Element" };
  const integer = rustSourcePrimitiveTargetType("int32");
  const original = rustSourceUnionTargetType("/src/region.ts", "Region", [{ kind: "type", type: parameter }]);
  const definitions = createRustTypeDefinitionRegistry();
  assert.equal(definitions.registerSourceUnion({ carrier: original, variants: [
    { name: "First", carrier: parameter },
    { name: "Second", carrier: rustSourcePrimitiveTargetType("bool") },
  ] }, true), true);
  const substituted = substituteRustTargetTypeParameters(original, new Map([["Element", integer]]));
  const value = rustSourceUnionCarrierValue(substituted);
  assert.deepEqual(value.genericArguments, [{ kind: "type", type: integer }]);
  assert.deepEqual(definitions.sourceUnionVariants(substituted)[0].carrier, integer);
  assert.deepEqual(inferRustTargetTypeParameterBindings(original, substituted, new Set(["Element"])), new Map([["Element", integer]]));
  const missingArguments = { ...substituted.value };
  delete missingArguments.genericArguments;
  assert.equal(rustSourceUnionCarrierValue({ ...substituted, value: missingArguments }), undefined);
  assert.equal(rustSourceUnionCarrierValue({ ...substituted, value: { ...substituted.value, genericArguments: [{ kind: "type" }] } }), undefined);
  const contradictory = { ...substituted, value: { ...substituted.value, genericArguments: [{ kind: "type", type: rustSourcePrimitiveTargetType("bool") }] } };
  assert.deepEqual(inferRustTargetTypeParameterBindings(original, contradictory, new Set(["Element"])), new Map([["Element", rustSourcePrimitiveTargetType("bool")]]));
  assert.deepEqual(definitions.sourceUnionVariants(contradictory)[0].carrier, rustSourcePrimitiveTargetType("bool"));
  assert.equal(definitions.registerSourceUnion({ carrier: substituted, variants: definitions.sourceUnionVariants(contradictory) }, false), false);
});

test("generic source unions retain cross-file narrowing and concrete instantiations", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "generic_source_union" } },
    files: {
      "region.ts": `
import type { Pointer, uint8 } from "@tsonic/core/types.js";
import { loadptr } from "@tsonic/core/lang.js";
export type Region<Element> = {
  readonly kind: "array";
  readonly values: Element[];
} | {
  readonly kind: "callback";
  readonly at: (index: number) => Element;
};
export function read<Item>(region: Region<Item>, index: number): Item {
  if (region.kind === "array") return region.values[index];
  return region.at(index);
}
export function arrayRegion<Value>(value: Value): Region<Value> {
  return { kind: "array", values: [value] };
}
export function callbackRegion<Value>(value: Value): Region<Value> {
  return { kind: "callback", at: (index: number): Value => value };
}
export function nested<Value>(value: Value): () => () => Value {
  return () => () => value;
}
export type PointerRegion<Element> = {
  readonly kind: "value";
  readonly value: Element;
} | {
  readonly kind: "pointer";
  readonly at: () => Pointer<Element>;
};
export function retainPointer<Item>(region: PointerRegion<Item> | undefined): PointerRegion<Item> | undefined {
  return region;
}
export function retainBytePointer(region: PointerRegion<uint8> | undefined): PointerRegion<uint8> | undefined {
  return region;
}
export function readByteRegion(region: PointerRegion<uint8> | undefined): uint8 {
  if (region === undefined) return 0;
  if (region.kind === "value") return region.value;
  return loadptr(region.at());
}
`,
      "index.ts": `
import { check } from "@acme/testing";
import type { int32, uint8 } from "@tsonic/core/types.js";
import { allocateptr, storeptr } from "@tsonic/core/lang.js";
import { arrayRegion, callbackRegion, nested, read, retainPointer, retainBytePointer, readByteRegion } from "./region.js";
export function main(): void {
  check(read(arrayRegion(7), 0) === 7);
  check(read(arrayRegion<int32>(13), 0) === 13);
  check(read(arrayRegion("value"), 0) === "value");
  check(read(callbackRegion(11), 2) === 11);
  check(read(callbackRegion("other"), 3) === "other");
  const repeated = callbackRegion("retained");
  check(read(repeated, 1) === "retained");
  check(read(repeated, 2) === "retained");
  const delayed = nested("nested")();
  check(delayed() === "nested");
  check(delayed() === "nested");
  check(retainPointer<string>(undefined) === undefined);
  check(retainBytePointer(undefined) === undefined);
  const byte: uint8 = 29;
  const retained = retainBytePointer({kind: "value", value: byte});
  check(retained !== undefined && retained.kind === "value" && retained.value === byte);
  const pointer = allocateptr<uint8>(byte);
  check(readByteRegion(retained) === byte);
  check(readByteRegion(retainPointer({kind: "pointer", at: () => pointer})) === byte);
  const inline = retainPointer({kind: "pointer", at: () => pointer});
  storeptr(pointer, 31);
  check(readByteRegion(inline) === 31);
  check(readByteRegion(undefined) === 0);
}
`,
    },
  });
  assert.equal(result.diagnostics.length, 0,
    result.diagnostics.slice(0, 6).map(row => row.message.slice(0, 256)).join("\n"));
  assert.equal(/enum Region<Element>/u.test(artifactText(result, "src/region.rs")), false,
    "a source type alias does not invent another physical enum");
  assert.equal((artifactText(result, "src/shapes.rs").match(/pub enum Union2</gu) ?? []).length, 1,
    "all exact payload instantiations share one native sum definition");
  const run = validateGeneratedProject("generic-source-union", result.artifacts, { run: true });
  assert.equal(run.status, 0, JSON.stringify(run));
});

test("generic structural storage preserves exact arguments while sharing alpha-equivalent definitions", () => {
  const parameter = name => ({ kind: "type-parameter", identity: name, name });
  const shape = (first, second, readonly = false) => rustStructuralObjectTargetType("/src/region.ts", [
    { sourceName: "first", type: first, readonly, presence: "required" },
    { sourceName: "second", type: second, readonly, presence: "required" },
  ]);
  const original = shape(parameter("Left"), parameter("Right"));
  const renamed = shape(parameter("Zed"), parameter("Alpha"));
  const repeated = shape(parameter("Same"), parameter("Same"));
  const immutable = shape(parameter("Left"), parameter("Right"), true);
  const integer = shape(parameter("Left"), rustSourcePrimitiveTargetType("int32"));
  const unsigned = shape(parameter("Left"), rustSourcePrimitiveTargetType("uint32"));
  const carriers = [original, renamed, repeated, immutable, integer, unsigned];
  const plan = createRustStructuralShapePlan(carriers.map(carrier => ({ carrier })), [], () => "root", []);
  assert.equal(plan.definitions.length, 5);
  const first = plan.definitionForCarrier(original);
  const second = plan.definitionForCarrier(renamed);
  assert.equal(first.targetName, second.targetName);
  assert.deepEqual(new Set(first.genericArguments.map(argument => argument.type.name)), new Set(["Left", "Right"]));
  const renamedParameters = new Map([["Left", "Zed"], ["Right", "Alpha"]]);
  assert.deepEqual(second.genericArguments, first.genericArguments.map(argument => ({
    kind: "type", type: parameter(renamedParameters.get(argument.type.name)),
  })));
  assert.deepEqual(plan.field(renamed, 0).carrier, parameter("Zed"));
  assert.deepEqual(plan.field(renamed, 1).carrier, parameter("Alpha"));
  assert.equal(second.sourceCarriers.length, 2);
  assert.notEqual(first.targetName, plan.definitionForCarrier(repeated).targetName);
  assert.notEqual(first.targetName, plan.definitionForCarrier(immutable).targetName);
  assert.notEqual(plan.definitionForCarrier(integer).targetName, plan.definitionForCarrier(unsigned).targetName);
  assert.equal(plan.field(renamed, -1), undefined);
  assert.equal(plan.field(renamed, 0.5), undefined);
  const instantiated = shape(parameter("New"), parameter("Other"));
  const selected = plan.definitionForCarrier(instantiated);
  assert.ok(selected);
  assert.equal(selected.targetName, first.targetName);
  assert.deepEqual(selected.genericArguments, [{ kind: "type", type: parameter("New") }, { kind: "type", type: parameter("Other") }]);
  assert.deepEqual(plan.field(instantiated, 0).carrier, parameter("New"));
  assert.deepEqual(plan.field(instantiated, 1).carrier, parameter("Other"));
  const mismatched = rustStructuralObjectTargetType("/src/region.ts", [
    { sourceName: "different", type: parameter("New"), readonly: false, presence: "required" },
    { sourceName: "second", type: parameter("Other"), readonly: false, presence: "required" },
  ]);
  assert.equal(plan.definitionForCarrier(mismatched), undefined);
  assert.equal(plan.definitionForCarrier(shape(parameter("Same"), parameter("Same"), true)), undefined);
});

test("equal target carriers retain distinct source instantiations without ambiguous refinements", () => {
  const registry = createRustSourceTypeRegistry();
  const declaration = {};
  const parameter = { kind: "type-parameter", identity: "Element", name: "Element" };
  const carrier = rustSourceUnionTargetType("/src/region.ts", "Region", [{ kind: "type", type: parameter }]);
  const firstType = {};
  const secondType = {};
  const first = { declaration, sourceType: {}, carrier, selectedProperties: [], variants: [
    { name: "First", sourceTypes: [firstType], carrier: parameter },
    { name: "Second", sourceTypes: [secondType], carrier: rustSourcePrimitiveTargetType("bool") },
  ] };
  const instantiatedTypes = [{}, {}];
  const second = { ...first, sourceType: {}, variants: first.variants.map((variant, index) => ({
    ...variant, sourceTypes: [instantiatedTypes[index]],
  })) };
  assert.equal(registry.registerSourceUnion(first), true);
  assert.equal(registry.registerSourceUnion(second), true);
  assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(carrier, [first.sourceType]), [0, 1]);
  assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(carrier, [second.sourceType]), [0, 1]);
  assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(carrier, [firstType]), [0]);
  assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(carrier, [instantiatedTypes[1]]), [1]);
  assert.equal(registry.sourceUnionVariantIndexesForTypes(carrier, [{}]), undefined);
  const contradictory = { ...second, sourceType: {}, variants: second.variants.map((variant, index) => ({
    ...variant, sourceTypes: [instantiatedTypes[1 - index]],
  })) };
  assert.equal(registry.registerSourceUnion(contradictory), false);
  assert.equal(registry.sourceUnionVariantIndexesForTypes(carrier, [contradictory.sourceType]), undefined);
  assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(carrier, [instantiatedTypes[1]]), [1]);
});

test("one native arm retains every checked source member and rejects ambiguous grouping", () => {
  const registry = createRustSourceTypeRegistry();
  const carrier = rustSourceUnionTargetType("/src/index.ts", "Flags");
  const falseType = {};
  const trueType = {};
  const integerType = {};
  const union = { declaration: {}, sourceType: {}, carrier, selectedProperties: [], variants: [
    { name: "Boolean", sourceTypes: [falseType, trueType], carrier: rustSourcePrimitiveTargetType("bool") },
    { name: "Integer", sourceTypes: [integerType], carrier: rustSourcePrimitiveTargetType("int64") },
  ] };
  assert.equal(registry.registerSourceUnion(union), true);
  assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(carrier, [falseType]), [0]);
  assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(carrier, [trueType]), [0]);
  assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(carrier, [trueType, falseType, integerType]), [0, 1]);
  assert.ok(Object.isFrozen(registry.sourceUnionForCarrier(carrier).variants[0].sourceTypes));
  for (const sourceTypes of [[], [falseType, falseType], [falseType, integerType], [undefined]]) {
    assert.equal(registry.registerSourceUnion({ ...union, sourceType: {}, variants: [
      { ...union.variants[0], sourceTypes }, union.variants[1],
    ] }), false);
  }
  union.variants[0].sourceTypes.pop();
  assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(carrier, [trueType]), [0]);
});

test("structural instantiations reuse only their proven generic storage template", () => {
  const template = rustStructuralObjectTargetType("/src/region.ts", [
    { sourceName: "value", type: { kind: "type-parameter", identity: "Element", name: "Element" }, readonly: true, presence: "required" },
  ]);
  const byte = rustSourcePrimitiveTargetType("uint8");
  const instance = substituteRustTargetTypeParameters(template, new Map([["Element", byte]]));
  const shapes = [{ carrier: template }, { carrier: instance }];
  const independent = createRustStructuralShapePlan(shapes, [], () => "root", []);
  assert.equal(independent.definitions.length, 2);
  const plan = createRustStructuralShapePlan(shapes, [], () => "root", [], [{ template, instance }]);
  assert.equal(plan.definitions.length, 1);
  assert.equal(plan.definitionForCarrier(template).targetName, plan.definitionForCarrier(instance).targetName);
  assert.deepEqual(plan.definitionForCarrier(instance).genericArguments, [{ kind: "type", type: byte }]);
  assert.deepEqual(plan.field(instance, 0).carrier, byte);
  const wrongTemplate = rustStructuralObjectTargetType("/src/region.ts", [
    { sourceName: "different", type: { kind: "type-parameter", identity: "Element", name: "Element" }, readonly: true, presence: "required" },
  ]);
  assert.throws(() => createRustStructuralShapePlan(shapes, [], () => "root", [], [{ template: wrongTemplate, instance }]), /missing.*template/u);
  assert.throws(() => createRustStructuralShapePlan([...shapes, { carrier: wrongTemplate }], [], () => "root", [], [{ template: wrongTemplate, instance }]), /exact generic-parameter correspondence/u);
  assert.throws(() => createRustStructuralShapePlan(shapes, [], () => "root", [], [{ template, instance }, { template: instance, instance: template }]), /cyclic/u);
});
