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
const emptyGenerics = Object.freeze({ parameters: [], wherePredicates: [] });

test("compiler provider projects Rust scalar char through its exact source and target contracts", () => {
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
      identity: {
        itemId: "char_contract::identity",
        canonicalPath: ["char_contract", "identity"],
      },
      name: "identity",
      targetPath: ["char_contract", "identity"],
      function: {
        identity: {
          itemId: "char_contract::identity",
          canonicalPath: ["char_contract", "identity"],
        },
        name: "identity",
        parameters: [{ name: "value", type: { kind: "primitive", name: "char" } }],
        result: { kind: "primitive", name: "char" },
        enclosingGenerics: emptyGenerics,
        generics: emptyGenerics,
        asynchronous: false,
        safety: "safe",
        abi: "Rust",
        variadic: false,
      },
    }],
    implementations: [],
    unsupportedExports: [],
    standardItemLocations: [],
  };

  const projection = projectRustCompilerModule(module, {
    providerModuleId: "char_contract",
    moduleSpecifier: "@tsonic/rust/crates/char_contract/index.js",
  });
  const declaration = projection.declarationModel.exports.find(({ name }) => name === "identity");
  assert.equal(declaration?.kind, "function");
  assert.deepEqual(declaration?.kind === "function"
    ? declaration.signatures[0]?.parameters[0]?.type
    : undefined, {
    kind: "provider-ref",
    moduleSpecifier: "@tsonic/rust/types.js",
    exportName: "char",
  });
  assert.deepEqual(declaration?.kind === "function"
    ? declaration.signatures[0]?.returnType
    : undefined, {
    kind: "provider-ref",
    moduleSpecifier: "@tsonic/rust/types.js",
    exportName: "char",
  });
  assert.deepEqual(projection.operations[0]?.parameterCarriers, [{
    kind: "primitive",
    name: "char",
  }]);
  assert.deepEqual(projection.operations[0]?.resultCarrier, {
    kind: "primitive",
    name: "char",
  });
});

test("compiler provider rejects incomplete Rust enums without an opaque fallback", () => {
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
  assert.throws(
    () => projectRustCompilerModule({
      protocolVersion: rustCompilerProviderProtocolVersion,
      projectDigest: "opaque-enum",
      dependency,
      modulePath: [],
      exports: [{
        kind: "enum",
        identity: {
          itemId: "opaque_enum::Mode",
          canonicalPath: ["opaque_enum", "Mode"],
        },
        name: "Mode",
        targetPath: ["opaque_enum", "Mode"],
        generics: emptyGenerics,
        variantsComplete: false,
        variants: [],
        methods: [],
        associatedConstants: [],
        associatedTypes: [],
        unsupportedMembers: [{ kind: "variant", name: "Hidden", reason: "stripped by rustdoc" }],
        traits: { implementations: [] },
        layout: { representation: "rust" },
      }],
      implementations: [],
      unsupportedExports: [],
      standardItemLocations: [],
    }, {
      providerModuleId: "opaque-enum",
      moduleSpecifier: "@tsonic/rust/crates/opaque_enum/index.js",
    }),
    /Mode\.Hidden: stripped by rustdoc/u,
  );
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
