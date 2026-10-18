import { createRustRecordFixture } from "../../helpers/records.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  artifactText,
  compileRust,
} from "../../helpers/rust-session.mjs";
import {
  analyzeRustSourceOutputIdentities,
} from "../../../dist/analysis/names/source-output-identities.js";
import { selectRustSourcePackageComponentIdentities } from "../../../dist/analysis/program/source-package-components.js";
import { rustSourceArtifactPath } from "../../../dist/backend/planner/names/source-output-identities.js";
import {
  rustModuleNameForSourcePath,
} from "../../../dist/target-model/names/source-output-identities.js";
import {
  analyzeRustSourcePackageFacades,
} from "../../../dist/analysis/program/source-package-facades.js";
import {
  fakeAstReader,
  fakeSourcePackageGraph,
  fakeSourceFile,
} from "../../helpers/fake-compile-input.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

function analyzeIdentityFixture(input) {
  const selected = selectRustSourcePackageComponentIdentities(input.sourcePackages, input.ast, input.sourceFiles);
  assert.equal(selected.kind, "resolved", "the fixture supplies the canonical admitted component order");
  return analyzeRustSourceOutputIdentities({ ...input, componentOrder: selected.identities.componentOrder });
}

function nativeCrateIdentityFixture(dependencies) {
  const root = fakeSourceFile({ fileName: "/project/root/index.ts" });
  const dependencyFiles = dependencies.map((dependency, index) =>
    fakeSourceFile({ fileName: `/project/dependency${index}/index.ts` }));
  const sourceFiles = [root, ...dependencyFiles];
  const packages = [{ id: "package:root", name: "root", packageRoot: "/project/root", sourceRoot: "/project/root",
    sourceFiles: [root.fileName], dependencies: dependencies.map((dependency, index) => `package:${index}`),
    exports: [], componentId: "component:root" }, ...dependencies.map((dependency, index) => ({
      id: `package:${index}`, name: dependency.name, packageRoot: `/project/dependency${index}`,
      sourceRoot: `/project/dependency${index}`, sourceFiles: [dependencyFiles[index].fileName],
      dependencies: [], exports: [], componentId: dependency.componentId,
    }))];
  const sourcePackages = { fingerprint: "fixture-native-crate-identities", rootPackageId: "package:root", packages,
    components: [{ id: "component:root", packages: ["package:root"], dependencies: dependencies.map(dependency => dependency.componentId) },
      ...dependencies.map((dependency, index) => ({ id: dependency.componentId, packages: [`package:${index}`], dependencies: [] }))] };
  return { ast: fakeAstReader(sourceFiles), sourceFiles, sourcePackages,
    configuration: { crateName: "application", project: { kind: "generated" } }, runtimeDependencies: [] };
}

test("generated Cargo crate collisions are rejected by the exact source identity owner before publication", () => {
  for (const conflict of ["root", "runtime"]) {
    const input = nativeCrateIdentityFixture([{ name: "native_dependency", componentId: "component:dependency" }]);
    if (conflict === "root") input.configuration.crateName = "native_dependency";
    else input.runtimeDependencies = [{ name: "native_dependency", path: "/actual/runtime-dependency" }];
    const result = analyzeIdentityFixture(input);
    assert.equal(result.kind, "rejected", `${conflict}: the native collision never reaches publication`);
    assert.deepEqual(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.message, diagnostic.evidence]), [[
      "RUST_SOURCE_PACKAGE_CRATE_IDENTITY_CONFLICT",
      "Generated source-package component 'component:dependency' has conflicting Rust crate identity 'native_dependency'.",
      ["target.capability=rust.backend.source-package-crates"],
    ]], `${conflict}: the existing diagnostic and native predicate are preserved`);
    assert.equal(Object.hasOwn(result, "identities"), false, `${conflict}: no partial identity plan is published`);
  }
});

test("a generated crate-name suffix collision is rejected instead of sharing two native component identities", () => {
  const input = nativeCrateIdentityFixture([
    { name: "shared", componentId: "component:11111111aaaa" },
    { name: "shared", componentId: "component:11111111bbbb" },
  ]);
  const result = analyzeIdentityFixture(input);
  assert.equal(result.kind, "rejected", "the two exact component identities remain distinct");
  assert.deepEqual(result.diagnostics.map(diagnostic => [diagnostic.code, diagnostic.message]), [[
    "RUST_SOURCE_PACKAGE_CRATE_IDENTITY_CONFLICT",
    "Source-package components 'component:11111111aaaa' and 'component:11111111bbbb' share Rust crate identity 'shared_11111111'.",
  ]], "the existing duplicate-name diagnostic retains both original component identities");
});

