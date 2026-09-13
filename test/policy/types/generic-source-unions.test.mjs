import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { rustSourceUnionTargetType, rustSourceUnionCarrierValue, rustSourcePrimitiveTargetType, rustStructuralObjectTargetType } from "../../../dist/target-model/types/index.js";
import { substituteRustTargetTypeParameters } from "../../../dist/target-model/types/carriers/substitution.js";
import { inferRustTargetTypeParameterBindings } from "../../../dist/target-model/types/carriers/generic-inference.js";
import { createRustSourceTypeRegistry } from "../../../dist/analysis/project-types/source-type-registry.js";
import { createRustStructuralShapePlan } from "../../../dist/analysis/objects/structural-shape-plan.js";

test("source union generic arguments survive substitution and reject malformed metadata", () => {
  const parameter = { kind: "type-parameter", name: "Element" };
  const integer = rustSourcePrimitiveTargetType("int32");
  const original = rustSourceUnionTargetType("/src/region.ts", "Region", [
    { name: "First", carrier: parameter },
    { name: "Second", carrier: rustSourcePrimitiveTargetType("bool") },
  ], [{ kind: "type", type: parameter }]);
  const substituted = substituteRustTargetTypeParameters(original, new Map([["Element", integer]]));
  const value = rustSourceUnionCarrierValue(substituted);
  assert.deepEqual(value.genericArguments, [{ kind: "type", type: integer }]);
  assert.deepEqual(value.variants[0].carrier, integer);
  assert.deepEqual(inferRustTargetTypeParameterBindings(original, substituted, new Set(["Element"])), new Map([["Element", integer]]));
  const missingArguments = { ...substituted.value };
  delete missingArguments.genericArguments;
  assert.equal(rustSourceUnionCarrierValue({ ...substituted, value: missingArguments }), undefined);
  assert.equal(rustSourceUnionCarrierValue({ ...substituted, value: { ...substituted.value, genericArguments: [{ kind: "type" }] } }), undefined);
  const contradictory = { ...substituted, value: { ...substituted.value, genericArguments: [{ kind: "type", type: rustSourcePrimitiveTargetType("bool") }] } };
  assert.equal(inferRustTargetTypeParameterBindings(original, contradictory, new Set(["Element"])), undefined);
});

test("generic source unions retain cross-file narrowing and concrete instantiations", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "generic_source_union" } },
    files: {
      "region.ts": `
import type { Pointer, uint8 } from "@tsonic/core/types.js";
import { loadPointer } from "@tsonic/core/lang.js";
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
  return loadPointer(region.at());
}
`,
      "index.ts": `
import { check } from "@acme/testing";
import type { int32, uint8 } from "@tsonic/core/types.js";
import { allocatePointer, storePointer } from "@tsonic/core/lang.js";
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
  const pointer = allocatePointer<uint8>(byte);
  check(readByteRegion(retained) === byte);
  check(readByteRegion(retainPointer({kind: "pointer", at: () => pointer})) === byte);
  const inline = retainPointer({kind: "pointer", at: () => pointer});
  storePointer(pointer, 31);
  check(readByteRegion(inline) === 31);
  check(readByteRegion(undefined) === 0);
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/region.rs"), /enum Region<Element>/u);
  const run = validateGeneratedProject("generic-source-union", result.artifacts, { run: true });
  assert.equal(run.status, 0, JSON.stringify(run));
});

test("generic structural storage preserves exact arguments while sharing alpha-equivalent definitions", () => {
  const parameter = name => ({ kind: "type-parameter", name });
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
    kind: "type", type: { kind: "type-parameter", name: renamedParameters.get(argument.type.name) },
  })));
  assert.deepEqual(plan.field(renamed, 0).carrier, parameter("Zed"));
  assert.deepEqual(plan.field(renamed, 1).carrier, parameter("Alpha"));
  assert.equal(second.sourceCarriers.length, 2);
  assert.notEqual(first.targetName, plan.definitionForCarrier(repeated).targetName);
  assert.notEqual(first.targetName, plan.definitionForCarrier(immutable).targetName);
  assert.notEqual(plan.definitionForCarrier(integer).targetName, plan.definitionForCarrier(unsigned).targetName);
  assert.equal(plan.field(renamed, -1), undefined);
  assert.equal(plan.field(renamed, 0.5), undefined);
  assert.equal(plan.definitionForCarrier(shape(parameter("New"), parameter("Other"))), undefined);
});

test("equal target carriers retain distinct source instantiations without ambiguous refinements", () => {
  const registry = createRustSourceTypeRegistry();
  const declaration = {};
  const parameter = { kind: "type-parameter", name: "Element" };
  const carrier = rustSourceUnionTargetType("/src/region.ts", "Region", [
    { name: "First", carrier: parameter },
    { name: "Second", carrier: rustSourcePrimitiveTargetType("bool") },
  ], [{ kind: "type", type: parameter }]);
  const firstType = {};
  const secondType = {};
  const first = { declaration, sourceType: {}, carrier, selectedProperties: [], variants: [
    { name: "First", sourceType: firstType, carrier: parameter },
    { name: "Second", sourceType: secondType, carrier: rustSourcePrimitiveTargetType("bool") },
  ] };
  const instantiatedTypes = [{}, {}];
  const second = { ...first, sourceType: {}, variants: first.variants.map((variant, index) => ({
    ...variant, sourceType: instantiatedTypes[index],
  })) };
  assert.equal(registry.registerSourceUnion(first), true);
  assert.equal(registry.registerSourceUnion(second), true);
  assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(carrier, [first.sourceType]), [0, 1]);
  assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(carrier, [second.sourceType]), [0, 1]);
  assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(carrier, [firstType]), [0]);
  assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(carrier, [instantiatedTypes[1]]), [1]);
  assert.equal(registry.sourceUnionVariantIndexesForTypes(carrier, [{}]), undefined);
  const contradictory = { ...second, sourceType: {}, variants: second.variants.map((variant, index) => ({
    ...variant, sourceType: instantiatedTypes[1 - index],
  })) };
  assert.equal(registry.registerSourceUnion(contradictory), false);
  assert.equal(registry.sourceUnionVariantIndexesForTypes(carrier, [contradictory.sourceType]), undefined);
  assert.deepEqual(registry.sourceUnionVariantIndexesForTypes(carrier, [instantiatedTypes[1]]), [1]);
});

test("structural instantiations reuse only their proven generic storage template", () => {
  const template = rustStructuralObjectTargetType("/src/region.ts", [
    { sourceName: "value", type: { kind: "type-parameter", name: "Element" }, readonly: true, presence: "required" },
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
    { sourceName: "different", type: { kind: "type-parameter", name: "Element" }, readonly: true, presence: "required" },
  ]);
  assert.throws(() => createRustStructuralShapePlan(shapes, [], () => "root", [], [{ template: wrongTemplate, instance }]), /missing.*template/u);
  assert.throws(() => createRustStructuralShapePlan([...shapes, { carrier: wrongTemplate }], [], () => "root", [], [{ template: wrongTemplate, instance }]), /exact generic-parameter correspondence/u);
  assert.throws(() => createRustStructuralShapePlan(shapes, [], () => "root", [], [{ template, instance }, { template: instance, instance: template }]), /cyclic/u);
});
