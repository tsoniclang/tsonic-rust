import assert from "node:assert/strict";
import test from "node:test";
import { prepareRustProjectGenericMembership } from "../../../../dist/analysis/project-types/generic-membership.js";
import {
  rustRuntimeNativeArrayTargetType, rustRuntimeNativeLayoutTargetType,
  rustRuntimeNativeMethodTargetType, rustRuntimeRecordFieldTargetType,
} from "../../../../dist/target-model/types/carriers/runtime-carriers.js";
import { rustNamedTypeCarrierValue } from "../../../../dist/target-model/types/carriers/native.js";
import { rustTypeFromCarrier } from "../../../../dist/backend/planner/types/carrier-syntax.js";
import { rustStructuralObjectTargetType } from "../../../../dist/target-model/types/carriers/source-types.js";
import { rustCallableTargetType } from "../../../../dist/target-model/types/carriers/callables.js";
import { planRustStructuralShapeModule } from "../../../../dist/backend/planner/objects/structural-shapes.js";
import { planRustNativeMemoryCall } from "../../../../dist/backend/planner/expressions/native-memory.js";
import { rustProgramPlanContext, rustProgramWithTypeEmissions } from "../../../helpers/plan-context.mjs";
import { analyzeRustNativeMemoryEmission } from "../../../../dist/analysis/operations/native-memory-emission.js";
import { createRustNativeLayoutProducer } from "../../../../dist/analysis/program/records/native-layout-emission.js";
import { analyzeRustTypeEmission } from "../../../../dist/analysis/source-evidence/types/emission.js";
import { createRustTypeEmissionProducer } from "../../../../dist/analysis/program/records/type-emission.js";
import { analyzeRustProjectEmission } from "../../../../dist/analysis/project-types/emission.js";
import { createRustProjectEmissionProducer } from "../../../../dist/analysis/program/records/project-emission.js";
import { analyzeRustStructuralEmission } from "../../../../dist/analysis/objects/structural-emission.js";
import { createRustStructuralEmissionProducer } from "../../../../dist/analysis/program/records/structural-emission.js";
import { analyzeRustStructuralLivenessEmission } from "../../../../dist/analysis/reachability/structural-emission.js";
import { createRustNativeLivenessProducer } from "../../../../dist/analysis/program/records/native-liveness.js";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";
import { rustProgramErrorTargetType } from "../../../../dist/target-model/types/carriers/js.js";
import { selectRustPhysicalProgramErrorOwnerForFile } from "../../../../dist/analysis/errors/error-types.js";

test("native runtime type applications preserve exact Rust value/error identities and native AST", () => {
  const value = { kind: "source-primitive", name: "int64" };
  const error = { kind: "source-primitive", name: "uint32" };
  for (const [path, identity, carrier, payloads] of [
    ["rt::RecordField", "rust.runtime.RecordField", rustRuntimeRecordFieldTargetType(value, error), [value, error]],
    ["rt::raw_memory::NativeLayout", "rust.runtime.NativeLayout", rustRuntimeNativeLayoutTargetType(value), [value]],
    ["rt::raw_memory::NativeArray", "rust.runtime.NativeArray", rustRuntimeNativeArrayTargetType(value), [value]],
  ]) {
    const model = rustNamedTypeCarrierValue(carrier);
    for (const [index, payload] of payloads.entries()) assert.equal(model.genericArguments[index].type === payload, true, path);
    assert.deepEqual(rustTypeFromCarrier(carrier), { kind: "named", path, identity,
      genericArguments: payloads.map(type => ({ kind: "type", type: { kind: "primitive", name: type === value ? "i64" : "u32" } })),
    }, path);
  }
  const invalid = { kind: "opaque", id: "unrenderable" };
  for (const carrier of [rustRuntimeRecordFieldTargetType(invalid, error), rustRuntimeRecordFieldTargetType(value, invalid),
    rustRuntimeNativeLayoutTargetType(invalid), rustRuntimeNativeArrayTargetType(invalid)]) {
    assert.equal(rustTypeFromCarrier(carrier) === undefined, true, "unrenderable native argument");
  }
});

test("native method storage preserves parameter/result/error/lifetime identities and exact function-pointer AST", () => {
  const lifetime = { kind: "parameter", identity: "checked:scope", name: "scope" };
  const value = { kind: "source-primitive", name: "int64" };
  const error = { kind: "source-primitive", name: "uint32" };
  const reference = { kind: "reference", referent: value, mutable: true, lifetime };
  const parameters = [reference];
  const carrier = rustRuntimeNativeMethodTargetType(parameters, reference, error);
  assert.equal(carrier.args === parameters, true);
  assert.equal(carrier.args[0].lifetime === lifetime, true);
  const completion = rustNamedTypeCarrierValue(carrier.result);
  assert.equal(completion.genericArguments[0].type === reference, true);
  assert.equal(completion.genericArguments[1].type === error, true);
  const renderedReference = { kind: "reference", referent: { kind: "primitive", name: "i64" }, mutable: true,
    lifetime: { kind: "named", name: "scope" } };
  assert.deepEqual(rustTypeFromCarrier(carrier), { kind: "function-pointer", parameters: [renderedReference], result: {
    kind: "named", path: "Result", identity: "rust.core.Result", genericArguments: [
      { kind: "type", type: renderedReference }, { kind: "type", type: { kind: "primitive", name: "u32" } },
    ],
  } });
  const invalid = { kind: "opaque", id: "unrenderable" };
  for (const native of [rustRuntimeNativeMethodTargetType([invalid], reference, error),
    rustRuntimeNativeMethodTargetType(parameters, invalid, error), rustRuntimeNativeMethodTargetType(parameters, reference, invalid)]) {
    assert.equal(rustTypeFromCarrier(native) === undefined, true, "unrenderable native method component");
  }
});

