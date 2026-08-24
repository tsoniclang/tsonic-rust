import { test } from "node:test";
import assert from "node:assert/strict";
import { acmeSuperbunapiCapability, acmeTestingPackage, artifactText, buildInstalledLayout, compileRust } from "../../helpers/rust-session.mjs";
import {
  captureTargetCapabilityContributions,
  selectInstalledTargetCapabilities,
  validateTargetModuleOwnership,
} from "../../../../tsonic/packages/host/dist/target/extensions.js";
import { createRustTargetPack } from "../../../dist/index.js";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { fakeCompileInput } from "../../helpers/fake-compile-input.mjs";

test("superbunapi lowers through the generic capability mechanism", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    packages: [acmeSuperbunapiCapability(), acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "superbun_proof" } },
    files: {
      "index.ts": `
import { serve } from "superbunapi";
import { check } from "@acme/testing";

export function main(): void {
  const banner = serve(3000);
  check(banner === "superbunapi:3000");
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /acme_superbunapi::serve\(3000\)/u);
  assert.match(artifactText(result, "Cargo.toml"), /acme_superbunapi = \{ path = /u);
  const run = validateGeneratedProject("superbun-proof-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("node modules fail cleanly without the capability installed", async () => {
  // No installed capability owns node:fs, so the module does not resolve
  // and checking fails deterministically before any artifact exists.
  assert.throws(
    () => compileRust({
      surfaces: ["js"],
      files: { "index.ts": `import { readFileSync } from "node:fs";\n\nexport function f(path: string): string {\n  return readFileSync(path, "utf8");\n}\n` },
    }),
    /TypeScript diagnostics/u,
  );
});

test("unused installed capability contributes no runtime crates", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeSuperbunapiCapability()],
    files: { "index.ts": "export function f(): boolean {\n  return true;\n}\n" },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.ok(!artifactText(result, "Cargo.toml").includes("acme_superbunapi"));
});

test("duplicate module ownership fails closed in local composition", async () => {
  const first = acmeSuperbunapiCapability();
  const second = { ...acmeSuperbunapiCapability(), id: "acme-superbunapi-second" };
  assert.throws(
    () => validateTargetModuleOwnership(
      { id: "rust", options: {} },
      createRustTargetPack().provider,
      [first, second],
    ),
    /Ambiguous Tsonic provider ownership/u,
  );
});

test("duplicate capability identities and overlapping ownership fail closed", () => {
  const first = acmeSuperbunapiCapability();
  assert.match(
    selectInstalledTargetCapabilities({ id: "rust", options: {} }, [first, first]).error,
    /Ambiguous Tsonic capability ownership/u,
  );
  const broad = { ...first, id: "broad", moduleOwnership: [{ specifierPrefix: "node:" }] };
  const narrow = { ...first, id: "narrow", moduleOwnership: [{ specifierPrefix: "node:fs" }] };
  assert.match(
    selectInstalledTargetCapabilities({ id: "rust", options: {} }, [broad, narrow]).error,
    /module prefixes 'node:' \(broad\) and 'node:fs' \(narrow\)/u,
  );
});

test("capability composition enforces required selected surfaces", () => {
  const capability = { ...acmeSuperbunapiCapability(), requiredSurfaces: ["js"] };
  assert.match(
    selectInstalledTargetCapabilities({ id: "rust", options: {} }, [capability], []).error,
    /requires surface 'js'/u,
  );
  assert.equal(
    "selectedCapabilities" in selectInstalledTargetCapabilities(
      { id: "rust", options: {} },
      [capability],
      [{ id: "js" }],
    ),
    true,
  );
});

test("wrong-target capabilities are not selected for the active target", async () => {
  const capability = { ...acmeSuperbunapiCapability(), targetId: "csharp" };
  assert.deepEqual(
    selectInstalledTargetCapabilities({ id: "rust", options: {} }, [capability], []),
    { selectedCapabilities: [] },
  );
});

test("simulated installed layout resolves target runtime crates end to end", { timeout: 300_000 }, async () => {
  const { existsSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const installedRoot = buildInstalledLayout();
  const scopeRoot = resolve(installedRoot, "node_modules/@tsonic");
  const jsManifest = resolve(scopeRoot, "rust-js/crates/tsonic_rust_js/Cargo.toml");
  const runtimeManifest = resolve(scopeRoot, "rust-runtime/crates/tsonic_rust_runtime/Cargo.toml");
  const nodeManifest = resolve(scopeRoot, "rust-nodejs/rust/crates/tsonic_rust_node/Cargo.toml");
  for (const manifest of [jsManifest, runtimeManifest, nodeManifest]) {
    assert.ok(existsSync(manifest), `missing installed runtime manifest ${manifest}`);
  }
  const targetModule = await import(pathToFileURL(resolve(scopeRoot, "target-rust/dist/index.js")).href);
  const nodeModule = await import(pathToFileURL(resolve(scopeRoot, "rust-nodejs/dist/index.js")).href);
  const targetPack = targetModule.createTsonicPlugin().createTargetPack();
  const nodeCapability = nodeModule.createTsonicPlugin();
  const jsSurface = targetPack.surfaces.find((surface) => surface.id === "js");
  assert.ok(jsSurface);
  const consumerRoot = resolve(installedRoot, "consumer");
  mkdirSync(resolve(consumerRoot, "src"), { recursive: true });
  const target = { id: "rust", options: {} };
  const project = { entryPoint: "src/index.ts", targets: [target] };
  const context = {
    project,
    projectDirectory: consumerRoot,
    target,
    selectedCapabilityIds: [nodeCapability.id],
    selectedSurfaceIds: [jsSurface.id],
    paths: {
      projectFilePath: resolve(consumerRoot, "tsonic.json"),
      projectRoot: consumerRoot,
      outputRoot: resolve(consumerRoot, "out"),
      targetOutputRoot: resolve(consumerRoot, "out/rust"),
    },
  };
  const capturedCapabilities = captureTargetCapabilityContributions({
    project,
    projectDirectory: consumerRoot,
    target,
    selectedCapabilities: [nodeCapability],
    selectedSurfaces: [jsSurface],
  });
  const targetSession = targetPack.createCompilationSession({
    project,
    projectDirectory: consumerRoot,
    target,
    paths: context.paths,
    selectedSurfaceIds: context.selectedSurfaceIds,
    capabilities: capturedCapabilities,
  });
  targetSession.sourceProfileContributions();
  targetSession.sourceCompilerContributions();
  const references = [
    ...targetSession.runtimeContributions().references,
    ...jsSurface.runtimeContributions(context).references,
    ...nodeCapability.runtimeContributions({ ...context, capability: nodeCapability }).references,
  ];
  const compiled = targetSession.compile(fakeCompileInput({
    target,
    runtimeReferences: references,
  }));
  targetSession.close();
  const result = {
    artifacts: compiled.kind === "resolved" ? compiled.value.artifacts : [],
    diagnostics: compiled.diagnostics,
  };
  assert.deepEqual(result.diagnostics, []);
  const generatedManifest = result.artifacts.find((artifact) => artifact.path === "Cargo.toml")?.text;
  assert.equal(typeof generatedManifest, "string");
  writeFileSync(resolve(consumerRoot, "Cargo.toml"), generatedManifest);
  writeFileSync(resolve(consumerRoot, "src/lib.rs"), "pub fn installed_layout_proof() {}\n");
  for (const crate of ["tsonic_rust_runtime", "tsonic_rust_js", "tsonic_rust_node"]) {
    assert.equal(generatedManifest.split("\n").filter((line) => line.startsWith(`${crate} = `)).length, 2,
      `${crate} must have one direct dependency and one explicit registry patch`);
  }
  const { execFileSync } = await import("node:child_process");
  const metadata = execFileSync("cargo", [
    "metadata", "--format-version", "1", "--offline",
    "--manifest-path", resolve(consumerRoot, "Cargo.toml"),
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const packages = JSON.parse(metadata).packages;
  for (const [crate, expectedManifest] of [
    ["tsonic_rust_node", nodeManifest],
    ["tsonic_rust_js", jsManifest],
    ["tsonic_rust_runtime", runtimeManifest],
  ]) {
    const matches = packages.filter((entry) => entry.name === crate);
    assert.equal(matches.length, 1, `${crate} must resolve exactly once`);
    assert.equal(resolve(matches[0].manifest_path), expectedManifest);
  }
});

test("telemetry capability proves async and fallible rows through a runtime binary", { timeout: 300_000 }, async () => {
  const { acmeTelemetryCapability } = await import("../../helpers/rust-session.mjs");
  const { result } = compileRust({
    packages: [acmeTelemetryCapability(), acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "telemetry_proof" } },
    files: {
      "index.ts": `
import { createMeter } from "telemetry";
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

export function main(): void {
  let seen: int32 = 0;
  try {
    const meter = createMeter("requests");
    meter.total();
    seen = meter.total();
  } catch (error) {
    seen = -1;
  }
  check(seen === 0);
  let rejected = false;
  try {
    createMeter("");
  } catch (error) {
    rejected = true;
  }
  check(rejected);
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /acme_telemetry::create_meter\("requests"\)\?/u);
  const run = validateGeneratedProject("telemetry-proof-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("telemetry async fallible rows lower to awaited try calls", async () => {
  const { acmeTelemetryCapability } = await import("../../helpers/rust-session.mjs");
  const { result } = compileRust({
    packages: [acmeTelemetryCapability()],
    files: {
      "index.ts": `
import { createMeter } from "telemetry";
import type { int32 } from "@tsonic/core/types.js";

export async function run(): Promise<int32> {
  const meter = createMeter("latency");
  const first = await meter.record(1.5);
  return first;
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /meter\.record\(1\.5\)\.await\?/u);
  validateGeneratedProject("telemetry-async-lib", result.artifacts);
});

test("many capabilities compose with disjoint ownership and single-instance crates", { timeout: 300_000 }, async () => {
  const { acmeTelemetryCapability } = await import("../../helpers/rust-session.mjs");
  const { result } = compileRust({
    packages: [acmeSuperbunapiCapability(), acmeTelemetryCapability(), acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "multi_cap" } },
    files: {
      "index.ts": `
import { serve } from "superbunapi";
import { createMeter } from "telemetry";
import { check } from "@acme/testing";

export function main(): void {
  check(serve(8080) === "superbunapi:8080");
  let counted = false;
  try {
    const meter = createMeter("m");
    meter.total();
    counted = true;
  } catch (error) {
    counted = false;
  }
  check(counted);
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const manifest = artifactText(result, "Cargo.toml");
  for (const crate of ["acme_superbunapi", "acme_telemetry", "acme_testing"]) {
    assert.equal(manifest.split("\n").filter((line) => line.startsWith(`${crate} = `)).length, 1,
      `${crate} must have one direct path dependency and no inferred registry patch`);
  }
  const run = validateGeneratedProject("multi-cap-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("fallible property rows propagate through a capability binary", { timeout: 300_000 }, async () => {
  const { acmeLogsinkCapability } = await import("../../helpers/rust-session.mjs");
  const { result } = compileRust({
    packages: [acmeLogsinkCapability(), acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "logsink_proof" } },
    files: {
      "index.ts": `
import { openSink, openSinkNamed } from "logsink";
import { check } from "@acme/testing";

export function main(): void {
  const sink = openSink();
  sink.write("hello");
  const named = openSinkNamed("app");
  named.write("x");
  let location = "";
  try {
    location = sink.path;
  } catch (error) {
    location = "?";
  }
  check(location === "/var/log/acme.log");
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /sink\.path\(\)\?/u);
  // Row metadata is emitted verbatim: no recasing of capability API names.
  assert.match(artifactText(result, "src/index.rs"), /acme_logsink::openSinkNamed\("app"\)/u);
  const run = validateGeneratedProject("logsink-proof-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});