test("native crate admission uses active selected aliases and preserves user-owned project semantics", () => {
  const input = nativeCrateIdentityFixture([{ name: "native_dependency", componentId: "component:dependency" }]);
  input.runtimeDependencies = [{ name: "selected_alias", path: "/native_dependency" }];
  const valid = analyzeIdentityFixture(input);
  assert.equal(valid.kind, "accepted", "a different actual native alias does not conflict by path spelling");
  assert.equal(valid.identities.get("/project/dependency0/index.ts").externalCrateName, "native_dependency",
    "the exact selected generated crate identity is retained");
  input.configuration.crateName = "native_dependency";
  input.sourceFiles = input.sourceFiles.slice(0, 1);
  input.ast = fakeAstReader(input.sourceFiles);
  const inactive = analyzeIdentityFixture(input);
  assert.equal(inactive.kind, "accepted", "an inactive package never becomes a generated Cargo dependency");
  const userOwned = nativeCrateIdentityFixture([{ name: "native_dependency", componentId: "component:dependency" }]);
  userOwned.configuration = { crateName: "native_dependency", project: { kind: "user-owned", manifestPath: "/native/Cargo.toml" } };
  assert.equal(analyzeIdentityFixture(userOwned).kind, "accepted",
    "this generated-Cargo validation does not invent policy for a user-owned native project");
});

test("source module identities encode the complete project-relative path", () => {
  assert.equal(rustModuleNameForSourcePath("models.ts"), "models");
  assert.equal(rustModuleNameForSourcePath("docs/models.ts"), "docs::models");
  assert.equal(rustModuleNameForSourcePath("resources/models.ts"), "resources::models");
  assert.equal(rustModuleNameForSourcePath("source_name.ts"), "source_name");
  assert.equal(rustModuleNameForSourcePath("source-name.ts"), "source_name");
  assert.equal(rustModuleNameForSourcePath("main.ts"), "main_module");
  assert.equal(rustModuleNameForSourcePath("lib.ts"), "lib_module");
  assert.equal(rustModuleNameForSourcePath("missing-extension"), undefined);
});

test("only library roots publish the authored Promise adapter facade", { timeout: 300_000 }, () => {
  for (const outputType of ["bin", "lib"]) {
    const { result } = compileRust({
      surfaces: ["js"],
      target: { id: "rust", options: { outputType, crateName: "promise_facade" } },
      files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
export async function value(): Promise<int32> { return 7; }
if (await value() !== 7) throw new Error("native body result");
` },
    });
    assert.equal(result.diagnostics.length, 0, `${outputType}: admitted exported async declaration`);
    const root = artifactText(result, "src/lib.rs");
    assert.equal(root.includes("pub use crate::index::value;"), outputType === "lib",
      `${outputType}: exactly the selected outward library contract`);
    const execution = validateGeneratedProject(`promise-facade-${outputType}`, result.artifacts,
      { run: outputType === "bin" });
    assert.equal(outputType === "bin" ? execution.status : execution, outputType === "bin" ? 0 : undefined,
      `${outputType}: complete native facade and initialization build`);
  }
});

test("same basenames in distinct source directories emit distinct linked modules", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { value as docsValue } from "./docs/models.js";
import { value as resourcesValue } from "./resources/models.js";

export function total(): int32 {
  return docsValue() + resourcesValue();
}
`,
      "docs/models.ts": `
import type { int32 } from "@tsonic/core/types.js";
export function value(): int32 { return 20; }
`,
      "resources/models.ts": `
import type { int32 } from "@tsonic/core/types.js";
export function value(): int32 { return 22; }
`,
    },
  });

  assert.equal(result.diagnostics.length === 0, true, "native source-module admission has no diagnostics");
  const docsModule = rustModuleNameForSourcePath("docs/models.ts");
  const resourcesModule = rustModuleNameForSourcePath("resources/models.ts");
  assert.notEqual(docsModule, undefined);
  assert.notEqual(resourcesModule, undefined);
  assert.deepEqual(result.artifacts.map((artifact) => artifact.path), [
    "Cargo.toml",
    "src/lib.rs",
    "src/docs.rs",
    "src/docs/models.rs",
    "src/index.rs",
    "src/resources.rs",
    "src/resources/models.rs",
  ]);
  assert.match(
    artifactText(result, "src/index.rs"),
    new RegExp(`crate::${docsModule}::value\\(\\)\\s*\\+\\s*crate::${resourcesModule}::value\\(\\)`, "u"),
  );
});

