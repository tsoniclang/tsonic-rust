import assert from "node:assert/strict";
import test from "node:test";
import { deferredCapturesSource } from "../../../../tsonic/test/fixtures/deferred-captures.mjs";
import { analyzeRust, compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { rustBindingStorageFactKey } from "../../../dist/analysis/facts/keys.js";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("deferred storage is sealed once per exact lexical activation", () => {
  const { source, program } = analyzeRust({ files: { "index.ts": deferredCapturesSource } });
  const ast = source.ast;
  const file = source.sourceFiles.find(file => ast.getFileName(file) === "/src/index.ts");
  assert.equal(file !== undefined, true);
  const run = ast.statements(file).find(statement => {
    const name = ast.name(statement);
    return name !== undefined && ast.text(name) === "run";
  });
  assert.equal(run !== undefined, true);
  const scope = ast.body(run);
  const declarations = program.captureStorage.deferredForScope(scope);
  assert.equal(declarations.length, 2);
  assert.equal(Object.isFrozen(declarations), true);
  assert.equal(program.captureStorage.deferredForScope(scope) === declarations, true);
  assert.equal(program.captureStorage.deferredForScope(file).length, 0);
  for (const declaration of declarations) {
    const fact = program.facts.getFact(declaration, rustBindingStorageFactKey);
    assert.equal(fact?.storage, "location");
    assert.equal(fact?.initialization, "deferred");
  }
});

for (const surfaces of [[], ["js"]]) {
  test(`deferred captures retain one initialized native activation on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const name = `deferred_captures_${surfaces[0] ?? "native"}`;
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: name } },
      files: { "index.ts": `${deferredCapturesSource}
        export function main(): void { if (!run()) throw new Error("deferred captures"); }` },
    });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
    const source = artifactText(result, "src/index.rs");
    assert.equal((source.match(/Location::uninitialized/gu) ?? []).length, 2);
    assert.doesNotMatch(source, /initialized:\s*rt::Location/u);
    validateGeneratedProject(name, result.artifacts, { run: true });
  });
}
