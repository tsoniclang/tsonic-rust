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
  assert.match(rustModuleNameForSourcePath("docs/models.ts") ?? "", /^docs_models_id_[0-9a-f]{64}$/u);
  assert.match(rustModuleNameForSourcePath("resources/models.ts") ?? "", /^resources_models_id_[0-9a-f]{64}$/u);
  assert.equal(rustModuleNameForSourcePath("source_name.ts"), "source_name");
  assert.match(rustModuleNameForSourcePath("source-name.ts") ?? "", /^source_name_id_[0-9a-f]{64}$/u);
  assert.equal(rustModuleNameForSourcePath("main.ts"), "source_main");
  assert.equal(rustModuleNameForSourcePath("lib.ts"), "source_lib");
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
    `src/${docsModule}.rs`,
    "src/index.rs",
    `src/${resourcesModule}.rs`,
  ]);
  assert.match(
    artifactText(result, "src/index.rs"),
    new RegExp(`crate::${docsModule}::value\\(\\)\\s*\\+\\s*crate::${resourcesModule}::value\\(\\)`, "u"),
  );
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
