import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustErrorTransport } from "../../../dist/analysis/program/error-transport.js";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustValueConversionContract } from "../../../dist/target-model/conversions/contracts.js";
import { rustJsValueTargetType, rustTsValueTargetType, rustSourceTypeCarrier } from "../../../dist/target-model/types/index.js";
import { rustRuntimeErrorTypeIdentity } from "../../../dist/target-model/operations/error-boundary.js";

function input(thrownCarriers = [rustTsValueTargetType()], retained = true) {
  const root = { componentId: "root", errorDomain: "project", errorOwnerComponentId: "root",
    closedErrorDemand: { thrownCarriers, retained, sourceView: false } };
  const dependency = { componentId: "dependency", errorDomain: "project", errorOwnerComponentId: "dependency",
    closedErrorDemand: { thrownCarriers: [], retained: true, sourceView: false } };
  const forwarding = { componentId: "forwarding", errorDomain: "project", errorOwnerComponentId: "dependency",
    closedErrorDemand: { thrownCarriers: [], retained: false, sourceView: false } };
  const native = { componentId: "native", errorDomain: "runtime", errorOwnerComponentId: undefined,
    closedErrorDemand: { thrownCarriers: [], retained: false, sourceView: false } };
  const components = [root, dependency, forwarding, native];
  for (const component of components) Object.assign(component, {
    sourceFileNames: [`/${component.componentId}.ts`],
    dependencyComponentIds: component === forwarding ? ["dependency"] : [],
    crateName: `${component.componentId}_crate`,
    programModuleName: "program",
  });
  return {
    ast: { getSourceFile: boundary => boundary.file, getFileName: file => file.name },
    projectTypes: { programErrorDefinitions: [], sourceErrorDefinitions: [],
      programErrorVariant: definition => definition.variant, openCarrier: definition => definition.carrier },
    typeDefinitions: emptyRustTypeDefinitions,
    sourcePackageComponents: { components,
      forComponent: id => components.find(component => component.componentId === id),
      componentForFile: file => components.find(component => file === `/${component.componentId}.ts`) },
    sourceModuleConstructions: { entries: () => [] },
    errorStorageDemands: { retainedBoundaries: [], nativeConstructors: [], storageFor: () => ({ kind: "readonly" }) },
  };
}

test("Error transport selects one frozen exact inventory before planning and does not retain mutable demands", () => {
  const fixture = input([rustJsValueTargetType(), rustTsValueTargetType(), rustJsValueTargetType()]);
  const result = analyzeRustErrorTransport(fixture);
  assert.equal(result.kind, "resolved");
  assert.equal(Object.isFrozen(result.value), true);
  const inventory = result.value.forComponent("root");
  assert.deepEqual(inventory.map(variant => variant.name), ["ClosedJs", "ClosedNative", "Retained"]);
  assert.equal(Object.isFrozen(inventory) && inventory.every(Object.isFrozen), true);
  assert.equal(result.value.forComponent("root") === inventory, true);
  for (const variant of inventory.filter(variant => variant.kind === "closed")) {
    assert.equal(Object.isFrozen(variant.admissions) && variant.admissions.every(Object.isFrozen), true);
    const identity = variant.admissions.find(admission => admission.conversion === null);
    assert.equal(identity !== undefined, true);
    assert.deepEqual(identity.target, variant.carrier);
  }
  fixture.sourcePackageComponents.components[0].closedErrorDemand.thrownCarriers.length = 0;
  fixture.sourcePackageComponents.components[0].closedErrorDemand.retained = false;
  assert.deepEqual(inventory.map(variant => variant.name), ["ClosedJs", "ClosedNative", "Retained"]);
  for (const component of ["forwarding", "native", "missing"]) {
    assert.equal(result.value.forComponent(component) === undefined, true, component);
  }
  assert.deepEqual(result.value.forComponent("dependency").map(variant => variant.name), ["Retained"]);
});

test("project payloads retain their exact definitions and finalized infallible native admissions", () => {
  const fixture = input([], false);
  const carrier = rustSourceTypeCarrier("/root.ts", "Failure", "object");
  const definition = { fileName: "/root.ts", variant: "Failure", carrier };
  fixture.projectTypes.programErrorDefinitions.push(definition);
  fixture.projectTypes.sourceErrorDefinitions.push(definition);
  const registry = createRustTypeDefinitionRegistry();
  assert.equal(registry.registerProgramErrorOrigin(carrier,
    { kind: "project", variant: "Failure", sourceError: true }), true);
  fixture.typeDefinitions = registry.seal();
  const result = analyzeRustErrorTransport(fixture);
  assert.equal(result.kind, "resolved");
  const variant = result.value.forComponent("root")[0];
  assert.equal(variant.definition === definition, true);
  assert.equal(variant.carrier === carrier, true);
  assert.equal(variant.sourceError, true);
  assert.equal(variant.admissions.length, 2);
  for (const admission of variant.admissions) {
    const contract = rustValueConversionContract(admission.conversion, fixture.typeDefinitions);
    assert.equal(contract !== undefined && !contract.fallible, true);
    assert.deepEqual(contract.source, carrier);
    assert.deepEqual(contract.target, admission.target);
    assert.equal(contract.lowering, "call");
    assert.equal(contract.path.endsWith("::from_error"), true);
  }
});

