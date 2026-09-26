import assert from "node:assert/strict";
import test from "node:test";
import { valueStructProofFiles } from "../../../../tsonic/test/fixtures/value-structs.mjs";
import { valueRecordMemoryProofFiles } from "../../../../tsonic/test/fixtures/value-record-memory.mjs";
import { fixedArrayMemoryProofFiles } from "../../../../tsonic/test/fixtures/fixed-array-memory.mjs";
import { memoryAbiCapability } from "../../helpers/memory-abi.mjs";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { createRustStructuralShapePlan } from "../../../dist/analysis/objects/structural-shape-plan.js";
import { rustCompileTimeSourceKey } from "../../../dist/target-model/facts/source-declarations.js";
import { isRustCopyCarrier, rustCarrierSupportsTrait, rustOptionTargetType, rustStringTargetType, rustStructuralObjectCarrierValue, rustStructuralObjectTargetType } from "../../../dist/target-model/types/index.js";
import { substituteRustTargetTypeParameters } from "../../../dist/target-model/types/carriers/substitution.js";
import { writeRustStoredObjectField } from "../../../dist/backend/planner/objects/project-storage.js";
import { rustNativeMemoryLayoutsEqual } from "../../../dist/target-model/operations/native-memory.js";

for (const surfaces of [[], ["js"]]) {
  test(`fixed-array native codecs retain exact strides and independent snapshots in ${surfaces.length === 0 ? "native" : "JS"} source`, { timeout: 300_000 }, () => {
    const { result } = compileRust({
      surfaces, capabilities: [memoryAbiCapability("rust")],
      target: { id: "rust", options: { outputType: "bin", crateName: "fixed_array_memory" } },
      files: { ...fixedArrayMemoryProofFiles, "index.ts": `${fixedArrayMemoryProofFiles["index.ts"]}
export function main(): void { if (!run()) throw new Error("fixed array memory contract"); }` },
    });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject("fixed-array-memory", result.artifacts, { run: true });
  });
  test(`value structs preserve stored mutation, copies and field locations in ${surfaces.length === 0 ? "native" : "JS"} source`, { timeout: 300_000 }, () => {
    const { result } = compileRust({
      surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: "value_struct_proof" } },
      files: { ...valueStructProofFiles, "index.ts": `${valueStructProofFiles["index.ts"]}
export function main(): void { if (!run()) throw new Error("value struct contract"); }` },
    });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject("value-struct-contract", result.artifacts, { run: true });
  });
  test(`value record native codecs preserve offsets, snapshots and aliases in ${surfaces.length === 0 ? "native" : "JS"} source`, { timeout: 300_000 }, () => {
    const { result } = compileRust({
      surfaces, capabilities: [memoryAbiCapability("rust")],
      target: { id: "rust", options: { outputType: "bin", crateName: "value_record_memory" } },
      files: { ...valueRecordMemoryProofFiles, "index.ts": `${valueRecordMemoryProofFiles["index.ts"]}
export function main(): void { if (!run()) throw new Error("value record memory contract"); }` },
    });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject("value-record-memory", result.artifacts, { run: true });
  });
}

test("value-record Copy requires exactly the field contracts and survives generic substitution", () => {
  const field = type => ({ sourceName: "value", type, presence: "required", readonly: false });
  const value = rustStructuralObjectTargetType("/value.ts", [field(rustOptionTargetType({ kind: "type-parameter", name: "T" }))], "value");
  assert.equal(isRustCopyCarrier(value), false);
  assert.equal(rustCarrierSupportsTrait(value, "core::marker::Copy", (name, trait) => name === "T" && trait === "core::marker::Copy"), true);
  assert.equal(rustCarrierSupportsTrait(value, "core::marker::Copy", () => false), false);
  assert.equal(isRustCopyCarrier(substituteRustTargetTypeParameters(value, new Map([["T", { kind: "source-primitive", name: "uint32" }]]))), true);
  assert.equal(isRustCopyCarrier(substituteRustTargetTypeParameters(value, new Map([["T", rustStringTargetType()]]))), false);
  assert.equal(isRustCopyCarrier(rustStructuralObjectTargetType("/reference.ts", [field({ kind: "source-primitive", name: "uint32" })])), false);
});

