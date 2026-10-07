import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { closedInstanceAdapterFiles, genericInstanceAdapterFiles } from "../../../../tsonic/test/fixtures/closed-instance-tests.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`native override results compose upcasts and union injection on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: {
      ...closedInstanceAdapterFiles, "index.ts": closedInstanceAdapterFiles["index.ts"] +
        '\nexport function main(): void { if (!run()) throw new Error("union override result"); }',
    } });
    assertNoTargetDiagnostics(result.diagnostics);
    validateGeneratedProject("union-upcast-adapters", result.artifacts, { run: true });
  });
}

for (const surfaces of [[], ["js"]]) {
  test(`generic override results retain optional storage on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: {
      ...genericInstanceAdapterFiles, "index.ts": genericInstanceAdapterFiles["index.ts"] +
        '\nexport function main(): void { if (!run()) throw new Error("generic override result"); }',
    } });
    assertNoTargetDiagnostics(result.diagnostics);
    validateGeneratedProject("generic-upcast-adapters", result.artifacts, { run: true });
  });
}
