import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planRustSourcePackageComponents,
} from "../../../../dist/backend/planner/program/source-package-components.js";
import {
  planRustSourcePackageErrors,
  resolveRustProgramErrorRoute,
  resolveRustSourcePackageErrorBoundary,
} from "../../../../dist/backend/planner/program/source-package-errors.js";
import {
  artifactText,
  compileRust,
} from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";
test("source-package components are dependency ordered and ignore inactive packages", () => {
  const identities = new Map([
    ["/root/index.ts", sourceIdentity("/root/index.ts", "root")],
    ["/dep/index.ts", sourceIdentity("/dep/index.ts", "dependency", "dependency_crate")],
  ]);
  const result = planRustSourcePackageComponents({
    target: { id: "rust", options: { outputType: "bin" } },
    sourcePackages: {
      components: [
        { id: "root", packages: ["root-package"], dependencies: ["dependency", "inactive"] },
        { id: "dependency", packages: ["dependency-package"], dependencies: [] },
        { id: "inactive", packages: ["inactive-package"], dependencies: [] },
      ],
    },
    projectTypes: {
      programErrorDefinitions: [{ fileName: "/dep/index.ts" }],
    },
  }, identities, facadePlan("root", ["root", "dependency"]));

  assert.equal(result.kind, "accepted");
  assert.deepEqual(result.components.map((component) => component.componentId), [
    "dependency",
    "root",
  ]);
  assert.deepEqual(result.components[0].dependencyComponentIds, []);
  assert.equal(result.components[0].crateName, "dependency_crate");
  assert.equal(result.components[0].errorDomain, "project");
  assert.deepEqual(result.components[1].dependencyComponentIds, ["dependency"]);
  assert.equal(result.components[1].crateName, undefined);
  assert.equal(result.components[1].errorDomain, "project");
});

test("library roots retain exact facade linkage and component cycles fail closed", () => {
  const rootIdentity = sourceIdentity("/root/index.ts", "root");
  const library = planRustSourcePackageComponents({
    target: { id: "rust", options: { outputType: "lib" } },
    sourcePackages: {
      components: [{ id: "root", packages: ["root-package"], dependencies: [] }],
    },
    projectTypes: { programErrorDefinitions: [] },
  }, new Map([[rootIdentity.fileName, rootIdentity]]), facadePlan("root", ["root"]));
  assert.equal(library.kind, "accepted");
  assert.equal(Object.hasOwn(library.components[0], "targetLinkage"), false);

  const dependencyIdentity = sourceIdentity(
    "/dep/index.ts",
    "dependency",
    "dependency_crate",
  );
  const cycle = planRustSourcePackageComponents({
    target: { id: "rust", options: { outputType: "bin" } },
    sourcePackages: {
      components: [
        { id: "root", packages: ["root-package"], dependencies: ["dependency"] },
        { id: "dependency", packages: ["dependency-package"], dependencies: ["root"] },
      ],
    },
    projectTypes: { programErrorDefinitions: [] },
  }, new Map([
    [rootIdentity.fileName, rootIdentity],
    [dependencyIdentity.fileName, dependencyIdentity],
  ]), facadePlan("root", ["root", "dependency"]));
  assert.equal(cycle.kind, "rejected");
  assert.deepEqual(cycle.diagnostics.map((diagnostic) => diagnostic.code), [
    "RUST_SOURCE_PACKAGE_COMPONENT_GRAPH_CYCLE",
  ]);
});

