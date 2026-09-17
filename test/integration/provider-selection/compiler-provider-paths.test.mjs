import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust, nodejsCapability } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("compiler filesystem provider accepts byte paths and preserves native metadata", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "compiler_provider_paths" } },
    files: { "index.ts": `
import { Buffer } from "node:buffer";
import { constants, closeSync, openSync, writeSync, statSync, lstatSync, readdirSync, mkdirSync, rmSync, rmdirSync, utimesSync, mkdtempSync } from "node:fs";
import type { Dirent } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check } from "@acme/testing";
function isFile(entry: Dirent<Buffer>): boolean { return entry.isFile() && !entry.isSocket(); }
export function main(): void {
  const root = mkdtempSync(join(tmpdir(), "compiler-paths-"));
  const rootBytes = Buffer.from(root);
  const path = Buffer.from(join(root, "file"));
  const missing = Buffer.from(join(root, "missing"));
  check(statSync(missing, { throwIfNoEntry: false }) === undefined);
  check(lstatSync(missing, { throwIfNoEntry: false }) === undefined);
  const fd = openSync(path, constants.O_CREAT | constants.O_WRONLY | constants.O_TRUNC, 384);
  check(writeSync(fd, Buffer.from("content"), 0, 7, null) === 7);
  closeSync(fd);
  utimesSync(path, 1700000000.25, 1700000001.5);
  const stats = statSync(path, { throwIfNoEntry: false });
  if (stats === undefined) { throw new Error("missing created file"); }
  check(stats.size === 7 && stats.mtimeMs === 1700000001500);
  check((stats.mode & 511) === 384);
  check(lstatSync(path).isFile());
  const entries = readdirSync(rootBytes, { withFileTypes: true, encoding: "buffer" });
  check(entries.length === 1);
  check(isFile(entries[0]));
  check(entries[0].name.toString("utf8") === "file");
  const directory = Buffer.from(join(root, "nested"));
  mkdirSync(directory, { recursive: true, mode: 448 });
  check(statSync(directory).isDirectory());
  rmdirSync(directory);
  rmSync(path);
  rmSync(rootBytes, { recursive: true, force: true });
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("compiler-provider-paths", result.artifacts, { run: true });
});

test("compiler filesystem provider does not invent unsupported result carriers", async () => {
  const capability = await nodejsCapability();
  for (const source of [
    'statSync("file", { bigint: true });',
    'readdirSync("path", { withFileTypes: false, encoding: "buffer" });',
    'readdirSync("path", { withFileTypes: true, encoding: "utf8" });',
  ]) {
    assert.throws(() => compileRust({
      surfaces: ["js"], capabilities: [capability],
      files: { "index.ts": 'import { statSync, readdirSync } from "node:fs"; export function invalid(): void { ' + source + ' }' },
    }), /TS2769/u);
  }
});
