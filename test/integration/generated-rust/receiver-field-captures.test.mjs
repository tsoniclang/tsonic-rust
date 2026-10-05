import assert from "node:assert/strict";
import test from "node:test";
import { receiverFieldCapturesSource } from "../../../../tsonic/test/fixtures/receiver-field-captures.mjs";
import { receiverFieldCaptureEdges } from "../../../../tsonic/test/fixtures/receiver-field-capture-edges.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surface of ["native", "js"]) {
  test(`native receiver field owners preserve escaped, inherited, generic and replaced storage in ${surface}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: surface === "native" ? [] : ["js"],
      target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": receiverFieldCapturesSource +
        '\nexport function main(): void { if (!run()) throw new Error("receiver field owners"); }' } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 6).map(row => row.message.slice(0, 256)).join("\n"));
    assert.equal(/unsafe\s*\{|MaybeUninit|assume_init|transmute|downcast_unchecked/u.test([...result.artifacts.values()].join("\n")), false);
    validateGeneratedProject(`receiver-field-captures-${surface}`, result.artifacts, { run: true });
  });
}

for (const example of receiverFieldCaptureEdges) for (const surfaces of [[], ["js"]]) {
  test(`receiver field edge ${example.name} in ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const main = example.asynchronous
      ? '\nexport async function main(): Promise<void> { if (!await run()) throw new Error("receiver field edge"); }'
      : '\nexport function main(): void { if (!run()) throw new Error("receiver field edge"); }';
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": example.source + main } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 6).map(row => row.message.slice(0, 256)).join("\n"));
    validateGeneratedProject(`receiver-field-${example.name}`, result.artifacts, { run: true });
  });
}
