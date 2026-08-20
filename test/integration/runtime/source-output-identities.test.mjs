import { test } from "node:test";
import assert from "node:assert/strict";
import {
  artifactText,
  compileRust,
} from "../../helpers/rust-session.mjs";
import {
  planRustSourceOutputIdentities,
  rustModuleNameForSourcePath,
} from "../../../dist/analysis/program/source-output-identities.js";
import {
  planRustSourcePackageFacades,
} from "../../../dist/backend/planner/program/source-package-facades.js";
import {
  fakeAstReader,
  fakeSourcePackageGraph,
  fakeSourceFile,
} from "../../helpers/fake-compile-input.mjs";

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

  assert.deepEqual(result.diagnostics, []);
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
  const plan = planRustSourceOutputIdentities({
    ast: fakeAstReader([first, second]),
    sourceFiles: [first, second],
    sourcePackages: fakeSourcePackageGraph([first, second], {
      packageRoot: "/project",
      sourceRoot: "/project",
    }),
    paths: {
      projectFilePath: "/project/tsonic.json",
      projectRoot: "/project",
      outputRoot: "/project/out",
      targetOutputRoot: "/project/out/rust",
    },
  });

  assert.equal(plan.kind, "accepted");
  assert.equal(plan.identities.get("/project/source_name.ts")?.moduleName, "source_name");
  assert.equal(plan.identities.get("/project/source-name.ts")?.moduleName, "source_name_2");
  assert.doesNotMatch(
    [...plan.identities.values()].map((identity) => identity.artifactPath).join("\n"),
    /[0-9a-f]{64}/u,
  );
});

test("source path allocation reserves sibling bases before assigning collision suffixes", () => {
  const files = [
    fakeSourceFile({ fileName: "/project/foo-bar.ts" }),
    fakeSourceFile({ fileName: "/project/foo_bar.ts" }),
    fakeSourceFile({ fileName: "/project/foo_bar_2.ts" }),
  ];
  const plan = planRustSourceOutputIdentities({
    ast: fakeAstReader(files),
    sourceFiles: files,
    sourcePackages: fakeSourcePackageGraph(files, {
      packageRoot: "/project",
      sourceRoot: "/project",
    }),
    paths: {
      projectFilePath: "/project/tsonic.json",
      projectRoot: "/project",
      outputRoot: "/project/out",
      targetOutputRoot: "/project/out/rust",
    },
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
  const plan = planRustSourceOutputIdentities({
    ast: fakeAstReader([root, dependency]),
    sourceFiles: [root, dependency],
    sourcePackages,
    paths: {
      projectFilePath: "/project/tsonic.json",
      projectRoot: "/project/src",
      outputRoot: "/project/out",
      targetOutputRoot: "/project/out/rust",
    },
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
  const result = planRustSourcePackageFacades({
    ast: fakeAstReader([root]),
    sourceFiles: [root],
    sourcePackages,
    source: {
      navigation: {
        moduleExports: () => [],
      },
    },
  }, new Map());

  assert.deepEqual(result.diagnostics, []);
  assert.notEqual(result.plan, undefined);
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

  assert.deepEqual(result.diagnostics, []);
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
    /crate::template::parent_value\(\).*crate::template::template_2::child_value\(\)/su,
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

  assert.deepEqual(result.diagnostics, []);
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
  const plan = planRustSourceOutputIdentities({
    ast: fakeAstReader([sourceFile]),
    sourceFiles: [sourceFile],
    sourcePackages: fakeSourcePackageGraph([sourceFile], {
      packageRoot: "/project",
      sourceRoot: "/project",
    }),
    paths: {
      projectFilePath: "/project/tsonic.json",
      projectRoot: "/project",
      outputRoot: "/project/out",
      targetOutputRoot: "/project/out/rust",
    },
  });

  assert.equal(plan.kind, "rejected");
  assert.deepEqual(plan.diagnostics.map((diagnostic) => diagnostic.code), [
    "RUST_SOURCE_OUTSIDE_PROJECT_ROOT",
  ]);
});
