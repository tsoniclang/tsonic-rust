import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { callableInterfaceFiles, asyncCallableInterfaceFiles, nativeAsyncCallableFiles, inlineNativeAsyncCallableFiles, nonErasedCallableInterfaces } from "../../../../tsonic/test/fixtures/callable-interfaces.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`callable interfaces retain exact native signatures on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: {
      ...callableInterfaceFiles,
      "index.ts": callableInterfaceFiles["index.ts"] + '\nexport function main(): void { if (!run()) throw new Error("callable interface"); }',
    } });
    assertNoTargetDiagnostics(result.diagnostics);
    validateGeneratedProject("callable-interfaces", result.artifacts, { run: true });
  });
  test(`callable interfaces retain async results and one absence on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: {
      ...asyncCallableInterfaceFiles,
      "index.ts": asyncCallableInterfaceFiles["index.ts"] + '\nexport async function main(): Promise<void> { if (!await run()) throw new Error("async callable interface"); }',
    } });
    assertNoTargetDiagnostics(result.diagnostics);
    validateGeneratedProject("async-callable-interfaces", result.artifacts, { run: true });
  });
  test(`closed native async callables retain invocation timing and owner identity on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: {
      ...nativeAsyncCallableFiles,
      "index.ts": nativeAsyncCallableFiles["index.ts"] + '\nexport async function main(): Promise<void> { if (!await run()) throw new Error("native callable ownership"); }',
    } });
    assertNoTargetDiagnostics(result.diagnostics);
    validateGeneratedProject("native-async-callable-ownership", result.artifacts, { run: true });
    if (surfaces.length === 0) {
      const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
      const definitions = [...output.matchAll(/pub enum GenericCallable\w+\s*\{([^}]+)\}/gu)];
      assert.ok(definitions.some(([, body]) => /Rc<[^\n]*CallableEnvironment/u.test(body) &&
        /Implementation\w+\(crate::[^\n]*CallableEnvironment/u.test(body)));
      assert.doesNotMatch(output, /Box::pin|JsPromise/u);
    }
  });
  test(`pure closed async callables retain inline native storage on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: {
      ...inlineNativeAsyncCallableFiles,
      "index.ts": inlineNativeAsyncCallableFiles["index.ts"] + '\nexport async function main(): Promise<void> { if (!await run()) throw new Error("inline async callable"); }',
    } });
    assertNoTargetDiagnostics(result.diagnostics);
    validateGeneratedProject("inline-native-async-callables", result.artifacts, { run: true });
    if (surfaces.length === 0) {
      const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
      assert.match(output, /impl Copy for GenericCallable/u);
      assert.doesNotMatch(output, /(?:Rc|Arc)<[^\n]*CallableEnvironment|Box::pin|JsPromise/u);
      assert.doesNotMatch(output, /enum CallableFuture/u);
    }
  });
}

test("callable interface representation cannot erase extra contracts", () => {
  for (const declaration of nonErasedCallableInterfaces) {
    const { result } = compileRust({ files: { "index.ts": `${declaration}
export function apply(callback: Callback): number { return callback(2); }` } });
    assert.ok(result.diagnostics.length > 0);
    assert.equal(result.artifacts.length, 0);
  }
});
