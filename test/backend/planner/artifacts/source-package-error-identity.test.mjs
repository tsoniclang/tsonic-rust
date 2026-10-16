import { createRustRecordFixture } from "../../../helpers/records.mjs";
import { assertNoTargetDiagnostics } from "../../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { fakeAstReader } from "../../../helpers/fake-compile-input.mjs";
import { analyzeRustSourcePackageComponents, selectRustSourcePackageComponentIdentities } from "../../../../dist/analysis/program/source-package-components.js";
import { planRustSourcePackageErrors, resolveRustSourcePackageErrorBoundary, resolveRustPhysicalProgramErrorBoundary } from "../../../../dist/backend/planner/program/source-package-errors.js";
import { selectRustPhysicalProgramErrorOwner } from "../../../../dist/analysis/program/error-types.js";
import { planRustProgramErrorModule } from "../../../../dist/backend/planner/program/errors.js";
import { sourcePackageCallbackErrorFiles, sourcePackageCallbackErrorGraph } from "../../../../../tsonic/test/fixtures/source-package-callback-errors.mjs";
import { compileRust } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

import { rustSourceErrorTargetType } from "../../../../dist/target-model/types/carriers/source-error.js";

function classify(dependencies, errors, views = []) {
  const names = Object.keys(dependencies);
  const definitions = errors.map(name => ({ fileName: `/${name}/index.ts`, sourceName: `${name}Failure`, declaration: {} }));
  const context = {
    sourcePackages: {
      rootPackageId: "root",
      packages: names.map(name => ({ id: name, componentId: name, sourceFiles: [`/${name}/index.ts`] })),
      components: names.map(name => ({ id: name, dependencies: dependencies[name] })),
    },
    sourceFiles: names.map(name => ({ fileName: `/${name}/index.ts` })),
    ast: { ...fakeAstReader(), kindName: () => "KindSourceFile" },
    callableValues: { generic: { definitions: [], definitionFor: () => undefined,
      physical: { definitions: () => [], existingSelectionFor: () => undefined } } },
    errorStorageDemands: { nativeConstructors: [], retainedBoundaries: [], storageFor: () => ({ kind: "readonly" }) },
    records: createRustRecordFixture({runtimeCarrier: { get: (node) => views.includes(node.fileName.split("/")[1])
    ? { carrier: rustSourceErrorTargetType() } : undefined }}),
    projectTypes: { programErrorDefinitions: definitions, programErrorVariant: definition => definition.sourceName },
  };
  context.sourcePackageComponentIdentities = selectRustSourcePackageComponentIdentities(
    context.sourcePackages, context.ast, context.sourceFiles,
  );
  const classified = analyzeRustSourcePackageComponents(context, "bin");
  assert.equal(classified.kind, "resolved");
  context.sourcePackageComponents = classified.plan;
  const components = classified.plan.components.map(component => ({
    ...component, sourceFileNames: new Set(component.sourceFileNames),
    crateName: component.root ? undefined : `${component.componentId}_crate`, programModuleName: "program",
  }));
  return { context, components };
}

test("chain and diamond error forwarding preserve one sealed owner and one conversion", () => {
  const { context, components } = classify({ leaf: [], left: ["leaf"], right: ["leaf"], root: ["left", "right"] }, ["leaf"]);
  assert.equal(context.sourcePackageComponents.canReferenceFile("/root/index.ts", "/leaf/index.ts"), true);
  assert.equal(context.sourcePackageComponents.canReferenceFile("/leaf/index.ts", "/root/index.ts"), false);
  assert.equal(context.sourcePackageComponents.canReferenceFile("/left/index.ts", "/right/index.ts"), false);
  assert.equal(context.sourcePackageComponents.canReferenceFile("/foreign/index.ts", "/leaf/index.ts"), false);
  assert.ok(components.every(component => component.errorOwnerComponentId === "leaf"));
  const { plan, diagnostics } = planRustSourcePackageErrors({ program: context }, components);
  assertNoTargetDiagnostics(diagnostics);
  const root = plan.domainsByComponentId.get("root");
  assert.equal(root.externalErrors.length, 1);
  assert.equal(root.forwardModulePath, "left_crate::program");
  const rootBoundary = resolveRustSourcePackageErrorBoundary(plan, "root", "root");
  for (const dependency of ["left", "right"]) {
    assert.equal(resolveRustSourcePackageErrorBoundary(plan, "root", dependency).errorTypeIdentity, rootBoundary.errorTypeIdentity);
  }
  const model = planRustProgramErrorModule({ program: context }, new Map(), root, []);
  assert.equal(model.items.length, 1);
  assert.equal(model.items[0].kind, "use");
  assert.equal(model.items[0].path, "left_crate::program::*");
});

test("local errors and independent dependency domains retain distinct closed unions", () => {
  for (const owners of [["left", "right"], ["left", "root"]]) {
    const { context, components } = classify({ left: [], right: [], root: ["left", "right"] }, owners);
    const root = components.find(component => component.root);
    assert.equal(root.errorOwnerComponentId, "root");
    const result = planRustSourcePackageErrors({ program: context }, components);
    assertNoTargetDiagnostics(result.diagnostics);
    assert.equal(result.plan.domainsByComponentId.get("root").forwardModulePath, undefined);
  }
});

