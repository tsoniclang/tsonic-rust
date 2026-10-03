import assert from "node:assert/strict";
import test from "node:test";
import { lexicalFallibilitySource } from "../../../../tsonic/test/fixtures/lexical-fallibility.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`native lexical errors preserve transitive effects and caught identity in ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const name = `lexical_fallibility_${surfaces[0] ?? "native"}`;
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: name } },
      files: { "index.ts": `${lexicalFallibilitySource}
export function main(): void { if (!run()) throw new Error("lexical invocation effects"); }
` } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(value => value.message).join("\n"));
    const executed = validateGeneratedProject(name, result.artifacts, { run: true });
    assert.equal(executed.status, 0, executed.stderr);
  });
}
