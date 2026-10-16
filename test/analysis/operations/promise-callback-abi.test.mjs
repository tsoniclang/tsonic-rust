import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { rustCallableProtocol, rustJsValueTargetType } from "../../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

for (const [name, body] of [
  ["then", "return await Promise.resolve(1).then(value => value + 1);"],
  ["catch", "return await Promise.reject<number>(new Error('failure')).catch(reason => 2);"],
  ["finally", "return await Promise.resolve(1).finally(() => { const done = 1; });"],
  ["caught await", "try { return await Promise.reject<number>('value'); } catch (error) { return 2; }"],
]) {
  test(`Promise ${name} publishes and renders its actual rejection protocol`, () => {
    const { result } = compileRust({ surfaces: ["js"], files: { "index.ts":
      `export async function action(): Promise<number> { ${body} }` } });
    const diagnostics = result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`);
    assert.deepEqual(diagnostics, []);
    const source = rustSourceText(result);
    assert.equal(source.includes("JsPromise<f64>"), true);
    assert.equal(source.includes("JsPromise<'"), false);
    if (name === "caught await") {
      assert.equal(source.includes(".into_error()"), true);
      assert.equal(source.includes("::ClosedJs("), true);
      assert.equal(source.includes("::Retained("), true);
    }
  });
}

test("Promise callback contexts select their physical rejection type before the seal", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
    export async function action(): Promise<number> {
      return await Promise.resolve(1).then(value => { if (value < 0) throw new Error("negative"); return value + 1; });
    }
  ` } });
  const nodes = [];
  const visit = node => { nodes.push(node); program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  program.sourceFiles.forEach(visit);
  const callback = nodes.find(node => program.source.ast.is.IsArrowFunction(node));
  assert.equal(callback !== undefined, true);
  const carrier = program.records.runtimeCarrier.get(callback)?.carrier;
  assert.equal(rustTargetTypeRefEquals(rustCallableProtocol(carrier)?.error, rustJsValueTargetType()), true);
  const region = program.errorRegions.get(callback);
  assert.equal(region?.jsRejection !== undefined, true);
  const reference = program.callableValues.nativeProducers.errorFor(callback, "invoke");
  assert.equal(reference?.kind, "target-specific");
  assert.equal(rustTargetTypeRefEquals(program.errorRegions.producerError(reference.value), rustJsValueTargetType()), true);
});