test("source path collisions receive local readable suffixes without hash names", () => {
  const first = fakeSourceFile({ fileName: "/project/source_name.ts" });
  const second = fakeSourceFile({ fileName: "/project/source-name.ts" });
  const plan = analyzeIdentityFixture({
    ast: fakeAstReader([first, second]),
    sourceFiles: [first, second],
    sourcePackages: fakeSourcePackageGraph([first, second], {
      packageRoot: "/project",
      sourceRoot: "/project",
    }),
    configuration: { crateName: "fixture_root", project: { kind: "generated" } },
    runtimeDependencies: [],
  });

  assert.equal(plan.kind, "accepted");
  assert.equal(plan.identities.get("/project/source_name.ts")?.moduleName, "source_name");
  assert.equal(plan.identities.get("/project/source-name.ts")?.moduleName, "source_name_2");
  for (const identity of plan.identities.values()) {
    assert.equal(Object.hasOwn(identity, "artifactPath"), false, "analysis publishes semantic module identity only");
    assert.equal(rustSourceArtifactPath(identity), `src/${identity.moduleSegments.join("/")}.rs`,
      "physical path rendering consumes the identical selected module segments");
  }
  assert.doesNotMatch(
    [...plan.identities.values()].map(rustSourceArtifactPath).join("\n"),
    /[0-9a-f]{64}/u,
  );
});

test("source path allocation reserves sibling bases before assigning collision suffixes", () => {
  const files = [
    fakeSourceFile({ fileName: "/project/foo-bar.ts" }),
    fakeSourceFile({ fileName: "/project/foo_bar.ts" }),
    fakeSourceFile({ fileName: "/project/foo_bar_2.ts" }),
  ];
  const plan = analyzeIdentityFixture({
    ast: fakeAstReader(files),
    sourceFiles: files,
    sourcePackages: fakeSourcePackageGraph(files, {
      packageRoot: "/project",
      sourceRoot: "/project",
    }),
    configuration: { crateName: "fixture_root", project: { kind: "generated" } },
    runtimeDependencies: [],
  });

  assert.equal(plan.kind, "accepted");
  assert.equal(plan.identities.get("/project/foo_bar.ts")?.moduleName, "foo_bar");
  assert.equal(plan.identities.get("/project/foo_bar_2.ts")?.moduleName, "foo_bar_2");
  assert.equal(plan.identities.get("/project/foo-bar.ts")?.moduleName, "foo_bar_3");
});

test("identical source paths in distinct package components remain distinct", () => {
  const root = fakeSourceFile({ fileName: "/project/src/index.ts" });
  const dependency = fakeSourceFile({ fileName: "/project/node_modules/dependency/src/index.ts" });
  const rootPackageId = "fixture:root";
  const dependencyPackageId = "fixture:dependency";
  const rootComponentId = "fixture:root-component";
  const dependencyComponentId = "fixture:dependency-component";
  const sourcePackages = {
    fingerprint: "fixture-distinct-components",
    rootPackageId,
    packages: [
      {
        id: rootPackageId,
        name: "root",
        packageRoot: "/project",
        sourceRoot: "/project/src",
        sourceFiles: [root.fileName],
        dependencies: [dependencyPackageId],
        exports: [],
        componentId: rootComponentId,
      },
      {
        id: dependencyPackageId,
        name: "dependency",
        packageRoot: "/project/node_modules/dependency",
        sourceRoot: "/project/node_modules/dependency/src",
        sourceFiles: [dependency.fileName],
        dependencies: [],
        exports: [],
        componentId: dependencyComponentId,
      },
    ],
    components: [
      { id: rootComponentId, packages: [rootPackageId], dependencies: [dependencyComponentId] },
      { id: dependencyComponentId, packages: [dependencyPackageId], dependencies: [] },
    ],
  };
  const plan = analyzeIdentityFixture({
    ast: fakeAstReader([root, dependency]),
    sourceFiles: [root, dependency],
    sourcePackages,
    configuration: { crateName: "fixture_root", project: { kind: "generated" } },
    runtimeDependencies: [],
  });

  assert.equal(plan.kind, "accepted");
  assert.equal(plan.identities.get(root.fileName)?.moduleName, "index");
  assert.equal(plan.identities.get(dependency.fileName)?.moduleName, "index");
  assert.equal(plan.identities.get(root.fileName)?.componentId, rootComponentId);
  assert.equal(plan.identities.get(dependency.fileName)?.componentId, dependencyComponentId);
});

