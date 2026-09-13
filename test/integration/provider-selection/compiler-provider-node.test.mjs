import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust, nodejsCapability } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("compiler provider uses the selected Node process global and native byte order", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "compiler_provider_node" } },
    files: { "index.ts": `
import importedProcess from "node:process";
import { endianness } from "node:os";
import { check } from "@acme/testing";
export function exitWithStatus(): never { process.exit(23); }
export function main(): void {
  check(process.pid === importedProcess.pid);
  check(process.platform === importedProcess.platform);
  check(process.cwd() === importedProcess.cwd());
  const order = endianness();
  check(order === "LE" || order === "BE");
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const bytes = encoder.encode("aé😀z");
  check(bytes.length === 8 && bytes[0] === 97 && bytes[7] === 122);
  check(decoder.decode(bytes) === "aé😀z");
  const view = bytes.subarray(1, 7);
  check(decoder.decode(view) === "é😀");
  bytes[1] = 65;
  check(decoder.decode(view) === "A�😀");
  check(encoder.encode("").length === 0);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.artifacts.map(artifact => artifact.text).join("\n"), /fn exit_with_status\(\) -> !/u);
  validateGeneratedProject("compiler-provider-node", result.artifacts, { run: true });
});

test("Node Buffer decoding remains independent of the JavaScript source profile", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    capabilities: [await nodejsCapability()],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "native_provider_codec" } },
    files: { "index.ts": `
import { TextDecoder } from "node:util";
import { Buffer } from "node:buffer";
import { check } from "@acme/testing";
export function main(): void {
  check(new TextDecoder().decode(Buffer.from("é😀")) === "é😀");
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("native-provider-codec", result.artifacts, { run: true });
});
