import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust, nodejsCapability } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("compiler provider performs native descriptor IO through exact Uint8Array views", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "compiler_provider_files" } },
    files: { "index.ts": `
import { openSync, closeSync, readSync, writeSync, mkdtempSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import { check } from "@acme/testing";
function filePosition(useCursor: boolean): number | null { return useCursor ? null : 0; }
export function main(): void {
  const directory = mkdtempSync(join(tmpdir(), "compiler-files-"));
  const path = join(directory, "bytes.bin");
  const fd = openSync(path, "w+");
  const bytes = new Uint8Array(6);
  bytes[0] = 11;
  bytes[1] = 65;
  bytes[2] = 66;
  bytes[3] = 67;
  bytes[4] = 68;
  bytes[5] = 13;
  const view = bytes.subarray(1, 5);
  const copy = Buffer.from(view);
  check(copy.toString("utf8") === "ABCD");
  check(Buffer.compare(copy, Buffer.from("ABCD")) === 0);
  check(Buffer.compare(copy, Buffer.from("ABC")) > 0);
  check(Buffer.compare(copy, Buffer.from("Z")) < 0);
  check(writeSync(fd, view, 0, view.length, null) === 4);
  check(readSync(fd, view, 1, 2, 0) === 2);
  check(bytes[0] === 11 && bytes[1] === 65 && bytes[2] === 65 && bytes[3] === 66 && bytes[4] === 68 && bytes[5] === 13);
  const currentPosition = filePosition(true);
  check(readSync(fd, view, 0, 1, currentPosition) === 0);
  const positions: (number | null)[] = [0, null];
  check(readSync(fd, view, 0, 1, positions.pop() ?? null) === 0);
  check(positions.length === 1);
  check(copy.toString("utf8") === "ABCD");
  copy.writeUInt8(90, 0);
  check(bytes[1] === 65);
  check(writeSync(fd, view, 0, 1, 0) === 1);
  check(readSync(fd, view, 0, 1, null) === 0);
  closeSync(fd);
  unlinkSync(path);
  rmSync(directory, { recursive: true });
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = result.artifacts.map(artifact => artifact.text).join("\n");
  assert.match(output, /read_sync_uint8_number/u);
  assert.match(output, /write_sync_uint8_number/u);
  validateGeneratedProject("compiler-provider-files", result.artifacts, { run: true });
});

test("descriptor nullable positions reject unrelated source values", async () => {
  const capability = await nodejsCapability();
  for (const position of ["false", '"0"']) {
    assert.throws(() => compileRust({
      surfaces: ["js"],
      capabilities: [capability],
      files: { "index.ts": `
import { readSync } from "node:fs";
export function invalid(fd: number): number {
  return readSync(fd, new Uint8Array(1), 0, 1, ${position});
}
` },
    }), /TS2769/u, position);
  }
});
