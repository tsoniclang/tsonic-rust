import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  cpSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRustCompilerWorkerClient } from "../../../../dist/providers/compiler/protocol/worker-client.js";
import {
  compilerProviderModuleId,
  projectRustCompilerModule,
} from "../../../../dist/providers/compiler/projection/projection.js";
import {
  rustCompilerProviderProtocolVersion,
} from "../../../../dist/providers/compiler/model/model.js";
import {
  verifyRustCompilerStandardLibraryMetadata,
} from "../../../../dist/providers/compiler/snapshot/cargo-snapshot.js";
import {
  compileRustThroughTargetPack,
  createRustSession,
  rustSourceDiagnostics,
} from "../../../helpers/rust-session.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const fixtureCrate = resolve(repositoryRoot, "test/fixtures/crates/acme_widget");
const runtimeCrate = resolve(repositoryRoot, "../rust-runtime/crates/tsonic_rust_runtime");
const testRoot = resolve(repositoryRoot, ".temp/compiler-provider-tests");

test("compiler provider preserves Rust scalar char without conflating neutral UTF-16 char", () => {
  const module = {
    protocolVersion: rustCompilerProviderProtocolVersion,
    projectDigest: "char-contract",
    dependency: {
      alias: "char_contract",
      packageId: "char-contract 1.0.0",
      packageName: "char-contract",
      packageVersion: "1.0.0",
      crateName: "char_contract",
      targetCrateName: "char_contract",
      manifestPath: "/char-contract/Cargo.toml",
      sourceRoot: "/char-contract",
      sourceDigest: "char-contract",
      closurePackageIds: ["char-contract 1.0.0"],
      features: [],
    },
    modulePath: [],
    exports: [{
      kind: "function",
      id: "char_contract::identity",
      name: "identity",
      canonicalPath: ["char_contract", "identity"],
      targetPath: ["char_contract", "identity"],
      function: {
        identity: {
          itemId: "char_contract::identity",
          canonicalPath: ["char_contract", "identity"],
        },
        name: "identity",
        parameters: [{ name: "value", type: { kind: "primitive", name: "char" } }],
        result: { kind: "primitive", name: "char" },
        genericParameters: [],
        typeRequirements: [],
        asynchronous: false,
        unsafe: false,
        abi: "Rust",
        variadic: false,
      },
    }],
    unsupportedExports: [],
    standardTypeLocations: [],
  };

  const projection = projectRustCompilerModule(module, {
    providerModuleId: "char_contract",
    moduleSpecifier: "@tsonic/rust/crates/char_contract/index.js",
  });
  assert.deepEqual(projection.declarationModel.imports, [{
    moduleSpecifier: "@tsonic/rust/types.js",
    namedImports: [{ exportedName: "scalar" }],
  }]);
  const declaration = projection.declarationModel.exports[0];
  assert.equal(declaration.signatures[0].parameters[0].type.exportName, "scalar");
  assert.equal(declaration.signatures[0].returnType.exportName, "scalar");
  assert.deepEqual(projection.operations[0].parameterCarriers, [{
    kind: "target-named",
    id: "rust.native.char",
  }]);
  assert.deepEqual(projection.operations[0].resultCarrier, {
    kind: "target-named",
    id: "rust.native.char",
  });
});

test("compiler provider retains incomplete Rust enums as opaque native types", () => {
  const dependency = {
    alias: "opaque_enum",
    packageId: "opaque-enum 1.0.0",
    packageName: "opaque-enum",
    packageVersion: "1.0.0",
    crateName: "opaque_enum",
    targetCrateName: "opaque_enum",
    manifestPath: "/opaque-enum/Cargo.toml",
    sourceRoot: "/opaque-enum",
    sourceDigest: "opaque-enum",
    closurePackageIds: ["opaque-enum 1.0.0"],
    features: [],
  };
  const projection = projectRustCompilerModule({
    protocolVersion: rustCompilerProviderProtocolVersion,
    projectDigest: "opaque-enum",
    dependency,
    modulePath: [],
    exports: [{
      kind: "enum",
      id: "opaque_enum::Mode",
      name: "Mode",
      canonicalPath: ["opaque_enum", "Mode"],
      targetPath: ["opaque_enum", "Mode"],
      genericParameters: [],
      variantsComplete: false,
      variants: [],
      methods: [],
      associatedConstants: [],
      unsupportedMembers: [{ kind: "variant", name: "Hidden", reason: "stripped by rustdoc" }],
      traits: { implementations: [] },
    }],
    unsupportedExports: [],
    standardTypeLocations: [],
  }, {
    providerModuleId: "opaque-enum",
    moduleSpecifier: "@tsonic/rust/crates/opaque_enum/index.js",
  });

  assert.deepEqual(
    projection.declarationModel.exports.map(({ kind, name }) => ({ kind, name })),
    [{ kind: "class", name: "Mode" }],
  );
  assert.deepEqual(projection.operations, []);
  assert.deepEqual([...projection.carrierPaths.values()], ["opaque_enum::Mode"]);
});

