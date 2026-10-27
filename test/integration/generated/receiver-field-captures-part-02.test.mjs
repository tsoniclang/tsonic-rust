import assert from "node:assert/strict";
import test from "node:test";
import { receiverFieldCapturesSource } from "../../../../tsonic/test/fixtures/receiver-field-captures.mjs";
import { receiverFieldCaptureEdges, receiverFieldFreezeSource, receiverFieldFreezeEdges } from "../../../../tsonic/test/fixtures/receiver-field-capture-edges.mjs";
import { compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { genericCallableOwnershipCases } from "../../../../tsonic/test/fixtures/generic-callable-ownership.mjs";

for (const example of ([...receiverFieldCaptureEdges, ...receiverFieldFreezeEdges]).slice(5, 6)) for (const surfaces of (receiverFieldFreezeEdges.includes(example) ? [["js"]] : [[], ["js"]]).slice(1, 2)) {
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

for (const example of ([...receiverFieldCaptureEdges, ...receiverFieldFreezeEdges]).slice(6, 13)) for (const surfaces of (receiverFieldFreezeEdges.includes(example) ? [["js"]] : [[], ["js"]]).slice(0, 2)) {
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
