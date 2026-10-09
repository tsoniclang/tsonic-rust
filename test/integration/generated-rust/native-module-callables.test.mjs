import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { conflictingNativeCallableSource, nativeModuleCallableFiles, relocatedModuleCallableFiles } from "../../../../tsonic/test/fixtures/native-module-callables.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`relocated callable bodies retain exact module owners on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: {
      ...relocatedModuleCallableFiles,
      "index.ts": relocatedModuleCallableFiles["index.ts"] + '\nexport function main(): void { if (!run()) throw new Error("relocated module owner"); }',
    } });
    assertNoTargetDiagnostics(result.diagnostics);
    validateGeneratedProject("relocated-module-callables", result.artifacts, { run: true });
  });
  test(`private native callable adapters do not retain module initialization on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: {
      "index.ts": `const original = (): number => 9;
export function main(): void {
  const selected: (value?: number) => number = original;
  if (selected() !== 9 || selected(2) !== 9) throw new Error("native direct adapter");
}`,
    } });
    assertNoTargetDiagnostics(result.diagnostics);
    const output = artifactText(result, "src/index.rs");
    assert.doesNotMatch(output, /ModuleCell|OnceLock|OnceCell|INITIALIZED/u);
    validateGeneratedProject("private-native-callable-adapters", result.artifacts, { run: true });
  });
  test(`typed native module callables retain checked body ABIs on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: {
      ...nativeModuleCallableFiles,
      "index.ts": nativeModuleCallableFiles["index.ts"] + '\nexport async function main(): Promise<void> { if (!await run()) throw new Error("module callable contract"); }',
    } });
    assertNoTargetDiagnostics(result.diagnostics);
    const output = artifactText(result, "src/api.rs");
    assert.match(output, surfaces.length === 0 ? /pub async fn exact\(value: i64\) -> i64/u
      : /pub fn exact\(value: i64\) -> js_abi::JsPromise<'static, i64, rt::TsonicError>/u);
    assert.match(output, /pub fn unsigned\(value: u64\) -> u64/u);
    assert.doesNotMatch(output, /ModuleCell|GenericCallable|CallableEnvironment|Box::pin/u);
    if (surfaces.length === 0) {
      assert.match(output, /pub fn count\(value: &str\)/u);
      const calls = artifactText(result, "src/index.rs");
      assert.doesNotMatch(calls, /count\(text\.clone\(\)\)/u);
    }
    validateGeneratedProject("typed-native-module-callables", result.artifacts, { run: true });
  });
  test(`inherited callable contracts reject conflicting native widths on ${surfaces[0] ?? "native"}`, () => {
    const { result } = compileRust({ surfaces, files: { "index.ts": conflictingNativeCallableSource } });
    assert.ok(result.diagnostics.length > 0);
    assert.equal(result.artifacts.length, 0);
  });
}