test("facade planning ignores valid package exports outside the checked closure", () => {
  const root = fakeSourceFile({ fileName: "/project/src/index.ts" });
  const packageId = "fixture:root";
  const componentId = "fixture:component";
  const sourcePackages = {
    fingerprint: "fixture-unused-export",
    rootPackageId: packageId,
    packages: [{
      id: packageId,
      name: "root",
      packageRoot: "/project",
      sourceRoot: "/project/src",
      sourceFiles: [root.fileName, "/project/src/testing.ts"],
      dependencies: [],
      exports: [
        { specifier: ".", sourceFile: root.fileName },
        { specifier: "./testing.js", sourceFile: "/project/src/testing.ts" },
      ],
      componentId,
    }],
    components: [{ id: componentId, packages: [packageId], dependencies: [] }],
  };
  const ast = fakeAstReader([root]);
  const identities = analyzeIdentityFixture({ ast, sourceFiles: [root], sourcePackages,
    configuration: { crateName: "fixture_root", project: { kind: "generated" } }, runtimeDependencies: [] });
  assert.equal(identities.kind, "accepted", "the exact facade fixture supplies its checked native identities");
  const result = analyzeRustSourcePackageFacades({
    rootPublishesLibrary: true,
    nativeNodes: [],
    callableValues: { native: { protocols: [] } },
    sourcePackages,
    sourceFiles: [root],
    ast,
    source: {
      navigation: {
        moduleExports: () => [],
      },
    },
    records: createRustRecordFixture({}),
    names: {
      functionNameForDeclaration: () => undefined,
      nameForDeclaration: () => undefined,
    },
  }, identities.identities);

  assert.equal(result.kind, "resolved");
  assert.deepEqual(result.plan.rootExports, []);
});

test("a same-named child receives a readable non-inception module identity", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import { parentValue } from "./template.js";
import { childValue } from "./template/template.js";

export function combined(): string {
  return parentValue() + childValue();
}
`,
      "template.ts": `
export function parentValue(): string { return "parent"; }
`,
      "template/template.ts": `
export function childValue(): string { return "child"; }
`,
    },
  });

  assert.equal(result.diagnostics.length === 0, true, "native source-module admission has no diagnostics");
  assert.deepEqual(result.artifacts.map((artifact) => artifact.path), [
    "Cargo.toml",
    "src/lib.rs",
    "src/index.rs",
    "src/template.rs",
    "src/template/template_2.rs",
  ]);
  assert.match(
    artifactText(result, "src/template.rs"),
    /#\[doc\(hidden\)\]\s+pub mod template_2;/u,
  );
  assert.match(
    artifactText(result, "src/index.rs"),
    /crate::template::parentValue\(\).*crate::template::template_2::childValue\(\)/su,
  );
});

test("an authored parent module owns its child declaration", () => {
  const { result } = compileRust({
    files: {
      "build.ts": "export const enabled: boolean = true;",
      "build/site.ts": "export const name: string = \"site\";",
      "index.ts": "export function ready(): boolean { return true; }",
    },
  });

  assert.equal(result.diagnostics.length === 0, true, "native source-module admission has no diagnostics");
  assert.deepEqual(result.artifacts.map((artifact) => artifact.path), [
    "Cargo.toml",
    "src/lib.rs",
    "src/initializers.rs",
    "src/build.rs",
    "src/build/site.rs",
    "src/index.rs",
  ]);
  assert.match(
    artifactText(result, "src/build.rs"),
    /#\[doc\(hidden\)\]\s+pub mod site;/u,
  );
  assert.equal(artifactText(result, "src/lib.rs").match(/pub mod build;/gu)?.length, 1);
});

test("source output identity rejects files outside the checked project root", () => {
  const sourceFile = fakeSourceFile({ fileName: "/outside/index.ts" });
  const plan = analyzeIdentityFixture({
    ast: fakeAstReader([sourceFile]),
    sourceFiles: [sourceFile],
    sourcePackages: fakeSourcePackageGraph([sourceFile], {
      packageRoot: "/project",
      sourceRoot: "/project",
    }),
    configuration: { crateName: "fixture_root", project: { kind: "generated" } },
    runtimeDependencies: [],
  });

  assert.equal(plan.kind, "rejected");
  assert.deepEqual(plan.diagnostics.map((diagnostic) => diagnostic.code), [
    "RUST_SOURCE_OUTSIDE_PROJECT_ROOT",
  ]);
});
