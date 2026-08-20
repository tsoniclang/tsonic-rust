import { test } from "node:test";
import assert from "node:assert/strict";
import { createCargoToolchain } from "../../../dist/toolchain/cargo-toolchain.js";

test("cargo toolchain reports deterministic source-to-source artifacts without building", () => {
  const toolchain = createCargoToolchain({
    project: { entryPoint: "src/index.ts", targets: [] },
    target: { id: "rust", options: {} },
  });
  const result = toolchain.prepare({
    artifactsRoot: "out",
    project: { entryPoint: "src/index.ts", targets: [] },
    target: { id: "rust", options: {} },
    compileOutput: {
      artifacts: [
        { kind: "project", path: "Cargo.toml", text: "[package]" },
        { kind: "source", path: "src/lib.rs", language: "rust", text: "// generated" },
      ],
    },
  });

  assert.deepEqual(result, {
    diagnostics: [],
    producedArtifacts: ["Cargo.toml", "src/lib.rs"],
  });
});