test("native runtime trait contracts match their existing Rust implementations without assuming payload Copy", () => {
  const value = { kind: "type-parameter", identity: "checked:T", name: "T" };
  const error = { kind: "type-parameter", identity: "checked:E", name: "E" };
  assert.deepEqual(rustNamedTypeCarrierValue(rustRuntimeRecordFieldTargetType(value, error)).traits.implementations, [
    { trait: { kind: "trait-ref", id: "core::clone::Clone", path: "core::clone::Clone", genericArguments: [], associatedConstraints: [] }, requirements: [{ typeArgumentIndex: 0, trait: { kind: "trait-ref", id: "core::clone::Clone", path: "core::clone::Clone", genericArguments: [], associatedConstraints: [] } }] },
    { trait: { kind: "trait-ref", id: "core::default::Default", path: "core::default::Default", genericArguments: [], associatedConstraints: [] }, requirements: [{ typeArgumentIndex: 0, trait: { kind: "trait-ref", id: "core::default::Default", path: "core::default::Default", genericArguments: [], associatedConstraints: [] } }] },
  ]);
  assert.deepEqual(rustNamedTypeCarrierValue(rustRuntimeNativeLayoutTargetType(value)).traits.implementations, [
    { trait: { kind: "trait-ref", id: "core::clone::Clone", path: "core::clone::Clone", genericArguments: [], associatedConstraints: [] }, requirements: [] }, { trait: { kind: "trait-ref", id: "core::marker::Copy", path: "core::marker::Copy", genericArguments: [], associatedConstraints: [] }, requirements: [] },
  ]);
  assert.deepEqual(rustNamedTypeCarrierValue(rustRuntimeNativeArrayTargetType(value)).traits.implementations,
    [{ trait: { kind: "trait-ref", id: "core::clone::Clone", path: "core::clone::Clone", genericArguments: [], associatedConstraints: [] }, requirements: [] }]);
});

test("native memory free-function qualification emits the exact existing Rust call AST", () => {
  const layout = { kind: "scalar", pointeeCarrier: { kind: "source-primitive", name: "uint32" },
    size: 4n, alignment: 4n, width: 64, littleEndian: true, fields: [] };
  const error = { kind: "source-primitive", name: "int64" };
  // The planner renders the pointee and error carriers from their sealed type emission records.
  const base = rustProgramWithTypeEmissions([layout.pointeeCarrier, error]);
  const node = base.sourceFiles[0];
  const projects = createRustProjectEmissionProducer(() => {});
  const input = { ...base, records: { ...base.records,
    optionalStorageTypeArguments: projects.records.optionalStorageTypeArguments,
    nativeBacking: { get: subject => subject === node ? layout : undefined } } };
  const layouts = createRustNativeLayoutProducer(() => {});
  const carriers = analyzeRustNativeMemoryEmission(input, [node], layouts);
  const types = createRustTypeEmissionProducer(() => {});
  analyzeRustTypeEmission(input, [], types, [...carriers, error], projects);
  const context = rustProgramPlanContext({ ...input, records: { ...input.records, ...layouts.records, ...types.records } }, { usedAliases: new Set() });
  const value = { kind: "path", path: "value" };
  for (const method of ["allocate_native_location", "location_to_raw", "reinterpret_raw_location"]) {
    assert.deepEqual(planRustNativeMemoryCall(method, value, layout, context, error), {
      kind: "call", path: `rt::raw_memory::${method}`, genericArguments: [
        { kind: "type", type: { kind: "primitive", name: "u32" } },
        { kind: "type", type: method === "location_to_raw" ? { kind: "infer" } : { kind: "primitive", name: "i64" } },
      ], args: [value, { kind: "associated-call", owner: { kind: "named", path: "rt::raw_memory::NativeLayout", identity: "rust.runtime.NativeLayout",
        genericArguments: [{ kind: "type", type: { kind: "primitive", name: "u32" } }] }, method: "scalar", args: [
        { kind: "int-literal", text: "4usize" }, { kind: "int-literal", text: "4usize" },
        { kind: "int-literal", text: "64u32" }, { kind: "bool-literal", value: true },
      ] }],
    }, method);
  }
});

