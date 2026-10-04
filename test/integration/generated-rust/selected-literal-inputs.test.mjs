import assert from "node:assert/strict";
import test from "node:test";
import { selectedLiteralInputsSource } from "../../../../tsonic/test/fixtures/selected-literal-inputs.mjs";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`selected literal inputs retain exact native carriers on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const name = `selected_literal_inputs_${surfaces[0] ?? "native"}`;
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: name } },
      files: { "index.ts": `${selectedLiteralInputsSource}
        export function main(): void { if (!run()) throw new Error("selected literals"); }` },
    });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
    const source = artifactText(result, "src/index.rs");
    assert.match(source, /select\(Selection::First\)/u);
    assert.match(source, /select\(Selection::Second\)/u);
    assert.doesNotMatch(source, /select\([^)]*to_string/u);
    validateGeneratedProject(name, result.artifacts, { run: true });
  });
}
