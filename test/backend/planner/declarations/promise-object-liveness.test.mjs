import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustSourceFilePlanContext } from "../../../helpers/plan-context.mjs";
import { planFunctionDeclarations } from "../../../../dist/backend/planner/declarations/callables/functions.js";

for (const [label, use, objectUsed] of [
  ["native body only", "console.log(await run());", false],
  ["live stored Promise", "const pending = run(); console.log(await pending);", true],
  ["dead stored Promise caller", "function unused() { const pending = run(); return pending; } console.log(await run());", false],
]) {
  test(`native and Promise-object roles keep independent dead-code syntax for ${label}`, () => {
    const { program } = analyzeRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": `export async function run(): Promise<number> { return 7; } ${use}` } });
    const ast = program.source.ast;
    const declaration = ast.statements(program.sourceFiles[0]).find(node => ast.is.IsFunctionDeclaration(node) &&
      ast.text(ast.name(node)) === "run");
    assert.equal(declaration !== undefined, true, "the exact authored async callable is present");
    const emission = program.records.callableDeclaration.get(declaration);
    assert.equal(emission.nativeBody !== undefined && emission.promiseObject, true, "both selected native roles remain emitted");
    assert.equal(emission.promiseObjectDeadCode, objectUsed ? undefined : "authored-declaration", "the actual role producer selects adapter liveness");
    const items = planFunctionDeclarations(declaration, rustSourceFilePlanContext(program, declaration));
    const native = items.find(item => item.kind === "function" && item.name === emission.nativeBody.name);
    const adapter = items.find(item => item.kind === "function" && item.name === emission.name);
    assert.equal(native !== undefined && adapter !== undefined, true, "the canonical item plan preserves both roles");
    assert.equal(native.deadCode, emission.deadCode, "the used native body retains only its own selected disposition");
    assert.equal(adapter.deadCode, emission.promiseObjectDeadCode, "the adapter never borrows the native body's disposition");
  });
}
