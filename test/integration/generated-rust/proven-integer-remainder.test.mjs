import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { integerRemainderCases, integerRemainderExecutionSource } from "../../../../tsonic/test/fixtures/proven-integer-remainder.mjs";

test("proven integer remainder preserves all number results and rejects uncertain numeric selections", { timeout: 300_000 }, () => {
  const files = { "index.ts": `${integerRemainderExecutionSource()}\nexport function main(): void { if (!run()) throw new Error("integer remainder"); }` };
  const options = { files, surfaces: ["js"], target: { id: "rust", options: { outputType: "bin", crateName: "integer_remainder_proof" } } };
  const analysis = analyzeRust(options);
  const { ast } = analysis.source;
  for (const entry of integerRemainderCases) {
    const declaration = analysis.program.sourceFiles.flatMap(file => ast.statements(file)).find(node =>
      ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === entry.name);
    assert.ok(declaration, entry.name);
    let selected = 0;
    const visit = node => {
      if (analysis.program.numericRepresentations.usesInt32Remainder(node)) selected++;
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    visit(declaration);
    assert.equal(selected, entry.selected, entry.name);
  }
  const { result } = compileRust(options);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.artifacts.some(artifact => artifact.path.endsWith(".rs") && artifact.text.includes("as i32")));
  validateGeneratedProject("proven-integer-remainder", result.artifacts, { run: true });
});
