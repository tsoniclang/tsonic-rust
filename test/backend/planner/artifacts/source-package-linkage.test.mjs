import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planRustSourcePackageComponents,
} from "../../../../dist/backend/planner/program/source-package-components.js";
import {
  analyzeRustSourcePackageComponents,
} from "../../../../dist/analysis/program/source-package-components.js";
import {
  planRustSourcePackageCargo,
} from "../../../../dist/backend/planner/program/source-package-crates.js";
import { printCargoManifest } from "../../../../dist/print/project/manifest.js";
import {
  planRustSourcePackageErrors,
  resolveRustProgramErrorRoute,
  resolveRustSourcePackageErrorBoundary,
} from "../../../../dist/backend/planner/program/source-package-errors.js";
import {
  artifactText,
  compileRust,
  repositoryRoot,
  rustRuntimeCratePath,
} from "../../../helpers/rust-session.mjs";
import {
  runCargo,
  validateGeneratedProject,
  writeGeneratedProject,
} from "../../../helpers/cargo-projects.mjs";
import { join, resolve } from "node:path";
test("source-package components are dependency ordered and ignore inactive packages", () => {
  const identities = new Map([
    ["/root/index.ts", sourceIdentity("/root/index.ts", "root")],
    ["/dep/index.ts", sourceIdentity("/dep/index.ts", "dependency", "dependency_crate")],
  ]);
  const result = planRustSourcePackageComponents(planningContext({
    sourcePackageComponents: sourcePackageClassifications("root", [{
      componentId: "dependency",
      sourceFileNames: ["/dep/index.ts"],
      dependencyComponentIds: [],
      publishesImplementationAbi: true,
      errorDomain: "project",
      root: false,
    }, {
      componentId: "root",
      sourceFileNames: ["/root/index.ts"],
      dependencyComponentIds: ["dependency"],
      publishesImplementationAbi: false,
      errorDomain: "project",
      root: true,
    }]),
    projectTypes: {
      programErrorDefinitions: [{ fileName: "/dep/index.ts" }],
    },
    outputType: "bin",
  }), identities, facadePlan("root", ["root", "dependency"]));

  assert.equal(result.kind, "accepted");
  assert.deepEqual(result.components.map((component) => component.componentId), [
    "dependency",
    "root",
  ]);
  assert.deepEqual(result.components[0].dependencyComponentIds, []);
  assert.equal(result.components[0].crateName, "dependency_crate");
  assert.equal(result.components[0].publishesImplementationAbi, true);
  assert.equal(result.components[0].errorDomain, "project");
  assert.deepEqual(result.components[1].dependencyComponentIds, ["dependency"]);
  assert.equal(result.components[1].crateName, undefined);
  assert.equal(result.components[1].publishesImplementationAbi, false);
  assert.equal(result.components[1].errorDomain, "project");
});