test("physical error normalization and rendering share the actual forwarded component owner, not ambient errors", () => {
  const { context, components } = classify({ leaf: [], left: ["leaf"], right: ["leaf"], root: ["left", "right"] }, ["leaf", "root"]);
  const { plan, diagnostics } = planRustSourcePackageErrors({ program: context }, components);
  assertNoTargetDiagnostics(diagnostics);
  for (const name of ["left", "right", "leaf"]) {
    const physical = selectRustPhysicalProgramErrorOwner(context.sourceFiles.find(file => file.fileName === `/${name}/index.ts`),
      { ast: context.ast, components: context.sourcePackageComponents });
    assert.deepEqual(physical, { kind: "physical", domain: "project", componentId: "leaf" });
    const rendered = resolveRustPhysicalProgramErrorBoundary(plan, "root", physical);
    assert.equal(rendered?.errorTypeIdentity, plan.domainsByComponentId.get("leaf").errorTypeIdentity);
    assert.notEqual(rendered?.errorTypeIdentity, plan.domainsByComponentId.get("root").errorTypeIdentity);
  }
  for (const physical of [{ kind: "logical" }, { kind: "physical", domain: "project", componentId: "left" },
    { kind: "physical", domain: "project", componentId: "foreign" }]) {
    assert.equal(resolveRustPhysicalProgramErrorBoundary(plan, "root", physical) === undefined, true);
  }
  assert.equal(resolveRustPhysicalProgramErrorBoundary(plan, "leaf", { kind: "physical", domain: "project", componentId: "root" }) === undefined, true);
});

test("error ownership mutations reject before any program-error AST is emitted", () => {
  for (const owner of [undefined, "root", "missing"]) {
    const { context, components } = classify({ leaf: [], root: ["leaf"] }, ["leaf"]);
    const mutated = components.map(component => component.root ? { ...component, errorOwnerComponentId: owner } : component);
    const result = planRustSourcePackageErrors({ program: context }, mutated);
    assert.equal(result.plan, undefined);
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_SOURCE_PACKAGE_ERROR_OWNER_CONFLICT"));
  }
});

test("native Error-view declarations have one exact owner and reject absent or malformed sealed demand", () => {
  const { context, components } = classify({ leaf: [], root: ["leaf"] }, [], ["leaf"]);
  assert.equal(components.every(component => component.errorOwnerComponentId === "leaf"), true);
  assert.equal(context.sourcePackageComponents.forComponent("leaf").closedErrorDemand.sourceView, true);
  const accepted = planRustSourcePackageErrors({ program: context }, components);
  assertNoTargetDiagnostics(accepted.diagnostics);
  assert.equal(accepted.plan.domainsByComponentId.get("root").forwardModulePath, "leaf_crate::program");
  for (const replacement of [undefined, { retained: false, thrownCarriers: [] },
    { retained: false, thrownCarriers: [], sourceView: "false" }]) {
    const mutated = { ...context, sourcePackageComponents: {
      ...context.sourcePackageComponents,
      forComponent: identity => identity !== "leaf" ? context.sourcePackageComponents.forComponent(identity)
        : replacement === undefined ? undefined : { closedErrorDemand: replacement },
    } };
    const rejected = planRustSourcePackageErrors({ program: mutated }, components);
    assert.equal(rejected.plan === undefined, true);
    assert.equal(rejected.diagnostics.some(diagnostic => diagnostic.code === "RUST_SOURCE_PACKAGE_ERROR_OWNER_CONFLICT"), true);
  }
  for (const domain of ["runtime", "forwarding"]) {
    const fixture = classify({ leaf: [], root: ["leaf"] }, [], domain === "runtime" ? [] : ["leaf"]);
    const selected = fixture.context.sourcePackageComponents.forComponent("root");
    const mutated = { ...fixture.context, sourcePackageComponents: {
      ...fixture.context.sourcePackageComponents,
      forComponent: identity => identity !== "root" ? fixture.context.sourcePackageComponents.forComponent(identity)
        : { ...selected, closedErrorDemand: { ...selected.closedErrorDemand, sourceView: true } },
    } };
    const rejected = planRustSourcePackageErrors({ program: mutated }, fixture.components);
    assert.equal(rejected.plan === undefined, true, domain);
    assert.equal(rejected.diagnostics.some(diagnostic => diagnostic.code === "RUST_SOURCE_PACKAGE_ERROR_OWNER_CONFLICT"), true, domain);
  }
});

test("retained cross-package callbacks preserve the original thrown object", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    sourcePackages: sourcePackageCallbackErrorGraph,
    target: { id: "rust", options: { outputType: "bin", crateName: "package_callback_errors" } },
    files: { ...sourcePackageCallbackErrorFiles, "index.ts": (`${sourcePackageCallbackErrorFiles["index.ts"]}
export function main(): void { if (!run()) throw new Error("callback identity"); }` + "\nmain();\n") },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  assert.equal(result.artifacts.filter(artifact => artifact.path.endsWith("Cargo.toml")).length, 3);
  assert.equal(validateGeneratedProject("package-callback-errors", result.artifacts, { run: true }).status, 0);
});
