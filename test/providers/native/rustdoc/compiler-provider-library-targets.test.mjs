import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createTestWorkspace } from "../../../../../tsonic/test/scripts/test-workspaces.mjs";
import {
  createRustCompilerProjectSnapshot,
  verifyRustCompilerDependencySource,
} from "../../../../dist/providers/native/snapshot/cargo-snapshot.js";

const testRoot = fileURLToPath(new URL("../../../../.temp/compiler-provider-tests/", import.meta.url));

for (const [label, settings] of [
  ["ordinary", ""],
  ["rlib", 'crate-type = ["rlib"]'],
  ["dylib", 'crate-type = ["dylib"]'],
  ["mixed", 'crate-type = ["rlib", "cdylib", "staticlib"]'],
  ["procedural", "proc-macro = true"],
]) {
  test(`Cargo snapshots retain exact ${label} library identity and feature selection`, { timeout: 150_000 }, () => {
    const project = createProject(settings);
    const snapshot = createRustCompilerProjectSnapshot(project.manifest);
    assert.equal(snapshot.dependencies.length, 1);
    const dependency = snapshot.dependencies[0];
    assert.equal(dependency.alias, "selected_alias");
    assert.equal(dependency.targetCrateName, "selected_alias");
    assert.equal(dependency.crateName, "actual_library");
    assert.equal(dependency.packageName, "native-package");
    assert.deepEqual(dependency.features, ["chosen"]);
    assert.equal(dependency.manifestPath, project.dependencyManifest);
    assert.deepEqual(dependency.closurePackageIds, [dependency.packageId]);
    assert.equal(readFileSync(project.manifest, "utf8"), project.manifestText);
    assert.equal(readFileSync(project.dependencyManifest, "utf8"), project.dependencyManifestText);
    assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(dependency));
    verifyRustCompilerDependencySource(snapshot, dependency);
    writeFileSync(project.dependencySource, "pub fn changed() {}\n");
    assert.throws(() => verifyRustCompilerDependencySource(snapshot, dependency), /changed after/u);
  });
}

for (const kind of ["cdylib", "staticlib"]) {
  test(`Cargo snapshots reject a foreign-only ${kind} as a Rust library import`, { timeout: 150_000 }, () => {
    const project = createProject(`crate-type = ["${kind}"]`);
    assert.throws(() => createRustCompilerProjectSnapshot(project.manifest), /exactly one library target; found 0/u);
    assert.equal(readFileSync(project.manifest, "utf8"), project.manifestText);
  });
}

function createProject(librarySettings) {
  const root = createTestWorkspace(testRoot, "library-target-");
  const dependencyRoot = join(root, "dependency");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(dependencyRoot, "src"), { recursive: true });
  const manifest = join(root, "Cargo.toml");
  const manifestText = [
    "[package]", 'name = "library-target-proof"', 'version = "0.1.0"', 'edition = "2024"',
    "[workspace]", "[dependencies]",
    'selected_alias = { package = "native-package", path = "dependency", default-features = false, features = ["chosen"] }', "",
  ].join("\n");
  const dependencyManifest = join(dependencyRoot, "Cargo.toml");
  const dependencyManifestText = [
    "[package]", 'name = "native-package"', 'version = "0.1.0"', 'edition = "2024"',
    "[lib]", 'name = "actual_library"', librarySettings, "[features]", 'default = ["unselected"]',
    "chosen = []", "unselected = []", "",
  ].join("\n");
  const dependencySource = join(dependencyRoot, "src/lib.rs");
  writeFileSync(manifest, manifestText);
  writeFileSync(join(root, "src/lib.rs"), "");
  writeFileSync(dependencyManifest, dependencyManifestText);
  writeFileSync(dependencySource, "");
  return { manifest, manifestText, dependencyManifest, dependencyManifestText, dependencySource };
}