test("library roots retain exact facade linkage and component cycles fail closed", () => {
  const rootIdentity = sourceIdentity("/root/index.ts", "root");
  const library = planRustSourcePackageComponents(planningContext({
    sourcePackageComponents: sourcePackageClassifications("root", [{
      componentId: "root",
      sourceFileNames: ["/root/index.ts"],
      dependencyComponentIds: [],
      publishesImplementationAbi: true,
      errorDomain: "runtime",
      root: true,
    }]),
    projectTypes: { programErrorDefinitions: [] },
    outputType: "lib",
  }), new Map([[rootIdentity.fileName, rootIdentity]]), facadePlan("root", ["root"]));
  assert.equal(library.kind, "accepted");
  assert.equal(Object.hasOwn(library.components[0], "targetLinkage"), false);
  assert.equal(library.components[0].publishesImplementationAbi, true);

  const cycle = analyzeRustSourcePackageComponents({
    sourcePackages: {
      rootPackageId: "root-package",
      packages: [{
        id: "root-package",
        componentId: "root",
        sourceFiles: ["/root/index.ts"],
      }, {
        id: "dependency-package",
        componentId: "dependency",
        sourceFiles: ["/dep/index.ts"],
      }],
      components: [{
        id: "root",
        dependencies: ["dependency"],
      }, {
        id: "dependency",
        dependencies: ["root"],
      }],
    },
    sourceFiles: [{ fileName: "/root/index.ts" }, { fileName: "/dep/index.ts" }],
    ast: { getFileName: (sourceFile) => sourceFile.fileName },
    projectTypes: { programErrorDefinitions: [] },
  }, "bin");
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

test("source-package facades expose only authored exports over a hidden library ABI", { timeout: 300_000 }, () => {
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
  assert.match(library, /#\[doc\(hidden\)\]\s+pub mod index;/u);
  assert.match(library, /pub use crate::index::increment;/u);
  assert.doesNotMatch(library, /pub use crate::index::internal_increment;/u);
  assert.match(implementation, /pub fn internal_increment\(value: i32\) -> i32/u);
  assert.match(implementation, /pub fn increment\(value: i32\) -> i32/u);
  assert.doesNotMatch(implementation, /#\[doc\(hidden\)\]/u);
  validateGeneratedProject("exact-source-facade-lib", result.artifacts);
});

test("exported library classes expose one stable externally extensible ABI", { timeout: 300_000 }, () => {
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
  assert.match(source, /#\[doc\(hidden\)\][\s\S]*pub trait ModelDispatch/u);
  assert.match(source, /#\[doc\(hidden\)\][\s\S]*pub struct ModelState \{\s+pub value: i32,/u);
  assert.match(source, /pub struct Model \{\s+#\[doc\(hidden\)\]\s+pub identity: rt::ObjectIdentity,\s+#\[doc\(hidden\)\]\s+pub dispatch:/u);
  assert.match(source, /#\[doc\(hidden\)\]\s+pub fn initialize_state/u);
  assert.match(source, /#\[doc\(hidden\)\][\s\S]*pub struct InternalModelState \{\s+pub value: i32,/u);
  assert.match(source, /pub struct InternalModel \{\s+#\[doc\(hidden\)\]\s+pub state: rt::ObjectRef<InternalModelState>,/u);
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
  assert.match(source, /#\[doc\(hidden\)\]\s+pub fn initialize_state/u);
  validateGeneratedProject("public-dispatch-storage-lib", result.artifacts);
});

test("user-owned Cargo links a separately generated source-package implementation ABI", { timeout: 300_000 }, () => {
  const engineFiles = {
    "index.ts": `export { EngineBase } from "./base.js";`,
    "base.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { normalize } from "./internal/helper.js";

export class EngineBase {
  value: int32;
  #secret: int32;

  constructor(value: int32) {
    this.value = normalize(value);
    this.#secret = normalize(value);
  }

  read(): int32 {
    return this.#secret;
  }
}
`,
    "internal/helper.ts": `
import type { int32 } from "@tsonic/core/types.js";

export const normalize = (value: int32): int32 => value;
`,
  };
  const engine = compileRust({
    files: engineFiles,
    target: { id: "rust", options: { outputType: "lib", crateName: "acme_engine" } },
  }).result;
  assert.deepEqual(engine.diagnostics, []);

  const dependencyRoot = "/src/node_modules/@acme/engine";
  const consumerFiles = {
    "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { EngineBase } from "@acme/engine/index.js";

export class Consumer extends EngineBase {
  constructor(value: int32) {
    super(value);
  }

  doubled(): int32 {
    return this.read() * 2;
  }
}
`,
    "node_modules/@acme/engine/package.json": JSON.stringify({
      name: "@acme/engine",
      type: "module",
      exports: { "./index.js": "./index.ts" },
    }),
    "node_modules/@acme/engine/index.ts": engineFiles["index.ts"],
    "node_modules/@acme/engine/base.ts": engineFiles["base.ts"],
    "node_modules/@acme/engine/internal/helper.ts": engineFiles["internal/helper.ts"],
  };
  const consumer = compileRust({
    files: consumerFiles,
    target: {
      id: "rust",
      options: {
        outputType: "lib",
        crateName: "consumer",
        projectFile: resolve(
          repositoryRoot,
          "test/fixtures/crates/acme_testing/Cargo.toml",
        ),
      },
    },
    sourcePackages: sourcePackageGraph(dependencyRoot),
  }).result;
  assert.deepEqual(consumer.diagnostics, []);
  assert.equal(consumer.artifacts.some((artifact) => artifact.path === "Cargo.toml"), false);
  assert.equal(consumer.artifacts.some((artifact) => artifact.path.startsWith("crates/")), false);

  const engineLibrary = artifactText(engine, "src/lib.rs");
  const engineBase = artifactText(engine, "src/base.rs");
  const engineHelper = artifactText(engine, "src/internal/helper.rs");
  const consumerSource = artifactText(consumer, "src/index.rs");
  assert.match(engineLibrary, /#\[doc\(hidden\)\]\s+pub mod internal;/u);
  assert.match(engineBase, /#\[doc\(hidden\)\]\s+pub fn initialize_state/u);
  assert.match(engineBase, /crate::internal::helper::normalize/u);
  assert.match(engineBase, /\n\s+secret: i32,/u);
  assert.doesNotMatch(engineBase, /\n\s+pub secret: i32,/u);
  assert.match(engineHelper, /pub fn normalize\(value: i32\) -> i32/u);
  assert.match(consumerSource, /acme_engine::EngineBase::initialize_state/u);

  const combined = writeGeneratedProject("source-package-user-cargo-abi", [
    ...engine.artifacts.map((artifact) => ({
      ...artifact,
      path: `engine/${artifact.path}`,
    })),
    ...consumer.artifacts.map((artifact) => ({
      ...artifact,
      path: `consumer/${artifact.path}`,
    })),
    {
      path: "consumer/Cargo.toml",
      text: `[package]\nname = "consumer"\nversion = "0.0.0"\nedition = "2024"\n\n[lib]\npath = "src/lib.rs"\n\n[dependencies]\nacme_engine = { path = "../engine" }\ntsonic_rust_runtime = { path = ${JSON.stringify(rustRuntimeCratePath)} }\n`,
    },
  ]);
  const consumerRoot = join(combined, "consumer");
  runCargo(consumerRoot, ["generate-lockfile", "--offline"]);
  runCargo(consumerRoot, ["fmt", "--all", "--check"]);
  runCargo(consumerRoot, ["check", "--all-targets", "--locked", "--offline"]);
});

test("cross-package error planning preserves each component-owned Result ABI", () => {
  const engineError = {
    fileName: "/dep/errors.ts",
    sourceName: "EngineFailure",
    declaration: {},
  };
  const components = [{
    componentId: "dependency",
    sourceFileNames: new Set(["/dep/errors.ts"]),
    dependencyComponentIds: [],
    crateName: "engine_crate",
    programModuleName: "program",
    errorDomain: "project",
  }, {
    componentId: "root",
    sourceFileNames: new Set(["/root/index.ts"]),
    dependencyComponentIds: ["dependency"],
    programModuleName: "program",
    errorDomain: "project",
  }];
  const result = planRustSourcePackageErrors(planningContext({
    projectTypes: {
      programErrorDefinitions: [engineError],
      programErrorVariant: (definition) =>
        definition === engineError ? "EngineFailure" : undefined,
    },
  }), components);

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
  const result = planRustSourcePackageErrors(planningContext({
    projectTypes: {
      programErrorDefinitions: [missingError],
      programErrorVariant: () => "MissingFailure",
    },
  }), [{
    componentId: "root",
    sourceFileNames: new Set(["/root/index.ts"]),
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

function planningContext({
  sourcePackageComponents = sourcePackageClassifications("root", []),
  projectTypes,
  outputType = "bin",
}) {
  return {
    program: {
      configuration: { outputType },
      projectTypes,
      sourcePackageComponents,
      sourceModuleConstructions: emptySourceModuleConstructions(),
    },
  };
}

function emptySourceModuleConstructions() {
  return Object.freeze({
    construction: () => undefined,
    entries: () => Object.freeze([]),
    from: () => Object.freeze([]),
    targets: () => Object.freeze([]),
    bootstraps: () => Object.freeze([]),
  });
}

function sourcePackageClassifications(rootComponentId, components) {
  const frozen = Object.freeze(components.map((entry) => Object.freeze({ ...entry })));
  const byId = new Map(frozen.map((entry) => [entry.componentId, entry]));
  const byFile = new Map(frozen.flatMap((entry) =>
    entry.sourceFileNames.map((fileName) => [fileName, entry])));
  return Object.freeze({
    rootComponentId,
    components: frozen,
    forComponent: (componentId) => byId.get(componentId),
    componentForFile: (fileName) => byFile.get(fileName),
  });
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
    publishesImplementationAbi: !root,
    errorDomain: "runtime",
    root,
  };
}

function sourcePackageGraph(dependencyRoot) {
  const rootPackageId = "source-package:.";
  const dependencyPackageId = "source-package:node_modules/@acme/engine";
  const rootComponentId = "source-package-component:consumer";
  const dependencyComponentId = "source-package-component:engine";
  return Object.freeze({
    fingerprint: "source-package-user-cargo-abi",
    rootPackageId,
    packages: Object.freeze([Object.freeze({
      id: rootPackageId,
      name: "consumer",
      packageRoot: "/src",
      sourceRoot: "/src",
      sourceFiles: Object.freeze(["/src/index.ts"]),
      dependencies: Object.freeze([dependencyPackageId]),
      exports: Object.freeze([{ specifier: ".", sourceFile: "/src/index.ts" }]),
      componentId: rootComponentId,
    }), Object.freeze({
      id: dependencyPackageId,
      name: "@acme/engine",
      packageRoot: dependencyRoot,
      sourceRoot: dependencyRoot,
      sourceFiles: Object.freeze([
        `${dependencyRoot}/index.ts`,
        `${dependencyRoot}/base.ts`,
        `${dependencyRoot}/internal/helper.ts`,
      ]),
      dependencies: Object.freeze([]),
      exports: Object.freeze([{
        specifier: "./index.js",
        sourceFile: `${dependencyRoot}/index.ts`,
      }]),
      componentId: dependencyComponentId,
    })]),
    components: Object.freeze([Object.freeze({
      id: dependencyComponentId,
      packages: Object.freeze([dependencyPackageId]),
      dependencies: Object.freeze([]),
    }), Object.freeze({
      id: rootComponentId,
      packages: Object.freeze([rootPackageId]),
      dependencies: Object.freeze([dependencyComponentId]),
    })]),
  });
}
