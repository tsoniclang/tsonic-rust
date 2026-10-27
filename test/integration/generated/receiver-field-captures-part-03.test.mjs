import assert from "node:assert/strict";
import test from "node:test";
import { receiverFieldCapturesSource } from "../../../../tsonic/test/fixtures/receiver-field-captures.mjs";
import { receiverFieldCaptureEdges, receiverFieldFreezeSource, receiverFieldFreezeEdges } from "../../../../tsonic/test/fixtures/receiver-field-capture-edges.mjs";
import { compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { genericCallableOwnershipCases } from "../../../../tsonic/test/fixtures/generic-callable-ownership.mjs";

for (const example of ([...receiverFieldCaptureEdges, ...receiverFieldFreezeEdges]).slice(13, 19)) for (const surfaces of (receiverFieldFreezeEdges.includes(example) ? [["js"]] : [[], ["js"]]).slice(0, 1)) {
test(`receiver field edge ${example.name} in ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const main = example.asynchronous
      ? '\nexport async function main(): Promise<void> { if (!await run()) throw new Error("receiver field edge"); }\nawait main();\n'
      : '\nexport function main(): void { if (!run()) throw new Error("receiver field edge"); }\nmain();\n';
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": example.source + main } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 6).map(row => row.message.slice(0, 256)).join("\n"));
    validateGeneratedProject(`receiver-field-${example.name}`, result.artifacts, { run: true });
  });
}

for (const example of (genericCallableOwnershipCases).slice(0, 6)) for (const surfaces of ([[], ["js"]]).slice(0, 2)) {
test(`quantified callable ownership ${example.name} in ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": example.source + "\nmain();\n" } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 6).map(row => row.message.slice(0, 256)).join("\n"));
    assert.equal(/dyn Any|downcast_unchecked|transmute|unsafe\s*\{/u.test(rustSourceText(result)), false,
      `exact native quantified ownership ${example.name}`);
    validateGeneratedProject(`generic-callable-${example.name}-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });
}

for (const example of (genericCallableOwnershipCases).slice(6, 7)) for (const surfaces of ([[], ["js"]]).slice(0, 1)) {
test(`quantified callable ownership ${example.name} in ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": example.source + "\nmain();\n" } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 6).map(row => row.message.slice(0, 256)).join("\n"));
    assert.equal(/dyn Any|downcast_unchecked|transmute|unsafe\s*\{/u.test(rustSourceText(result)), false,
      `exact native quantified ownership ${example.name}`);
    validateGeneratedProject(`generic-callable-${example.name}-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });
}
