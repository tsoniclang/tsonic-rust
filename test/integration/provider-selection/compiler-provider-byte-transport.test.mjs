import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust, nodejsCapability } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("compiler provider Buffer arguments and returns preserve typed-array aliases", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()], capabilities: [await nodejsCapability()],
    target: { id: "rust", options: { outputType: "bin", crateName: "provider_byte_transport" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
import { Buffer } from "node:buffer";
import { gzipSync, gunzipSync, deflateRawSync, inflateRawSync } from "node:zlib";
function bytes(value: Buffer): Uint8Array { return value; }
function change(value: Uint8Array): void { value[1] = 9; }
function read(value: Uint8Array): number { return value[0] + value[1] + value[2]; }
export function main(): void {
  const original = Buffer.from([91, 1, 2, 3, 92]);
  const selected = original.subarray(1, 4);
  const alias = bytes(selected);
  selected.writeUInt8(7, 0);
  check(alias[0] === 7);
  change(selected);
  check(selected.readUInt8(1) === 9 && original.readUInt8(2) === 9);
  alias[2] = 8;
  check(read(selected) === 24 && original.readUInt8(0) === 91 && original.readUInt8(4) === 92);
  check(selected[0] === 7 && selected.byteLength === 3);
  check(alias.byteLength === 3 && alias.byteOffset === 1);
  const data = new DataView(alias.buffer, alias.byteOffset, alias.byteLength);
  check(data.byteLength === 3 && data.byteOffset === 1 && data.buffer.byteLength === 5);
  selected[0] = 6;
  check(alias[0] === 6);
  selected[0] = 7;
  const copied = Buffer.from(alias);
  alias[0] = 4;
  check(copied.readUInt8(0) === 7 && selected.readUInt8(0) === 4);
  const compressed: Uint8Array = gzipSync(alias);
  const restored: Uint8Array = gunzipSync(compressed);
  check(read(restored) === 21);
  const raw: Uint8Array = deflateRawSync(alias);
  check(read(inflateRawSync(raw)) === 21);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.artifacts.some(artifact => artifact.text.includes("Buffer::as_uint8_array")));
  validateGeneratedProject("compiler-provider-byte-transport", result.artifacts, { run: true });
});
