import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRustCompilerWorkerClient } from "../dist/providers/compiler/worker-client.js";
import {
  compilerProviderModuleId,
  projectRustCompilerModule,
} from "../dist/providers/compiler/projection.js";
import {
  compileRustThroughTargetPack,
  createRustSession,
  rustSourceDiagnostics,
} from "./helpers/rust-session.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureCrate = resolve(repositoryRoot, "test/fixtures/crates/acme_widget");
const runtimeCrate = resolve(repositoryRoot, "../rust-runtime/crates/tsonic_rust_runtime");
const testRoot = resolve(repositoryRoot, ".temp/compiler-provider-tests");

test("compiler worker reflects exact Cargo aliases, features, slices, and one cached rustdoc artifact", { timeout: 300_000 }, () => {
  const project = createUserCargoProject();
  const workerRoot = uniquePath("worker-cache");
  const shim = createCargoCountingShim();
  const originalPath = process.env.PATH;
  process.env.PATH = `${shim.directory}:${originalPath ?? ""}`;
  try {
    const worker = createRustCompilerWorkerClient(workerRoot);
    const snapshot = worker.snapshot(project.manifestPath);
    const dependency = snapshot.dependencies.find(({ alias }) => alias === "widget_alias");
    assert.ok(dependency);
    assert.equal(dependency.packageName, "acme-widget");
    assert.equal(dependency.targetCrateName, "widget_alias");
    assert.deepEqual(dependency.features, ["default", "extras"]);
    assert.ok(dependency.closurePackageIds.includes(dependency.packageId));

    const widgetModule = worker.module({
      snapshot,
      dependency,
      modulePath: [],
      requestedExports: ["Widget"],
    });
    const widget = widgetModule.exports.find(({ name }) => name === "Widget");
    assert.equal(widget?.kind, "struct");
    assert.ok(widget.unsupportedMembers.some(({ name, reason }) =>
      name === "value" && /borrowed/u.test(reason)));

    const functionModule = worker.module({
      snapshot,
      dependency,
      modulePath: [],
      requestedExports: ["double", "featured"],
    });
    assert.deepEqual(functionModule.exports.map(({ name }) => name), ["double", "featured"]);
    const nestedModule = worker.module({
      snapshot,
      dependency,
      modulePath: ["math"],
      requestedExports: ["triple"],
    });
    assert.deepEqual(nestedModule.exports.map(({ name }) => name), ["triple"]);

    const projection = projectRustCompilerModule(widgetModule, {
      providerModuleId: compilerProviderModuleId(dependency, []),
      moduleSpecifier: "@tsonic/rust/crates/widget_alias/index.js",
    });
    assert.match(projection.carrierPaths.values().next().value, /^widget_alias::Widget$/u);

    const cargoCommands = readFileSync(shim.counterPath, "utf8").trim().split("\n");
    assert.equal(cargoCommands.filter((command) => command === "metadata").length, 1);
    assert.equal(cargoCommands.filter((command) => command === "rustdoc").length, 1);
  } finally {
    process.env.PATH = originalPath;
  }
});

test("Cargo provider virtual imports compile, execute, and preserve the user-owned manifest", { timeout: 300_000 }, () => {
  const project = createUserCargoProject();
  const source = `
import type { int32 } from "@tsonic/core/types.js";
import { Widget, double, duplicate, featured, identity, maybe_positive, singleton_map } from "@tsonic/rust/crates/widget_alias/index.js";
import { int_widget } from "@tsonic/rust/crates/widget_alias/factory.js";
import { triple } from "@tsonic/rust/crates/widget_alias/math.js";

export function main(): void {
  const widget = new Widget<int32>(7);
  const previous = widget.replace(9);
  widget.count = 2;
  if (previous !== 7 || widget.count !== 2 || widget.into_value() !== 9) {
    throw new Error("generic Widget mapping failed");
  }
  if (double(4) !== 8 || identity<int32>(5) !== 5 || featured(1) !== 101 || triple(3) !== 9) {
    throw new Error("function mapping failed");
  }
  const nested = int_widget(11);
  if (nested.count !== 1 || nested.into_value() !== 11) {
    throw new Error("cross-module type mapping failed");
  }
  const maybe = maybe_positive(6);
  if (maybe !== 6) {
    throw new Error("Option mapping failed");
  }
  const values = duplicate(8);
  const second = values.pop();
  const first = values.pop();
  if (first !== 8 || second !== 8 || !values.is_empty()) {
    throw new Error("Vec mapping failed");
  }
  const map = singleton_map(10);
  if (map.is_empty()) {
    throw new Error("HashMap mapping failed");
  }
}
`;
  const manifestBefore = readFileSync(project.manifestPath, "utf8");
  const { result } = compileRustThroughTargetPack({
    target: {
      id: "rust",
      options: {
        outputType: "bin",
        crateName: "compiler_provider_proof",
        projectFile: project.manifestPath,
      },
    },
    files: { "index.ts": source },
  });

  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.artifacts.some(({ path }) => path === "Cargo.toml"), false);
  assert.match(result.artifacts.find(({ path }) => path === "src/index.rs")?.text ?? "", /widget_alias::Widget::new\(7\)/u);
  writeGeneratedArtifacts(project.root, result.artifacts);
  assert.equal(readFileSync(project.manifestPath, "utf8"), manifestBefore);
  const run = runCargo(project.manifestPath, ["run", "--quiet", "--locked"]);
  assert.equal(run.status, 0, run.stderr);
});

test("unsupported and missing Cargo exports fail closed at the selected source import", { timeout: 300_000 }, () => {
  const project = createUserCargoProject();
  for (const [importName, expected] of [
    ["dangerous", /unsafe/u],
    ["missing_export", /does not export public item/u],
  ]) {
    const harness = createRustSession({
      target: { id: "rust", options: { projectFile: project.manifestPath } },
      files: {
        "index.ts": `import { ${importName} } from "@tsonic/rust/crates/widget_alias/index.js";\nexport const selected = ${importName};\n`,
      },
    });
    assert.match(rustSourceDiagnostics(harness), expected);
  }

  const unsupportedMember = createRustSession({
    target: { id: "rust", options: { projectFile: project.manifestPath } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { Widget } from "@tsonic/rust/crates/widget_alias/index.js";
export function invalid(widget: Widget<int32>): int32 {
  return widget.value();
}
`,
    },
  });
  assert.match(rustSourceDiagnostics(unsupportedMember), /Property 'value' does not exist on type 'Widget<number>'/u);
});

test("dependency-closure mutation after snapshot is rejected before rustdoc reuse", { timeout: 300_000 }, () => {
  const copiedCrate = uniquePath("mutable-crate");
  cpSync(fixtureCrate, copiedCrate, { recursive: true });
  const project = createUserCargoProject({ dependencyPath: copiedCrate });
  const worker = createRustCompilerWorkerClient(uniquePath("worker-mutation"));
  const snapshot = worker.snapshot(project.manifestPath);
  const dependency = snapshot.dependencies.find(({ alias }) => alias === "widget_alias");
  assert.ok(dependency);
  appendFileSync(resolve(copiedCrate, "src/lib.rs"), "\n// mutation after immutable snapshot\n");

  assert.throws(
    () => worker.module({ snapshot, dependency, modulePath: [], requestedExports: ["Widget"] }),
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