test("source-package facades expose only exact authored exports", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    target: {
      id: "rust",
      options: { outputType: "lib", crateName: "exact_source_facade" },
    },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

function internalIncrement(value: int32): int32 {
  return value + 1;
}

export function increment(value: int32): int32 {
  return internalIncrement(value);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const library = artifactText(result, "src/lib.rs");
  const implementation = artifactText(result, "src/index.rs");
  assert.match(library, /pub\(crate\) mod index;/u);
  assert.match(library, /pub use crate::index::increment;/u);
  assert.match(implementation, /fn internal_increment\(value: i32\) -> i32/u);
  assert.doesNotMatch(implementation, /pub fn internal_increment/u);
  assert.match(implementation, /pub fn increment\(value: i32\) -> i32/u);
  assert.doesNotMatch(implementation, /#\[doc\(hidden\)\]/u);
  validateGeneratedProject("exact-source-facade-lib", result.artifacts);
});

test("cross-package error planning preserves each component-owned Result ABI", () => {
  const engineError = {
    fileName: "/dep/errors.ts",
    sourceName: "EngineFailure",
    declaration: {},
  };
  const components = [{
    componentId: "dependency",
    dependencyComponentIds: [],
    crateName: "engine_crate",
    programModuleName: "program",
    errorDomain: "project",
  }, {
    componentId: "root",
    dependencyComponentIds: ["dependency"],
    programModuleName: "program",
    errorDomain: "project",
  }];
  const result = planRustSourcePackageErrors({
    projectTypes: {
      programErrorDefinitions: [engineError],
      programErrorVariant: (definition) =>
        definition === engineError ? "EngineFailure" : undefined,
    },
  }, new Map([
    ["/root/index.ts", sourceIdentity("/root/index.ts", "root")],
    ["/dep/errors.ts", sourceIdentity("/dep/errors.ts", "dependency", "engine_crate")],
  ]), components);

  assert.deepEqual(result.diagnostics, []);
  assert.notEqual(result.plan, undefined);
  assert.deepEqual(
    resolveRustSourcePackageErrorBoundary(result.plan, "root", "dependency"),
    {
      componentId: "dependency",
      errorDomain: "project",
      errorTypePath: "engine_crate::program::TsonicError",
      errorTypeIdentity: "tsonic-source-package:dependency:TsonicError",
    },
  );
  assert.deepEqual(
    resolveRustSourcePackageErrorBoundary(result.plan, "root", "root"),
    {
      componentId: "root",
      errorDomain: "project",
      errorTypePath: "rt::TsonicError",
      errorTypeIdentity: "tsonic-source-package:root:TsonicError",
    },
  );
  assert.deepEqual(
    resolveRustProgramErrorRoute(result.plan, "dependency", engineError, "EngineFailure"),
    { kind: "local", variant: "EngineFailure" },
  );
  assert.deepEqual(
    resolveRustProgramErrorRoute(result.plan, "root", engineError, "EngineFailure"),
    {
      kind: "external",
      consumerVariant: "EngineCrateError",
      ownerTypePath: "engine_crate::program::TsonicError",
      ownerVariant: "EngineFailure",
    },
  );
  assert.equal(
    resolveRustSourcePackageErrorBoundary(result.plan, "dependency", "root"),
    undefined,
  );
});

test("source-package error planning rejects unowned project errors", () => {
  const missingError = {
    fileName: "/missing/errors.ts",
    sourceName: "MissingFailure",
    declaration: {},
  };
  const result = planRustSourcePackageErrors({
    projectTypes: {
      programErrorDefinitions: [missingError],
      programErrorVariant: () => "MissingFailure",
    },
  }, new Map([
    ["/root/index.ts", sourceIdentity("/root/index.ts", "root")],
  ]), [{
    componentId: "root",
    dependencyComponentIds: [],
    programModuleName: "program",
    errorDomain: "project",
  }]);

  assert.equal(result.plan, undefined);
  assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), [
    "RUST_PROJECT_ERROR_SOURCE_PACKAGE_MISSING",
  ]);
});

function sourceIdentity(fileName, componentId, externalCrateName) {
  return {
    fileName,
    relativeSourcePath: "index.ts",
    moduleSegments: ["index"],
    moduleName: "index",
    artifactPath: "src/index.rs",
    childModuleNames: [],
    packageId: `${componentId}-package`,
    componentId,
    ...(externalCrateName === undefined ? {} : { externalCrateName }),
  };
}

function facadePlan(rootComponentId, componentIds) {
  return {
    rootComponentId,
    rootExports: [],
    externalItemPathByIdentity: new Map(),
    publicTopLevelModules: new Set(),
    publicModuleNames: new Set(),
    publicImplementationItemIdentities: new Set(),
    publicModuleNamesByComponent: new Map(componentIds.map((componentId) =>
      [componentId, new Set()])),
    publicImplementationItemIdentitiesByComponent: new Map(componentIds.map((componentId) =>
      [componentId, new Set()])),
  };
}
