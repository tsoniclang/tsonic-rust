import assert from "node:assert/strict";
import test from "node:test";
import { booleanValueShortCircuitSource } from "../../../../tsonic/test/fixtures/boolean-value-short-circuit.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`native short-circuit execution retains branch order, one absence and exact width in ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: `short_circuit_${surfaces[0] ?? "native"}` } },
      files: { "index.ts": `${booleanValueShortCircuitSource}
export function main(): void {
  if (!run(true) || !run(false)) throw new Error("short-circuit result");
}
` } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(diagnostic => diagnostic.message).join("\n"));
    const executed = validateGeneratedProject(`boolean-value-short-circuit-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
    assert.equal(executed.status, 0, executed.stderr);
  });
}
