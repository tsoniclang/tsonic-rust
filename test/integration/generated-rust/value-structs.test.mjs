import assert from "node:assert/strict";
import test from "node:test";
import { valueStructProofFiles } from "../../../../tsonic/test/fixtures/value-structs.mjs";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { createRustStructuralShapePlan } from "../../../dist/analysis/objects/structural-shape-plan.js";
import { rustCompileTimeSourceKey } from "../../../dist/target-model/facts/source-declarations.js";
import { rustStructuralObjectCarrierValue, rustStructuralObjectTargetType } from "../../../dist/target-model/types/index.js";
import { substituteRustTargetTypeParameters } from "../../../dist/target-model/types/carriers/substitution.js";
import { writeRustStoredObjectField } from "../../../dist/backend/planner/objects/project-storage.js";

for (const surfaces of [[], ["js"]]) {
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
  const { result } = compileRust({ files: { "index.ts": `
      import { field, struct } from "@tsonic/core/lang.js";
      import type { uint32 } from "@tsonic/core/types.js";
      function value(): uint32 { return 1; }
      const Point = struct({ x: value() });` } });
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "SOURCE_SEMANTICS_STRUCT_FIELD_NOT_PROVEN"));
  assert.equal(result.artifacts.length, 0);
});

test("stored value-field writes require writable sealed field metadata", () => {
  const field = { sourceName: "count", type: { kind: "source-primitive", name: "uint32" }, presence: "required", readonly: false };
  const carrier = rustStructuralObjectTargetType("/value.ts", [field], "value");
  const stored = { targetName: "count", carrier: field.type, storage: "stored", readonly: false };
  const context = selected => ({ input: { program: { structuralShapes: { field: () => selected } } } });
  const write = selected => writeRustStoredObjectField("structural-object", carrier, { kind: "path", path: "value" }, 0,
    "=", { kind: "int-literal", text: "3" }, context(selected));
  assert.deepEqual(write(stored), { kind: "assignment", operator: "=",
    target: { kind: "field", receiver: { kind: "path", path: "value" }, name: "count" },
    value: { kind: "int-literal", text: "3" } });
  assert.equal(write({ ...stored, readonly: true }), undefined);
  assert.equal(write({ ...stored, storage: "property" }), undefined);
  assert.equal(write(undefined), undefined);
});
