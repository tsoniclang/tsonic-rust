import assert from "node:assert/strict";
import test from "node:test";
import { receiverOwnerCaptures } from "../../../../tsonic/test/fixtures/receiver-owner-captures.mjs";
import { compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const example of receiverOwnerCaptures) for (const surfaces of [[], ["js"]]) {
  test(`retained native receiver ${example.name} in ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const main = example.asynchronous
      ? '\nexport async function main(): Promise<void> { if (!await run()) throw new Error("receiver owner"); }'
      : '\nexport function main(): void { if (!run()) throw new Error("receiver owner"); }';
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": example.source + main } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 6).map(row => row.message.slice(0, 256)).join("\n"));
    assert.equal(/unsafe\s*\{|transmute|downcast_unchecked/u.test(rustSourceText(result)), false);
    validateGeneratedProject(`receiver-owner-${example.name}-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });
}