test("native layout equality binds the exact native or source field projection", () => {
  const scalar = { kind: "scalar", pointeeCarrier: { kind: "source-primitive", name: "uint32" },
    size: 4, alignment: 4, width: 64, littleEndian: true, fields: [] };
  const selected = { projection: { kind: "value-field", storageIndex: 0 }, offset: 0, alignment: 4, layout: scalar };
  const record = { ...scalar, kind: "record", fields: [selected] };
  assert.equal(rustNativeMemoryLayoutsEqual(record, structuredClone(record)), true);
  for (const mutation of [
    { projection: { kind: "value-field", storageIndex: 1 } },
    { projection: { kind: "native-field", name: "count" } },
    { offset: 4 }, { alignment: 1 }, { layout: { ...scalar, width: 32 } },
    { layout: { ...scalar, pointeeCarrier: { kind: "source-primitive", name: "int32" } } },
  ]) assert.equal(rustNativeMemoryLayoutsEqual(record, { ...record, fields: [{ ...selected, ...mutation }] }), false);
});

for (const [name, replacement] of [
  ["reference carrier", "export interface Word { count: uint32 }"],
  ["mismatched scalar layout", "export const Word = struct({ count: field<uint8>() }); export type Word = typeof Word;"],
]) {
  test(`raw record storage rejects ${name} without publishing code`, () => {
    const files = { ...valueRecordMemoryProofFiles, "layout.ts": valueRecordMemoryProofFiles["layout.ts"]
      .replace("export const Word = struct({ count: field<uint32>() });\nexport type Word = typeof Word;", replacement) };
    if (name === "mismatched scalar layout") {
      assert.throws(() => compileRust({ capabilities: [memoryAbiCapability("rust")], files }),
        /TSEXT9901180: memoryfield requires the exact selected child layout for its field type/u);
      return;
    }
    const { result } = compileRust({ capabilities: [memoryAbiCapability("rust")], files });
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.category === "error"), JSON.stringify(result.diagnostics));
    assert.equal(result.artifacts.length, 0);
  });
}

test("value records retain their distinct storage choice through substitution and component canonicalization", () => {
  const fields = [{ sourceName: "value", type: { kind: "type-parameter", name: "T" }, presence: "required", readonly: false }];
  const reference = rustStructuralObjectTargetType("/record.ts", fields, "reference");
  const value = rustStructuralObjectTargetType("/record.ts", fields, "value");
  const substituted = substituteRustTargetTypeParameters(value, new Map([["T", { kind: "source-primitive", name: "uint32" }]]));
  assert.equal(rustStructuralObjectCarrierValue(substituted).representation, "value");
  assert.deepEqual(rustStructuralObjectCarrierValue(substituted).fields[0].type, { kind: "source-primitive", name: "uint32" });
  const shapes = [reference, value].map(carrier => ({ sourceType: {}, carrier, storage: "structural-object", fields: [] }));
  const plan = createRustStructuralShapePlan(shapes, [], () => "app", []);
  assert.equal(plan.definitions.length, 2);
  assert.equal(plan.sharesStorage(reference, value), false);
  for (const representation of [undefined, null, "shared", true]) {
    assert.equal(rustStructuralObjectCarrierValue({ ...value, value: { ...value.value, representation } }), undefined);
  }
  assert.equal(rustStructuralObjectCarrierValue({ ...value, value: { ownerFileName: "/record.ts", fields } }), undefined);
  assert.ok(rustStructuralObjectCarrierValue(rustStructuralObjectTargetType("/empty.ts", [], "value")));
  assert.equal(rustStructuralObjectCarrierValue(rustStructuralObjectTargetType("/empty.ts", [], "reference")), undefined);
});

