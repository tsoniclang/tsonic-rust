import { test } from "node:test";
import assert from "node:assert/strict";
import {
  artifactText,
  compileRust,
} from "./helpers/rust-session.mjs";
import {
  planRustSourceOutputIdentities,
  rustModuleNameForSourcePath,
} from "../dist/index.js";
import {
  fakeAstReader,
  fakeSourceFile,
} from "./helpers/fake-compile-input.mjs";

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
    "src/build.rs",
    "src/build/site.rs",
    "src/index.rs",
  ]);
  assert.match(artifactText(result, "src/build.rs"), /pub mod site;/u);
  assert.equal(artifactText(result, "src/lib.rs").match(/pub mod build;/gu)?.length, 1);
});

test("source output identity rejects files outside the checked project root", () => {
  const sourceFile = fakeSourceFile({ fileName: "/outside/index.ts" });
  const plan = planRustSourceOutputIdentities({
    ast: fakeAstReader([sourceFile]),
    sourceFiles: [sourceFile],
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