test("standard-library metadata snapshots fail closed after exact artifact mutation", () => {
  const root = uniquePath("standard-metadata");
  const artifactPath = resolve(root, "libstd-proof.rmeta");
  mkdirSync(root, { recursive: true });
  writeFileSync(artifactPath, "original");
  const artifactStat = statSync(artifactPath);
  const snapshot = {
    kind: "standard-library",
    metadataArtifacts: [{
      crateName: "std",
      path: artifactPath,
      byteLength: artifactStat.size,
      modifiedMilliseconds: artifactStat.mtimeMs,
      digest: "not-consumed-by-mutation-check",
    }],
  };
  verifyRustCompilerStandardLibraryMetadata(snapshot);
  writeFileSync(artifactPath, "mutated metadata");
  assert.throws(
    () => verifyRustCompilerStandardLibraryMetadata(snapshot),
    /changed after the compiler-provider snapshot was created/u,
  );
});

function createUserCargoProject({ dependencyPath = fixtureCrate } = {}) {
  const root = uniquePath("cargo-project");
  const generatedSource = resolve(root, "generated/src/main.rs");
  mkdirSync(dirname(generatedSource), { recursive: true });
  writeFileSync(generatedSource, "fn main() {}\n");
  const manifestPath = resolve(root, "Cargo.toml");
  writeFileSync(manifestPath, [
    "[package]",
    'name = "compiler-provider-proof"',
    'version = "0.1.0"',
    'edition = "2021"',
    "",
    "[lib]",
    'path = "generated/src/lib.rs"',
    "",
    "[[bin]]",
    'name = "compiler_provider_proof"',
    'path = "generated/src/main.rs"',
    "",
    "[dependencies]",
    `tsonic_rust_runtime = { path = "${tomlPath(runtimeCrate)}" }`,
    `widget_alias = { package = "acme-widget", path = "${tomlPath(dependencyPath)}", features = ["extras"] }`,
    "",
  ].join("\n"));
  return { root, manifestPath };
}

function writeGeneratedArtifacts(root, artifacts) {
  for (const artifact of artifacts) {
    const path = resolve(root, "generated", artifact.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, artifact.text);
  }
}

function createCargoCountingShim() {
  const realCargo = spawnSync("bash", ["-lc", "command -v cargo"], { encoding: "utf8" }).stdout.trim();
  assert.notEqual(realCargo, "");
  const directory = uniquePath("cargo-shim");
  const counterPath = resolve(directory, "commands.log");
  const executable = resolve(directory, "cargo");
  mkdirSync(directory, { recursive: true });
  writeFileSync(executable, [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `printf '%s\\n' \"\${1:-}\" >> '${shellText(counterPath)}'`,
    `exec '${shellText(realCargo)}' \"$@\"`,
    "",
  ].join("\n"));
  chmodSync(executable, 0o755);
  return { directory, counterPath };
}

function runCargo(manifestPath, arguments_) {
  return spawnSync("cargo", [...arguments_, "--manifest-path", manifestPath], {
    cwd: dirname(manifestPath),
    encoding: "utf8",
    env: { ...process.env, CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? "2" },
    timeout: 300_000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function uniquePath(label) {
  const path = resolve(testRoot, `${label}-${process.pid}-${randomUUID()}`);
  mkdirSync(path, { recursive: true });
  return path;
}

function tomlPath(path) {
  return path.replaceAll("\\", "/").replaceAll('"', '\\"');
}

function shellText(text) {
  return text.replaceAll("'", "'\\''");
}
