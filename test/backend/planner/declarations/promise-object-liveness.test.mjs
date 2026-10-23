import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { rustSourceFilePlanContext } from "../../../helpers/plan-context.mjs";
import { planFunctionDeclarations } from "../../../../dist/backend/planner/declarations/callables/functions.js";
import { planProjectMethodVariants } from "../../../../dist/backend/planner/declarations/classes/methods.js";

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

for (const isStatic of [false, true]) {
  for (const [label, use, objectUsed] of [
    ["native body only", "console.log(await service.run());", false],
    ["live stored Promise", "const pending = service.run(); console.log(await pending);", true],
    ["dead stored Promise caller", "function unused() { const pending = service.run(); return pending; } console.log(await service.run());", false],
  ]) {
    test(`${isStatic ? "static" : "instance"} Promise methods retain their own role liveness for ${label}`, () => {
      const { program } = analyzeRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
        files: { "index.ts": `class Service { ${isStatic ? "static " : ""}async run(): Promise<number> { return 7; } }
          ${isStatic ? "" : "const service = new Service();"} ${isStatic ? use.replaceAll("service.", "Service.") : use}` } });
      const ast = program.source.ast;
      const methods = [];
      const visit = node => {
        if (ast.is.IsMethodDeclaration(node) && ast.text(ast.name(node)) === "run") methods.push(node);
        ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
      };
      visit(program.sourceFiles[0]);
      assert.equal(methods.length, 1, "the checked authored method has one declaration");
      const declaration = methods[0];
      const emission = program.records.callableDeclaration.get(declaration);
      assert.equal(emission.nativeBody !== undefined && emission.promiseObject, true,
        "the method has a native-body role and a distinct Promise-object adapter role");
      assert.equal(emission.promiseObjectDeadCode, objectUsed ? undefined : "authored-declaration",
        "method adapter use is selected by the same reachability owner as function adapter use");
      const items = planProjectMethodVariants(declaration, rustSourceFilePlanContext(program, declaration));
      const variants = program.records.methodDeclaration.get(declaration).variants;
      const nativeVariant = variants.find(variant => variant.promiseBody);
      const adapterVariant = variants.find(variant => !variant.promiseBody);
      assert.equal(nativeVariant !== undefined && adapterVariant !== undefined, true,
        "method role names come from the sealed method inventory, including any owner prefix");
      const native = items.find(item => item.name === nativeVariant.name);
      const adapter = items.find(item => item.name === adapterVariant.name);
      assert.equal(native !== undefined && adapter !== undefined, true, "both already-selected method roles remain emitted");
      assert.equal(native.deadCode, emission.deadCode, "the native method uses only its own disposition");
      assert.equal(adapter.deadCode, emission.promiseObjectDeadCode, "the Promise-object method uses only its own disposition");
    });
  }
}