test("structural storage renders combined native method and bound-field carriers once without changing the module AST", () => {
  const scalar = { kind: "source-primitive", name: "int64" };
  const callable = rustCallableTargetType([scalar], scalar);
  const errorType = { kind: "named", path: "rt::TsonicError", identity: "tsonic-rust-runtime:TsonicError" };
  const valueType = { kind: "primitive", name: "i64" };
  const methodType = { kind: "function-pointer", parameters: [valueType], result: { kind: "named", path: "Result", identity: "rust.core.Result",
    genericArguments: [{ kind: "type", type: valueType }, { kind: "type", type: errorType }] } };
  const bound = type => ({ kind: "named", path: "rt::RecordField", identity: "rust.runtime.RecordField", genericArguments: [
    { kind: "type", type }, { kind: "type", type: errorType },
  ] });
  const base = rustProgramWithTypeEmissions([scalar, callable]);
  const component = rustProgramPlanContext(base).sourcePackageComponentId;
  const errors = base.records.sourcePackageErrors.get();
  assert.equal(errors.domainsByComponentId.get(component).errorDomain, "runtime", "the actual native package owns the runtime error boundary");
  const owner = selectRustPhysicalProgramErrorOwnerForFile(base.source.ast.getFileName(base.sourceFiles[0]), base.sourcePackageComponents);
  assert.equal(owner !== undefined, true, "the bound field retains its actual completed native access-error owner");
  for (const [name, extra, type] of [
    ["bound scalar", { carrier: scalar, storage: "bound", boundStorage: {
      carrier: rustRuntimeRecordFieldTargetType(scalar, rustProgramErrorTargetType(owner)), direct: false,
    } }, bound(valueType)],
    ["native method", { carrier: callable, storage: "stored", method: true,
      methodPlan: { kind: "native-dispatch", implementation: "stored", receiver: "included", carrier: callable, constructions: [] } }, methodType],
    ["bound native method", { carrier: callable, storage: "bound", method: true,
      methodPlan: { kind: "native-dispatch", implementation: "stored", receiver: "included", carrier: callable, constructions: [] } }, bound(methodType)],
  ]) {
    const carrier = rustStructuralObjectTargetType("checked.ts", [], "reference");
    const definition = { carrier, sourceCarriers: [carrier], targetName: "Checked", componentId: component,
      ownerFileName: base.source.ast.getFileName(base.sourceFiles[0]),
      genericParameters: [], genericArguments: [], stateGenericParameters: [], stateGenericArguments: [],
      contextMarker: undefined, contextConstructor: undefined, fields: [{ sourceName: "value", targetName: "value",
        presence: "required", readonly: false, ...extra }] };
    const shapes = { ...base.structuralShapes, definitions: [definition], instances: [definition], unionDefinitions: [],
      definitionForCarrier: selected => rustTargetTypeRefEquals(selected, carrier) ? definition : undefined,
      field: (selected, index) => rustTargetTypeRefEquals(selected, carrier) ? definition.fields[index] : undefined };
    const program = { ...base, structuralShapes: shapes,
      declarationGenericRequirements: { ...base.declarationGenericRequirements,
        contractForCarrier: () => ({ typeParameters: [], associatedTypes: [], optionalStorage: [], projectProjections: [] }) } };
    const projects = createRustProjectEmissionProducer(() => {});
    analyzeRustProjectEmission({ program, nodes: [], producer: projects,
      memberships: prepareRustProjectGenericMembership(program.declarationGenericRequirements) });
    const projected = { ...program, records: { ...program.records, ...projects.records } };
    const structural = createRustStructuralEmissionProducer(() => {});
    const issues = analyzeRustStructuralEmission(projected, [], structural, projects);
    assert.equal(issues.length, 0, name + ": the actual structural owner admits the complete native storage");
    const admitted = { ...projected, records: { ...projected.records, ...structural.records } };
    const types = createRustTypeEmissionProducer(() => {});
    analyzeRustTypeEmission(admitted, [], types, structural.records.structuralShapeEmission.get(definition).fields.map(field => field.carrier), projects);
    const liveness = createRustNativeLivenessProducer(() => {});
    analyzeRustStructuralLivenessEmission(admitted, base.reachability, liveness);
    const input = { program: { ...admitted, records: { ...admitted.records, ...types.records, ...liveness.emission } } };
    const diagnostics = [];
    const module = planRustStructuralShapeModule(input, new Map(), new Map(), new Map(), new Map(), undefined,
      "shapes", component, errors, undefined, new Set(["Checked"]), diagnostics);
    assert.deepEqual(diagnostics, [], name);
    assert.deepEqual(module, { headerComment: "Generated by the Tsonic Rust target. Do not edit.", items: [
      { kind: "use", path: "tsonic_rust_runtime", alias: "rt" },
      { kind: "struct", name: "Checked", visibility: "public", attrs: [], generics: { parameters: [], wherePredicates: [] },
        fields: [{ name: "value", type, visibility: "public" }] },
    ] }, name);
  }
});
