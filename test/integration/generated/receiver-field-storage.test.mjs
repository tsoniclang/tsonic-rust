import assert from "node:assert/strict";
import test from "node:test";
import { receiverFieldStorageCases, receiverFieldStorageFreezeSource } from "../../../../tsonic/test/fixtures/receiver-field-storage-cases.mjs";
import { compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) for (const example of receiverFieldStorageCases) {
  test(`live stored fields preserve direct structural views and reentrancy: ${example.name} in ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": example.source + '\nexport function main(): void { if (!run()) throw new Error("retained structural field"); }\nmain();\n' } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 6).map(row => row.message.slice(0, 256)).join("\n"));
    assert.equal(/unsafe\s*\{|MaybeUninit|assume_init|transmute|downcast_unchecked/u.test(rustSourceText(result)), false);
    validateGeneratedProject(`receiver-field-storage-${example.name}-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });
}

test("readonly identity retains live writes through a mutable alias", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": receiverFieldStorageFreezeSource + '\nexport function main(): void { if (!run()) throw new Error("retained structural mutable alias"); }\nmain();\n' } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 6).map(row => row.message.slice(0, 256)).join("\n"));
  validateGeneratedProject("receiver-field-storage-readonly-alias", result.artifacts, { run: true });
});
