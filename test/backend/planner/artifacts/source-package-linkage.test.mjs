import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planRustSourcePackageComponents,
} from "../../../../dist/backend/planner/program/source-package-components.js";
import {
  planRustSourcePackageCargo,
} from "../../../../dist/backend/planner/program/source-package-crates.js";
import { printCargoManifest } from "../../../../dist/print/cargo/manifest.js";
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

test("source-package components become one exact generated Cargo workspace", () => {
  const diagnostics = [];
  const plan = planRustSourcePackageCargo({
    packageName: "application",
    edition: "2024",
    outputType: "bin",
    dependencies: [{
      name: "tsonic_rust_runtime",
      path: "/runtime",
      registryPatch: "crates-io",
    }],
    workspace: { members: [] },
  }, [
    component("leaf", [], "acme_leaf"),
    component("domain", ["leaf"], "acme_domain"),
    component("root", ["domain"], undefined, true),
  ], diagnostics);

  assert.deepEqual(diagnostics, []);
  assert.notEqual(plan, undefined);
  assert.deepEqual(plan.rootManifest.workspace.members, [
    "crates/acme_domain",
    "crates/acme_leaf",
  ]);
  assert.deepEqual(plan.rootManifest.dependencies, [{
    name: "acme_domain",
    path: "crates/acme_domain",
  }, {
    name: "tsonic_rust_runtime",
    path: "/runtime",
    registryPatch: "crates-io",
  }]);
  const domain = plan.externalManifestsByComponentId.get("domain");
  assert.equal(domain.directory, "crates/acme_domain");
  assert.deepEqual(domain.manifest, {
    packageName: "acme_domain",
    edition: "2024",
    outputType: "lib",
    dependencies: [{ name: "acme_leaf", path: "../acme_leaf" }, {
      name: "tsonic_rust_runtime",
      path: "/runtime",
    }],
  });
  assert.match(
    printCargoManifest(plan.rootManifest),
    /\[workspace\]\nresolver = "3"\nmembers = \["crates\/acme_domain", "crates\/acme_leaf"\]/u,
  );
  assert.doesNotMatch(printCargoManifest(domain.manifest), /\[workspace\]/u);
});

test("source-package Cargo identities fail closed on target crate collisions", () => {
  const diagnostics = [];
  const plan = planRustSourcePackageCargo({
    packageName: "acme_domain",
    edition: "2024",
    outputType: "lib",
    dependencies: [],
    workspace: { members: [] },
  }, [
    component("domain", [], "acme_domain"),
    component("root", ["domain"], undefined, true),
  ], diagnostics);

  assert.equal(plan, undefined);
  assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.code), [
    "RUST_SOURCE_PACKAGE_CRATE_IDENTITY_CONFLICT",
  ]);

  const duplicateDiagnostics = [];
  const duplicate = planRustSourcePackageCargo({
    packageName: "application",
    edition: "2024",
    outputType: "lib",
    dependencies: [],
    workspace: { members: [] },
  }, [
    component("first", [], "shared_identity"),
    component("second", [], "shared_identity"),
    component("root", ["first", "second"], undefined, true),
  ], duplicateDiagnostics);
  assert.equal(duplicate, undefined);
  assert.deepEqual(duplicateDiagnostics.map((diagnostic) => diagnostic.code), [
    "RUST_SOURCE_PACKAGE_CRATE_IDENTITY_CONFLICT",
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

test("public project classes expose one closed cross-crate storage ABI", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    target: {
      id: "rust",
      options: { outputType: "lib", crateName: "public_class_storage" },
    },
    files: {
      "model.ts": `
import type { int32 } from "@tsonic/core/types.js";

export class Model {
  value: int32;

  constructor(value: int32) {
    this.value = value;
  }

  set(value: int32): void {
    this.value = value;
  }
}

class InternalModel {
  value: int32;

  constructor(value: int32) {
    this.value = value;
  }
}
`,
    },
    entryPoint: "model.ts",
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/model.rs");
  assert.match(source, /#\[doc\(hidden\)\][\s\S]*pub struct ModelState \{\s+pub value: i32,/u);
  assert.match(source, /pub struct Model \{\s+#\[doc\(hidden\)\]\s+pub state: rt::ObjectHandle<ModelState>,/u);
  assert.match(source, /pub\(crate\) struct InternalModelState \{\s+pub\(crate\) value: i32,/u);
  assert.match(source, /pub\(crate\) struct InternalModel \{\s+pub\(crate\) state: rt::ObjectRef<InternalModelState>,/u);
  validateGeneratedProject("public-class-storage-lib", result.artifacts);
});

test("public polymorphic project types expose one closed cross-crate dispatch ABI", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    target: {
      id: "rust",
      options: { outputType: "lib", crateName: "public_dispatch_storage" },
    },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export interface Readable {
  value: int32;
  read(): int32;
}

export class Base {
  value: int32;

  constructor(value: int32) {
    this.value = value;
  }

  read(): int32 {
    return this.value;
  }
}

export class Derived extends Base implements Readable {
  constructor(value: int32) {
    super(value);
  }
}
`,
    },
    entryPoint: "index.ts",
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /#\[doc\(hidden\)\][\s\S]*pub trait ReadableDispatch/u);
  assert.match(source, /pub struct Readable \{\s+#\[doc\(hidden\)\]\s+pub identity: rt::ObjectIdentity,\s+#\[doc\(hidden\)\]\s+pub dispatch:/u);
  assert.match(source, /#\[doc\(hidden\)\][\s\S]*pub struct BaseState \{\s+pub value: i32,/u);
  assert.match(source, /pub struct Base \{\s+#\[doc\(hidden\)\]\s+pub identity: rt::ObjectIdentity,\s+#\[doc\(hidden\)\]\s+pub dispatch:/u);
  validateGeneratedProject("public-dispatch-storage-lib", result.artifacts);
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

function component(componentId, dependencyComponentIds, crateName, root = false) {
  return {
    componentId,
    sourceFileNames: new Set(),
    dependencyComponentIds,
    ...(crateName === undefined ? {} : { crateName }),
    programModuleName: "program",
    structuralShapesModuleName: "shapes",
    publicModuleNames: new Set(),
    publicImplementationItemIdentities: new Set(),
    errorDomain: "runtime",
    root,
  };
}
