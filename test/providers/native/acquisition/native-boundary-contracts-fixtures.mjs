import assert from "node:assert/strict";

import { spawnSync } from "node:child_process";

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";

import { join, resolve } from "node:path";

import { artifactText, compileRustThroughTargetPack, repositoryRoot } from "../../../helpers/rust-session.mjs";

import { runCargo, writeGeneratedProject } from "../../../helpers/cargo-projects.mjs";

import { createTestWorkspace } from "../../../../../tsonic/test/scripts/test-workspaces.mjs";


function createBorrowedProject() {
  const root = createTestWorkspace(resolve(repositoryRoot, ".temp/native-boundary"), "borrowed-");
  const manifestPath = join(root, "Cargo.toml");
  writeFileSync(manifestPath, `[package]
name = "borrowed-contract"
version = "0.0.0"
edition = "2024"
[lib]
path = "generated/src/lib.rs"
[dependencies]
borrowed = { package = "acme-borrowed", path = ${JSON.stringify(resolve(repositoryRoot, "test/fixtures/crates/acme_borrowed"))} }
tsonic_rust_runtime = { path = ${JSON.stringify(resolve(repositoryRoot, "../rust-runtime/crates/tsonic_rust_runtime"))} }
`);
  mkdirSync(join(root, "generated/src"), { recursive: true });
  writeFileSync(join(root, "generated/src/lib.rs"), "");
  return { root, manifestPath };
}


function writeArtifacts(root, artifacts) {
  for (const artifact of artifacts) {
    const file = join(root, "generated", artifact.path);
    mkdirSync(resolve(file, ".."), { recursive: true });
    writeFileSync(file, artifact.text);
  }
}

export {
  createBorrowedProject,
  writeArtifacts,
};
