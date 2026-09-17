import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust, nodejsCapability } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("compiler provider realpath retains callable and native member identities", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()], capabilities: [await nodejsCapability()],
    target: { id: "rust", options: { outputType: "bin", crateName: "provider_realpath" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
import { realpathSync as resolvePath } from "node:fs";
import { Buffer } from "node:buffer";
export function main(): void {
  const text = resolvePath(".");
  const path = Buffer.from(".");
  check(text.length > 0 && resolvePath(path) === text);
  check(resolvePath.native(".") === text && resolvePath.native(path) === text);
  check(resolvePath(".", { encoding: "buffer" }).toString("utf8") === text);
  check(resolvePath(path, { encoding: "buffer" }).toString("utf8") === text);
  check(resolvePath.native(".", { encoding: "buffer" }).toString("utf8") === text);
  check(resolvePath.native(path, { encoding: "buffer" }).toString("utf8") === text);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("compiler-provider-realpath", result.artifacts, { run: true });
});
