import { test } from "node:test";
import assert from "node:assert/strict";
import { acmeSuperbunapiCapability, acmeTestingPackage, artifactText, compileRust } from "./helpers/rust-session.mjs";
import { composeRustCapabilities } from "../dist/index.js";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

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
  const second = acmeSuperbunapiCapability();
  assert.throws(
    () => composeRustCapabilities("rust", [first, second]),
    /Ambiguous Tsonic capability ownership/u,
  );
});

test("wrong-target capabilities fail closed in local composition", async () => {
  const capability = { ...acmeSuperbunapiCapability(), targetId: "csharp" };
  assert.throws(
    () => composeRustCapabilities("rust", [capability]),
    /targets 'csharp', not selected target 'rust'/u,
  );
});

test("simulated installed layout resolves target runtime crates end to end", { timeout: 300_000 }, async () => {
  const { cpSync, mkdirSync, rmSync, existsSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const layoutRoot = resolve(".temp/installed-target/node_modules/@tsonic/target-rust");
  rmSync(resolve(".temp/installed-target"), { recursive: true, force: true });
  mkdirSync(layoutRoot, { recursive: true });
  for (const entry of ["package.json", "runtimes"]) {
    cpSync(resolve(entry), resolve(layoutRoot, entry), { recursive: true });
  }
  // The packaged js crate's runtime dependency resolves inside the package.
  assert.ok(existsSync(resolve(layoutRoot, "runtimes/crates/tsonic_rust_js/Cargo.toml")));
  assert.ok(existsSync(resolve(layoutRoot, "runtimes/crates/tsonic_rust_runtime/Cargo.toml")));
  const { execFileSync } = await import("node:child_process");
  const metadata = execFileSync("cargo", [
    "metadata", "--no-deps", "--format-version", "1", "--offline",
    "--manifest-path", resolve(layoutRoot, "runtimes/crates/tsonic_rust_js/Cargo.toml"),
  ], { encoding: "utf8" });
  assert.ok(JSON.parse(metadata).packages.some((entry) => entry.name === "tsonic_rust_js"));
});

test("telemetry capability proves async and fallible rows through a runtime binary", { timeout: 300_000 }, async () => {
  const { acmeTelemetryCapability } = await import("./helpers/rust-session.mjs");
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
  const { acmeTelemetryCapability } = await import("./helpers/rust-session.mjs");
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
  const { acmeTelemetryCapability } = await import("./helpers/rust-session.mjs");
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
    assert.equal(manifest.split(`${crate} = `).length, 2, `${crate} appears exactly once`);
  }
  const run = validateGeneratedProject("multi-cap-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("fallible property rows propagate through a capability binary", { timeout: 300_000 }, async () => {
  const { acmeLogsinkCapability } = await import("./helpers/rust-session.mjs");
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
