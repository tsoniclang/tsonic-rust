import assert from "node:assert/strict";
import test from "node:test";
import { logicalAccessAssignmentSource } from "../../../../../tsonic/test/fixtures/logical-access-assignment.mjs";
import { compileRust } from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

for (const surfaces of [undefined, ["js"]]) {
  test(`logical accessor assignments preserve both lanes and short-circuit effects in ${surfaces?.[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: "logical_access_assignment" } },
      files: { "index.ts": `${logicalAccessAssignmentSource}
export function main(): void { if (!run()) throw new Error("logical accessor assignment contract"); }` },
    });
    assert.deepEqual(result.diagnostics, []);
    assert.equal(validateGeneratedProject(`logical-access-${surfaces?.[0] ?? "native"}`, result.artifacts, { run: true }).status, 0);
  });
}
