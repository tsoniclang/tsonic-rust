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
export function main(): void {
  check(process.pid === importedProcess.pid);
  check(process.platform === importedProcess.platform);
  check(process.cwd() === importedProcess.cwd());
  const order = endianness();
  check(order === "LE" || order === "BE");
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("compiler-provider-node", result.artifacts, { run: true });
});
