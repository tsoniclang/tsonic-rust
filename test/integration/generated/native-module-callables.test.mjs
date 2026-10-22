import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { nativeFunction, nativeSource, nativeNodes, nativeType, nativeBorrow, assertNoNativeCalls } from "../../helpers/native-ast.mjs";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { conflictingNativeCallableSource, nativeModuleCallableFiles, relocatedModuleCallableFiles } from "../../../../tsonic/test/fixtures/native-module-callables.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`relocated callable bodies retain exact module owners on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: {
      ...relocatedModuleCallableFiles,
      "index.ts": relocatedModuleCallableFiles["index.ts"] + '\nexport function main(): void { if (!run()) throw new Error("relocated module owner"); }\nmain();\n',
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
}
main();
`,
    } });
    assertNoTargetDiagnostics(result.diagnostics);
    const output = artifactText(result, "src/index.rs");
    assert.doesNotMatch(output, /ModuleCell|OnceLock|OnceCell|INITIALIZED/u);
    validateGeneratedProject("private-native-callable-adapters", result.artifacts, { run: true });
  });
  test(`typed native module callables retain checked body ABIs on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } }, files: {
      ...nativeModuleCallableFiles,
      "index.ts": nativeModuleCallableFiles["index.ts"] + '\nexport async function main(): Promise<void> { if (!await run()) throw new Error("module callable contract"); }\nawait main();\n',
    } });
    assertNoTargetDiagnostics(result.diagnostics);
    const exact = nativeFunction(result, "exact", "src/api.rs");
    assert.equal(exact.visibility, "public");
    assert.deepEqual(exact.params.map(parameter => parameter.type), [nativeType("i64")]);
    if (surfaces.length === 0) {
      assert.equal(exact.isAsync, true);
      assert.deepEqual(exact.returnType, nativeType("i64"));
    } else {
      assert.equal(exact.isAsync === true, false);
      assert.equal(exact.returnType.path, "js_abi::JsPromise");
      assert.deepEqual(exact.returnType.genericArguments[0], { kind: "lifetime", lifetime: { kind: "static" } });
      assert.deepEqual(exact.returnType.genericArguments[1].type, nativeType("i64"));
      assert.equal(exact.returnType.genericArguments[2].type.identity, "tsonic-rust-runtime:TsonicError");
    }
    const unsigned = nativeFunction(result, "unsigned", "src/api.rs");
    assert.equal(unsigned.visibility, "public");
    assert.deepEqual(unsigned.params.map(parameter => parameter.type), [nativeType("u64")]);
    assert.deepEqual(unsigned.returnType, nativeType("u64"));
    const api = nativeSource(result, "src/api.rs");
    assert.equal(nativeNodes(api, node => node.kind === "named" &&
      ["ModuleCell", "GenericCallable", "CallableEnvironment"].includes(node.path.split("::").at(-1))).length, 0);
    assertNoNativeCalls(api, ["Box::pin"], "native module bodies need no boxed future");
    if (surfaces.length === 0) {
      assert.deepEqual(nativeFunction(result, "count", "src/api.rs").params.map(parameter => parameter.type), [nativeBorrow(nativeType("str"))]);
      assertNoNativeCalls(nativeFunction(result, "run"), ["clone"], "forwarded native text is not copied");
    }
    validateGeneratedProject("typed-native-module-callables", result.artifacts, { run: true });
  });
  test(`inherited callable contracts reject conflicting native widths on ${surfaces[0] ?? "native"}`, () => {
    const { result } = compileRust({ surfaces, files: { "index.ts": conflictingNativeCallableSource } });
    assert.ok(result.diagnostics.length > 0);
    assert.equal(result.artifacts.length, 0);
  });
}
