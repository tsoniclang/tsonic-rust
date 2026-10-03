import assert from "node:assert/strict";
import test from "node:test";
import { authoredBroadOverloadsSource } from "../../../../tsonic/test/fixtures/authored-broad-overloads.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`authored broad overloads preserve native class identity on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const name = `authored_broad_overloads_${surfaces[0] ?? "native"}`;
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: name } },
      files: { "index.ts": `${authoredBroadOverloadsSource}
        export function main(): void { if (!run()) throw new Error("authored broad overload"); }` },
    });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
    validateGeneratedProject(name, result.artifacts, { run: true });
  });
}
