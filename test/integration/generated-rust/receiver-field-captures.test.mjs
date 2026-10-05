import assert from "node:assert/strict";
import test from "node:test";
import { receiverFieldCapturesSource } from "../../../../tsonic/test/fixtures/receiver-field-captures.mjs";
import { receiverFieldCaptureEdges, receiverFieldFreezeSource, receiverFieldFreezeEdges } from "../../../../tsonic/test/fixtures/receiver-field-capture-edges.mjs";
import { compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { genericCallableOwnershipCases } from "../../../../tsonic/test/fixtures/generic-callable-ownership.mjs";

for (const surface of ["native", "js"]) {
  test(`native receiver field owners preserve escaped, inherited, generic and replaced storage in ${surface}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: surface === "native" ? [] : ["js"],
      target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": receiverFieldCapturesSource +
        '\nexport function main(): void { if (!run()) throw new Error("receiver field owners"); }' } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 6).map(row => row.message.slice(0, 256)).join("\n"));
    assert.equal(/unsafe\s*\{|MaybeUninit|assume_init|transmute|downcast_unchecked/u.test(rustSourceText(result)), false);
    validateGeneratedProject(`receiver-field-captures-${surface}`, result.artifacts, { run: true });
  });
}

test("retained receiver field writes preserve the selected object's freeze identity", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": receiverFieldFreezeSource +
      '\nexport function main(): void { if (!run()) throw new Error("retained field freeze identity"); }' } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 6).map(row => row.message.slice(0, 256)).join("\n"));
  validateGeneratedProject("receiver-field-freeze", result.artifacts, { run: true });
});

for (const example of [...receiverFieldCaptureEdges, ...receiverFieldFreezeEdges]) for (const surfaces of receiverFieldFreezeEdges.includes(example) ? [["js"]] : [[], ["js"]]) {
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

for (const example of genericCallableOwnershipCases) for (const surfaces of [[], ["js"]]) {
  test(`quantified callable ownership ${example.name} in ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": example.source } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 6).map(row => row.message.slice(0, 256)).join("\n"));
    assert.equal(/dyn Any|downcast_unchecked|transmute|unsafe\s*\{/u.test(rustSourceText(result)), false,
      `exact native quantified ownership ${example.name}`);
    validateGeneratedProject(`generic-callable-${example.name}-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
  });
}
