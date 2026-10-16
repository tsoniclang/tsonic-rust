import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, rustSourceText } from "../../helpers/rust-session.mjs";

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
