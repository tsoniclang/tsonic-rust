import assert from "node:assert/strict";
import test from "node:test";
import { fieldUnionFlowSource } from "../../../../tsonic/test/fixtures/field-union-flow.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`field union reads retain checked projections after mutation on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const name = `field_union_flow_${surfaces[0] ?? "native"}`;
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: name } },
      files: { "index.ts": `${fieldUnionFlowSource}
        export function main(): void { if (!run()) throw new Error("field union flow"); }` },
    });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
    const executed = validateGeneratedProject(name, result.artifacts, { run: true });
    assert.equal(executed.status, 0, executed.stderr);
  });
}
