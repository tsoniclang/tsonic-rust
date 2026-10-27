import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust, createRustSession, nodejsCapability, rustSourceDiagnostics } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeV8FlagsSource } from "../../../../tsonic/test/fixtures/native-v8-flags.mjs";
import { nativeV8HeapSource } from "../../../../tsonic/test/fixtures/native-v8-heap.mjs";

for (const surfaces of ([[], ["js"]]).slice(0, 1)) {
test(`native V8 heap observations fail only on invocation in ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, async () => {
    const { result } = compileRust({
      surfaces, packages: [acmeTestingPackage()], capabilities: [await nodejsCapability()],
      target: { id: "rust", options: { outputType: "bin", crateName: "native_v8_heap" } },
      files: { "index.ts": (`${nativeV8HeapSource}
import { check } from "@acme/testing";
export function main(): void { check(run()); }
` + "\nmain();\n") },
    });
    assert.deepEqual(result.diagnostics, []);
    assert.equal(validateGeneratedProject(`native-v8-heap-${surfaces[0] ?? "native"}`, result.artifacts, { run: true }).status, 0);
  });
}