test("selected struct builders are compile-time declarations, not executed or inferred from spelling", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
import { field as nativeField, struct as nativeStruct } from "@tsonic/core/lang.js";
import type { uint32 } from "@tsonic/core/types.js";
const Point = nativeStruct({ x: nativeField<uint32>() });
function struct(value: uint32): uint32 { return value; }
export function run(): uint32 { return struct(4); }
` } });
  const { ast } = program.source;
  const selected = [];
  const ordinary = [];
  const visit = node => {
    if (ast.is.IsCallExpression(node)) {
      if (program.facts.getFact(node, rustCompileTimeSourceKey)) selected.push(node);
      else ordinary.push(node);
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.source.sourceFiles.filter(file => ast.getFileName(file).endsWith("/index.ts"))) visit(file);
  assert.equal(selected.length, 1);
  assert.ok(ordinary.length >= 1);
  assert.equal(program.structuralShapes.definitions.filter(definition =>
    rustStructuralObjectCarrierValue(definition.carrier)?.representation === "value").length, 1);
});

test("a struct cannot erase unproved field calls", () => {
  assert.throws(() => compileRust({ files: { "index.ts": `
      import { field, struct } from "@tsonic/core/lang.js";
      import type { uint32 } from "@tsonic/core/types.js";
      function value(): uint32 { return 1; }
      const Point = struct({ x: value() });` } }), /TSEXT9901109: struct\(\.\.\.\) field shape members require finalized field<T>\(\) facts/u);
});

test("stored value-field writes require writable sealed field metadata", () => {
  const field = { sourceName: "count", type: { kind: "source-primitive", name: "uint32" }, presence: "required", readonly: false };
  const carrier = rustStructuralObjectTargetType("/value.ts", [field], "value");
  const stored = { targetName: "count", carrier: field.type, storage: "stored", readonly: false };
  const context = selected => ({ input: { program: { structuralShapes: { field: () => selected, definitionForCarrier: () => ({}) },
    frozenDataWrites: { receiverFor: () => undefined } } } });
  const write = selected => writeRustStoredObjectField("structural-object", carrier, { kind: "path", path: "value" }, 0,
    "=", { kind: "int-literal", text: "3" }, context(selected));
  assert.deepEqual(write(stored), { kind: "assignment", operator: "=",
    target: { kind: "field", receiver: { kind: "path", path: "value" }, name: "count" },
    value: { kind: "int-literal", text: "3" } });
  assert.equal(write({ ...stored, readonly: true }), undefined);
  assert.equal(write({ ...stored, storage: "property" }), undefined);
  assert.equal(write(undefined), undefined);
});

test("nested value-field writes do not assign the containing frozen property", () => {
  const scalar = { kind: "source-primitive", name: "uint32" };
  const nested = rustStructuralObjectTargetType("/point.ts", [
    { sourceName: "x", type: scalar, presence: "required", readonly: false },
  ], "value");
  const carrier = rustStructuralObjectTargetType("/owner.ts", [
    { sourceName: "point", type: nested, presence: "required", readonly: true },
  ], "value");
  let checks = 0;
  const context = { input: { program: {
    structuralShapes: { field: () => ({ targetName: "point", carrier: nested, storage: "stored", readonly: true }), definitionForCarrier: () => ({}) },
    frozenDataWrites: { receiverFor: () => { checks += 1; return "receiver"; } },
  } } };
  const receiver = { kind: "path", path: "owner" };
  const value = { kind: "int-literal", text: "3" };
  assert.deepEqual(writeRustStoredObjectField("structural-object", carrier, receiver, 0, "=", value, context, ["x"]), {
    kind: "assignment", operator: "=", value,
    target: { kind: "field", receiver: { kind: "field", receiver, name: "point" }, name: "x" },
  });
  assert.equal(checks, 0);
});
