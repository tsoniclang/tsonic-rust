import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";

function fixture(text, outputType = "bin") {
  const { program } = analyzeRust({ surfaces: ["js"], target: { id: "rust", options: { outputType } },
    files: { "index.ts": text } });
  assert.equal(program !== undefined, true, "the checked program is admitted");
  const { ast } = program.source;
  let declaration;
  const visit = node => {
    if (ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "run") declaration = node;
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(declaration !== undefined, true, "the authored declaration is retained");
  return { program, declaration, emission: program.records.callableDeclaration.get(declaration) };
}

for (const [label, use, objectUsed] of [
  ["direct native await", "console.log(await run());", false],
  ["erased direct-call alias", "const alias = run; console.log(await alias());", false],
  ["stored Promise call", "const pending = run(); console.log(await pending);", true],
  ["dead stored Promise caller", "function unused() { const pending = run(); return pending; } console.log(await run());", false],
]) {
  test(`authored Promise object liveness distinguishes ${label}`, () => {
    const current = fixture(`export async function run(): Promise<number> { return 7; } ${use}`);
    assert.equal(current.program.promiseBodies.objects.has(current.declaration), true, "the authored export adapter remains retained");
    assert.equal(current.program.reachability.usedPromiseObjects.has(current.declaration), objectUsed, "only actual reachable object-facet uses root the adapter");
    assert.equal(current.emission.promiseObjectDeadCode, objectUsed ? undefined : "authored-declaration", "the adapter has its own sealed disposition");
    assert.equal(current.emission.deadCode, undefined, "the native body remains used");
  });
}

test("public package Promise adapters remain externally usable without a local call", () => {
  const current = fixture("export async function run(): Promise<number> { return 7; }", "lib");
  assert.equal(current.program.reachability.usedPromiseObjects.has(current.declaration), true, "the real public facade is an object-facet root");
  assert.equal(current.emission.promiseObjectDeadCode, undefined, "the public adapter is not unused");
  assert.equal(current.emission.deadCode, undefined, "the public native body remains available");
});
