import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixtureCratesRoot, repositoryRoot, rustRuntimeCratePath } from "./rust-session.mjs";
import { validateCargoProject, writeGeneratedArtifacts } from "./cargo-projects.mjs";
import { createTestWorkspace } from "../../../tsonic/test/scripts/test-workspaces.mjs";

export function createMacroProject(name, { procedural = false } = {}) {
  const root = createTestWorkspace(join(repositoryRoot, ".temp/generated"), `${name}-`);
  const generated = join(root, "generated");
  mkdirSync(join(generated, "src"), { recursive: true });
  writeFileSync(join(generated, "src/main.rs"), "fn main() {}\n");
  const manifestPath = join(root, "Cargo.toml");
  const manifest = [
    "[package]", `name = ${JSON.stringify(name)}`, 'version = "0.1.0"', 'edition = "2024"',
    "", "[workspace]", "", "[[bin]]", `name = ${JSON.stringify(name)}`, 'path = "generated/src/main.rs"',
    "", "[dependencies]",
    `tsonic_rust_runtime = { path = ${JSON.stringify(rustRuntimeCratePath)} }`,
    `macro_proofs = { package = "acme_testing", path = ${JSON.stringify(join(fixtureCratesRoot, "acme_testing"))} }`,
    ...(procedural ? [
      `native_macros = { package = "acme_attributes", path = ${JSON.stringify(join(fixtureCratesRoot, "acme_attributes"))} }`,
    ] : []),
    "",
  ].join("\n");
  writeFileSync(manifestPath, manifest);
  return {
    root, generated, manifestPath, manifest,
    target: { id: "rust", options: { outputType: "bin", crateName: name, projectFile: manifestPath } },
  };
}

export function verifyMacroProject(project, artifacts) {
  writeGeneratedArtifacts(project.generated, artifacts);
  assert.equal(readFileSync(project.manifestPath, "utf8"), project.manifest);
  validateCargoProject(project.root, { run: true });
  assert.equal(readFileSync(project.manifestPath, "utf8"), project.manifest);
}

export function assertMacroProjectUnpublished(project) {
  assert.equal(readFileSync(join(project.generated, "src/main.rs"), "utf8"), "fn main() {}\n");
  assert.equal(readFileSync(project.manifestPath, "utf8"), project.manifest);
}
