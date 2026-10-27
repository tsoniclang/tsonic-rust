import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestWorkspace } from "../../../../tsonic/test/scripts/test-workspaces.mjs";
import { materializeCargoCrate, materializeRustRuntimeReferences } from "../../../dist/providers/runtime/materialization.js";
import { rustRuntimeCrateReference } from "../../../dist/providers/runtime/source-crates.js";
import {
  cargoCrateAttributeName,
  cargoDefaultFeaturesAttributeName,
  cargoFeaturesAttributeName,
  cargoPathReferenceKind,
  cargoRegistryPatchAttributeName,
  rustMinimumFoundationAttributeName,
} from "../../../dist/target-model/project/cargo-reference.js";

const workspace = (prefix) => createTestWorkspace(fileURLToPath(new URL("../../../.temp/", import.meta.url)), prefix);

function crate(root, directory, manifest) {
  const path = join(root, directory);
  mkdirSync(path, { recursive: true });
  if (manifest !== undefined) writeFileSync(join(path, "Cargo.toml"), manifest);
  return path;
}

test("a runtime crate reference resolves the installed runtime package and records its exact Cargo identity", () => {
  const root = workspace("runtime-crate-reference-");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "app", private: true }));
  const packageRoot = join(root, "node_modules", "@acme", "runtime");
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: "@acme/runtime", version: "1.0.0" }));
  const reference = rustRuntimeCrateReference({ paths: { projectRoot: root } }, "@acme/runtime", "acme_runtime",
    { minimumFoundation: "alloc", defaultFeatures: false, features: ["std", "alloc", "std"] });
  assert.equal(reference.kind, cargoPathReferenceKind);
  assert.equal(reference.include, join(realpathSync(packageRoot), "crates", "acme_runtime"));
  assert.deepEqual(reference.attributes, {
    [cargoCrateAttributeName]: "acme_runtime",
    [cargoRegistryPatchAttributeName]: "crates-io",
    [rustMinimumFoundationAttributeName]: "alloc",
    [cargoDefaultFeaturesAttributeName]: "false",
    [cargoFeaturesAttributeName]: JSON.stringify(["alloc", "std"]),
  });
  assert.equal(Object.isFrozen(reference), true);
  assert.equal(Object.isFrozen(reference.attributes), true);
});

test("a runtime crate materializes only from an absolute directory whose Cargo package is the named crate", () => {
  const root = workspace("runtime-crate-materialize-");
  const exact = crate(root, "acme_core", '[package]\nname = "acme_core"\nversion = "0.1.0"\n');
  assert.deepEqual(materializeCargoCrate(exact, "acme_core"), { path: realpathSync.native(exact) });

  assert.equal(materializeCargoCrate("acme_core", "acme_core").reason, "include must be an absolute normalized path.");
  assert.equal(materializeCargoCrate(crate(root, "empty"), "empty").reason,
    "crate directory does not contain a readable Cargo.toml.");
  const other = crate(root, "acme_other", '[package]\nname = "acme_other"\n');
  assert.equal(materializeCargoCrate(other, "acme_core").reason, "crate attribute 'acme_core' conflicts with Cargo package 'acme_other'.");
  const workspaceOnly = crate(root, "acme_workspace", '[workspace]\nmembers = ["a"]\n');
  assert.equal(materializeCargoCrate(workspaceOnly, "acme_workspace").reason,
    "Cargo.toml must declare one direct literal '[package] name = \"...\"' identity.");
});

test("runtime reference materialization acquires every Cargo path reference with a crate attribute and ignores others", () => {
  const root = workspace("runtime-crate-references-");
  const exact = crate(root, "acme_core", '[package]\nname = "acme_core"\n');
  const cargo = { kind: cargoPathReferenceKind, include: exact, attributes: { [cargoCrateAttributeName]: "acme_core" } };
  const unnamed = { kind: cargoPathReferenceKind, include: exact, attributes: {} };
  const other = { kind: "msbuild-project", include: exact, attributes: { [cargoCrateAttributeName]: "acme_core" } };
  const acquired = materializeRustRuntimeReferences([cargo, unnamed, other]);
  assert.equal(acquired.size, 1);
  assert.deepEqual(acquired.get(cargo), { path: realpathSync.native(exact) });
  assert.equal(Object.isFrozen(acquired.get(cargo)), true);
});
