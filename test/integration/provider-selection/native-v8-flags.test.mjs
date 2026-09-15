import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust, createRustSession, nodejsCapability, rustSourceDiagnostics } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeV8FlagsSource } from "../../../../tsonic/test/fixtures/native-v8-flags.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`native V8 flags fail only on explicit invocation in ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, async () => {
    const { result } = compileRust({
      surfaces, packages: [acmeTestingPackage()], capabilities: [await nodejsCapability()],
      target: { id: "rust", options: { outputType: "bin", crateName: "native_v8_flags" } },
      files: { "index.ts": `${nativeV8FlagsSource}
import { check } from "@acme/testing";
export function main(): void { check(run()); }
` },
    });
    assert.deepEqual(result.diagnostics, []);
    assert.equal(validateGeneratedProject(`native-v8-flags-${surfaces[0] ?? "native"}`, result.artifacts, { run: true }).status, 0);
  });
}

for (const [name, source] of [
  ["non-string flags", 'import { setFlagsFromString } from "node:v8"; export function main(): void { setFlagsFromString(1); }'],
  ["missing flags", 'import { setFlagsFromString } from "node:v8"; export function main(): void { setFlagsFromString(); }'],
  ["unimplemented heap measurements", 'import { getHeapStatistics } from "node:v8"; export function main(): void { getHeapStatistics(); }'],
]) {
  test(`native V8 contract rejects ${name}`, async () => {
    const checked = createRustSession({ surfaces: ["js"], capabilities: [await nodejsCapability()],
      files: { "index.ts": source } });
    assert.notEqual(rustSourceDiagnostics(checked), "");
  });
}
