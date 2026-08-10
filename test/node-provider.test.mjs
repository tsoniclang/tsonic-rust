import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acmeTestingPackage,
  artifactText,
  assertRustTargetRejection,
  compileRust,
  nodejsCapability,
} from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

test("node path and os lower through provider rows to tsonic_rust_node", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { join, dirname, basename, extname, isAbsolute } from "node:path";
import { platform, eol } from "node:os";

export function probe(dir: string, file: string): boolean {
  const full: string = join(dir, file);
  const parent: string = dirname(full);
  const name: string = basename(full);
  const ext: string = extname(name);
  return isAbsolute(full) && parent.length >= 0 && platform().length > 0 && eol().length > 0 && ext.length >= 0;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.doesNotMatch(text, /use tsonic_rust_node::path as node_path;/u);
  assert.match(text, /pub fn probe\(dir: &str, file: &str\)/u);
  assert.match(text, /tsonic_rust_node::path::join\(&\[dir, file\]\)/u);
  assert.match(text, /tsonic_rust_node::path::dirname\(&full\)/u);
  assert.match(text, /tsonic_rust_node::path::basename\(&full, None\)/u);
  assert.match(text, /tsonic_rust_node::os::platform\(\)/u);
  assert.match(text, /tsonic_rust_node::os::eol\(\)\.to_string\(\)/u);
  assert.match(artifactText(result, "Cargo.toml"), /tsonic_rust_node = \{ path = ".*rust-nodejs\/rust\/crates\/tsonic_rust_node" \}/u);
});

test("declared-but-unsupported node APIs diagnose deterministically", async () => {
  const options = {
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { watch } from "node:fs";

export function observe(path: string): void {
  watch(path);
}
`,
    },
  };
  assertRustTargetRejection(options, [{
    code: "RUST_PROVIDER_OPERATION_NOT_MAPPED",
    message: "No Rust operation row matches selected provider declaration 'tsonic.rust.provider-package.@tsonic/rust-nodejs.binding::tsonic.rust.node.fs::node:fs::watch::node:fs::watch(...)' as method.",
  }]);
});

test("node package requires the js surface", async () => {
  const capability = await nodejsCapability();
  assert.equal(capability.kind, "target-capability");
  assert.equal(capability.targetId, "rust");
  assert.deepEqual(capability.requiredSurfaces, ["js"]);
  assert.deepEqual(capability.moduleOwnership.map((entry) => entry.specifierPrefix ?? entry.moduleSpecifier).length > 0, true);
});

test("generated cargo binary proves node provider rows at runtime", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "r5_node_proof" } },
    files: {
      "index.ts": `
import { join, dirname, basename, extname, isAbsolute } from "node:path";
import { platform } from "node:os";
import { check } from "@acme/testing";

export function main(): void {
  const full: string = join("/tmp", "dir", "file.txt");
  check(full === "/tmp/dir/file.txt");
  check(dirname(full) === "/tmp/dir");
  check(basename(full) === "file.txt");
  check(extname(full) === ".txt");
  check(isAbsolute(full));
  check(!isAbsolute("relative.txt"));
  check(platform().length > 0);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const run = validateGeneratedProject("node-provider-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("async third-party provider rows lower through the same generic infrastructure", async () => {
  const { acmeDbPackage } = await import("./helpers/rust-session.mjs");
  const { result } = compileRust({
    packages: [acmeDbPackage()],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { connect } from "@acme/db";

export async function run_migration(path: string): Promise<int32> {
  const db = await connect(path);
  const first = await db.execute("create table items(id int)");
  const second = await db.execute("insert into items values (1)");
  return first + second;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const text = artifactText(result, "src/index.rs");
  assert.match(text, /pub async fn run_migration\(path: String\) -> i32/u);
  assert.match(text, /acme_db::connect\(path\)\.await/u);
  assert.match(text, /db\.execute\(String::from\("create table items\(id int\)"\)\)\.await/u);
  assert.match(artifactText(result, "Cargo.toml"), /acme_db = \{ path = /u);
});

test("generated cargo library proves the async provider lane compiles clean", { timeout: 300_000 }, async () => {
  const { acmeDbPackage } = await import("./helpers/rust-session.mjs");
  const { result } = compileRust({
    packages: [acmeDbPackage()],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { connect } from "@acme/db";

export async function run_migration(path: string): Promise<int32> {
  const db = await connect(path);
  return await db.execute("create table items(id int)");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("r5-async-provider-lib", result.artifacts);
});
