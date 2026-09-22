import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustSourcePackageComponents } from "../../../../dist/analysis/program/source-package-components.js";
import { planRustSourcePackageErrors, resolveRustSourcePackageErrorBoundary } from "../../../../dist/backend/planner/program/source-package-errors.js";
import { planRustProgramErrorModule } from "../../../../dist/backend/planner/program/errors.js";
import { sourcePackageCallbackErrorFiles, sourcePackageCallbackErrorGraph } from "../../../../../tsonic/test/fixtures/source-package-callback-errors.mjs";
import { compileRust } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

function classify(dependencies, errors) {
  const names = Object.keys(dependencies);
  const definitions = errors.map(name => ({ fileName: `/${name}/index.ts`, sourceName: `${name}Failure`, declaration: {} }));
  const context = {
    sourcePackages: {
      rootPackageId: "root",
      packages: names.map(name => ({ id: name, componentId: name, sourceFiles: [`/${name}/index.ts`] })),
      components: names.map(name => ({ id: name, dependencies: dependencies[name] })),
    },
    sourceFiles: names.map(name => ({ fileName: `/${name}/index.ts` })),
    ast: { getFileName: source => source.fileName, forEachChild() {} },
    callableValues: { generic: { definitions: [], definitionFor: () => undefined } },
    facts: { getFact: () => undefined },
    projectTypes: { programErrorDefinitions: definitions, programErrorVariant: definition => definition.sourceName },
  };
  const classified = analyzeRustSourcePackageComponents(context, "bin");
  assert.equal(classified.kind, "resolved");
  const components = classified.plan.components.map(component => ({
    ...component, sourceFileNames: new Set(component.sourceFileNames),
    crateName: component.root ? undefined : `${component.componentId}_crate`, programModuleName: "program",
  }));
  return { context, components };
}

test("chain and diamond error forwarding preserve one sealed owner and one conversion", () => {
  const { context, components } = classify({ leaf: [], left: ["leaf"], right: ["leaf"], root: ["left", "right"] }, ["leaf"]);
  assert.ok(components.every(component => component.errorOwnerComponentId === "leaf"));
  const { plan, diagnostics } = planRustSourcePackageErrors({ program: context }, components);
  assert.deepEqual(diagnostics, []);
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
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.plan.domainsByComponentId.get("root").forwardModulePath, undefined);
  }
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

test("retained cross-package callbacks preserve the original thrown object", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    sourcePackages: sourcePackageCallbackErrorGraph,
    target: { id: "rust", options: { outputType: "bin", crateName: "package_callback_errors" } },
    files: { ...sourcePackageCallbackErrorFiles, "index.ts": `${sourcePackageCallbackErrorFiles["index.ts"]}
export function main(): void { if (!run()) throw new Error("callback identity"); }` },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.artifacts.filter(artifact => artifact.path.endsWith("Cargo.toml")).length, 3);
  assert.equal(validateGeneratedProject("package-callback-errors", result.artifacts, { run: true }).status, 0);
});