test("retained boundary ownership and malformed native inventories reject at analysis, not planning", () => {
  for (const mutate of [
    fixture => { fixture.sourcePackageComponents.components[0].closedErrorDemand.thrownCarriers.push(
      { kind: "target-named", id: "foreign.closed" }); },
    fixture => { fixture.projectTypes.programErrorDefinitions.push({ fileName: "/missing.ts", variant: "Failure" }); },
    fixture => { fixture.projectTypes.programErrorDefinitions.push({ fileName: "/root.ts", variant: undefined }); },
    fixture => { fixture.projectTypes.programErrorDefinitions.push({ fileName: "/root.ts", variant: "Runtime",
      carrier: rustTsValueTargetType() }); },
    fixture => { fixture.projectTypes.programErrorDefinitions.push({ fileName: "/root.ts", variant: "ClosedNative",
      carrier: rustTsValueTargetType() }); },
    fixture => { fixture.errorStorageDemands.retainedBoundaries.push({ file: { name: "/missing.ts" } }); },
    fixture => { fixture.projectTypes.programErrorDefinitions.push({ fileName: "/forwarding.ts", variant: "Foreign" }); },
  ]) {
    const fixture = input();
    mutate(fixture);
    const result = analyzeRustErrorTransport(fixture);
    assert.equal(result.kind, "rejected");
    assert.equal(result.diagnostics.length > 0, true);
    assert.equal(result.diagnostics.every(diagnostic => diagnostic.code === "RUST_ERROR_TRANSPORT_UNRESOLVED"), true);
  }
  const fixture = input([], false);
  fixture.errorStorageDemands.retainedBoundaries.push({ file: { name: "/root.ts" } });
  const result = analyzeRustErrorTransport(fixture);
  assert.equal(result.kind, "resolved");
  assert.deepEqual(result.value.forComponent("root").map(variant => variant.name), ["Retained"]);
});

test("native error boundaries select only local and actual dependency roles before publication", () => {
  const fixture = input();
  fixture.sourcePackageComponents.components[0].dependencyComponentIds = ["dependency", "native"];
  const result = analyzeRustErrorTransport(fixture);
  assert.equal(result.kind, "resolved", "the real local, project dependency and runtime dependency are admitted");
  const plan = result.value;
  const local = plan.componentBoundaryFor("root", "root");
  const dependency = plan.componentBoundaryFor("root", "dependency");
  const runtime = plan.componentBoundaryFor("root", "native");
  assert.equal(local.errorTypePath, "rt::TsonicError", "local spelling remains local");
  assert.equal(dependency.errorTypePath, "dependency_crate::program::TsonicError", "the actual dependency owns its path");
  assert.equal(dependency.errorTypeIdentity, "tsonic-source-package:dependency:TsonicError", "dependency identity is authoritative");
  assert.equal(runtime.errorTypePath, "tsonic_rust_runtime::TsonicError", "the selected runtime dependency uses the runtime path");
  assert.equal(runtime.errorTypeIdentity, rustRuntimeErrorTypeIdentity, "runtime identity is not a project spelling");
  assert.equal(plan.nativeBoundaryFor("root", { kind: "logical" }) === local, true, "logical owner reads the same local entry");
  assert.equal(plan.physicalBoundaryFor("root", { kind: "physical", domain: "project", componentId: "dependency" }) === dependency,
    true, "the physical project owner reads the exact selected dependency entry");
  assert.equal(plan.physicalBoundaryFor("root", { kind: "physical", domain: "runtime" }).errorTypePath,
    "tsonic_rust_runtime::TsonicError", "only the genuine physical runtime role reads the runtime boundary");
  assert.equal(plan.physicalBoundaryFor("native", { kind: "physical", domain: "runtime" }).errorTypePath,
    "rt::TsonicError", "a runtime-local physical role retains the native local alias");
  for (const owner of ["forwarding", "missing"]) {
    assert.equal(plan.componentBoundaryFor("root", owner) === undefined, true, owner);
    assert.equal(plan.physicalBoundaryFor("root", { kind: "physical", domain: "project", componentId: owner }) === undefined,
      true, `${owner}: no missing project dependency becomes a runtime boundary`);
  }
  assert.equal(plan.componentBoundaryFor("dependency", "native") === undefined, true,
    "a globally known runtime component does not create an unselected dependency edge");
  assert.equal(plan.physicalBoundaryFor("missing", { kind: "physical", domain: "runtime" }) === undefined, true,
    "an unknown consumer has no preselected runtime role");
  fixture.sourcePackageComponents.components[0].dependencyComponentIds.length = 0;
  assert.equal(plan.componentBoundaryFor("root", "dependency") === dependency, true, "later mutable graph changes cannot reselect a boundary");
  assert.equal(Object.isFrozen(local) && Object.isFrozen(dependency) && Object.isFrozen(runtime), true,
    "the authoritative entries are frozen before consumers run");
});

test("duplicate or incomplete sparse native error boundary admissions fail before publication", () => {
  for (const [label, mutate, code] of [
    ["component collision", fixture => fixture.sourcePackageComponents.components.push(fixture.sourcePackageComponents.components[0]),
      "RUST_SOURCE_PACKAGE_ERROR_BOUNDARY_CONFLICT"],
    ["dependency collision", fixture => { fixture.sourcePackageComponents.components[0].dependencyComponentIds = ["dependency", "dependency"]; },
      "RUST_SOURCE_PACKAGE_ERROR_BOUNDARY_CONFLICT"],
    ["missing dependency", fixture => { fixture.sourcePackageComponents.components[0].dependencyComponentIds = ["missing"]; },
      "RUST_SOURCE_PACKAGE_ERROR_DEPENDENCY_MISSING"],
  ]) {
    const fixture = input();
    mutate(fixture);
    const result = analyzeRustErrorTransport(fixture);
    assert.equal(result.kind, "rejected", label);
    assert.equal(result.value === undefined, true, `${label}: no native boundary index is published`);
    assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === code), true, `${label}: exact admission diagnostic`);
  }
});
