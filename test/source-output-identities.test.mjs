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
  assert.equal(rustModuleNameForSourcePath("docs/models.ts"), "docs__models");
  assert.equal(rustModuleNameForSourcePath("resources/models.ts"), "resources__models");
  assert.equal(rustModuleNameForSourcePath("source_name.ts"), "source_name");
  assert.match(rustModuleNameForSourcePath("source-name.ts") ?? "", /^source_name__id_[0-9a-f]{64}$/u);
  assert.equal(rustModuleNameForSourcePath("main.ts"), "source__main");
  assert.equal(rustModuleNameForSourcePath("lib.ts"), "source__lib");
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
  assert.deepEqual(result.artifacts.map((artifact) => artifact.path), [
    "Cargo.toml",
    "src/lib.rs",
    "src/docs__models.rs",
    "src/index.rs",
    "src/resources__models.rs",
  ]);
  assert.match(
    artifactText(result, "src/index.rs"),
    /crate::docs__models::value\(\) \+ crate::resources__models::value\(\)/u,
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
