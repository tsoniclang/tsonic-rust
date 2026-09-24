import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust, nodejsCapability } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeNodeSpawnSource, incompatibleNodeStdioSource } from "../../../../tsonic/test/fixtures/native-node-spawn.mjs";

test("shared Node spawn proof preserves byte views, options and absent results", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()], capabilities: [await nodejsCapability()],
    target: { id: "rust", options: { outputType: "bin", crateName: "shared_provider_spawn" } },
    files: { "index.ts": `${nativeNodeSpawnSource(process.execPath)}
      import { check } from "@acme/testing";
      export function main(): void { check(run()); }
    ` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("shared-provider-spawn", result.artifacts, { run: true });
});

test("compiler subprocess options preserve child state and binary results", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()], capabilities: [await nodejsCapability()],
    target: { id: "rust", options: { outputType: "bin", crateName: "provider_spawn" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
import { spawnSync } from "node:child_process";
import type { SpawnSyncOptionsWithBufferEncoding } from "node:child_process";
import type { ProcessEnv } from "node:process";
export function main(): void {
  const environment: ProcessEnv = {};
  environment["TSONIC_CHILD_EXACT"] = "only-child";
  const options: SpawnSyncOptionsWithBufferEncoding = { encoding: "buffer", maxBuffer: 4096 };
  options.cwd = "/";
  options.env = environment;
  options.input = new Uint8Array([0, 255, 42]);
  const stdio: Array<"pipe" | "ignore" | number | null | undefined> = ["pipe", "ignore", "pipe"];
  options.stdio = stdio;
  stdio[1] = "pipe";
  const result = spawnSync("/bin/cat", [], options);
  check(result.status === 0);
  check(result.pid !== undefined);
  check(result.signal === null);
  check(result.error === undefined);
  const output = result.stdout;
  if (output === null) throw new Error("missing output");
  check(output.length === 3);
  check(output[0] === 0 && output[1] === 255 && output[2] === 42);
  const missing = spawnSync("/nonexistent/tsonic/spawn", []);
  check(missing.status === null && missing.pid === undefined);
  check(missing.stdout === null && missing.stderr === null);
  const error = missing.error;
  if (error === undefined) throw new Error("missing error");
  check(error.code === "ENOENT");
  check(error.message.length > 0);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("compiler-provider-spawn", result.artifacts, { run: true });
});

test("shared mutable arrays cannot silently widen their native element storage", async () => {
  const { result } = compileRust({ surfaces: ["js"], capabilities: [await nodejsCapability()],
    files: { "index.ts": incompatibleNodeStdioSource } });
  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_PROVIDER_SET_VALUE_MISMATCH"));
});
