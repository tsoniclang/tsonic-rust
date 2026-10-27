import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeFunction, nativeSource, nativeNodes, nativeCalls, nativeMethods, nativeType,
  nativeBorrow, nativeDispatchBinding, assertNoNativeCalls } from "../../helpers/native-ast.mjs";
import { acmeTestingPackage, artifactText, compileRust, createRustSession, nodejsCapability, rustSourceDiagnostics } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("node util.format lowers fixed and variadic arguments through one value-slice ABI", { timeout: 300_000 }, async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    target: { id: "rust", options: { outputType: "bin" } },
    files: {
      "index.ts": `
import { format } from "node:util";

export function render(label: string, count: number, ok: boolean): string {
  const output = format("%s:%d:%s", label, count, ok);
  return output + label + format("%s");
}

export function main(): void {
  if (render("count", 3, true) !== "count:3:truecount%s") throw new Error("native format contract");
}
main();
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const text = artifactText(result, "src/index.rs");
  assert.match(
    text,
    /tsonic_rust_node::util::format\(\s*"%s:%d:%s",\s*&\[\s*js_abi::JsValue::from\(label\.clone\(\)\),\s*js_abi::JsValue::from\(count\),\s*js_abi::JsValue::from\(ok\),\s*\]\s*,?\s*\)/su,
  );
  assert.match(text, /tsonic_rust_node::util::format\("%s", &\[\]\)/u);
  assert.match(
    text,
    /\[\s*core::convert::AsRef::<str>::as_ref\(&output\),\s*core::convert::AsRef::<str>::as_ref\(&label\),\s*core::convert::AsRef::<str>::as_ref\(&tsonic_rust_node::util::format\("%s", &\[\]\)\?\),\s*\]\s*\.concat\(\)/u,
  );
  validateGeneratedProject("node-util-native-format", result.artifacts, { run: true });
});

test("filesystem watchers lower through exact selected provider evidence", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import { watch } from "node:fs";

export function observe(path: string): void {
  const watcher = watch(path);
  watcher.unref();
  watcher.ref();
  watcher.close();
}
`,
    },
  });

  assertNoTargetDiagnostics(result.diagnostics);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /tsonic_rust_node::fs::watch(&path)?/u);
  assert.match(source, /watcher\.unref\(\)/u);
  assert.match(source, /watcher\.ref_\(\)/u);
  assert.match(source, /watcher\.close\(\)/u);
});

test("node package is a target capability independent of the js source surface", async () => {
  const capability = await nodejsCapability();
  assert.equal(capability.kind, "target-capability");
  assert.equal(capability.targetId, "rust");
  assert.equal(Object.hasOwn(capability, "requiredSurfaces"), false);
  assert.deepEqual(capability.moduleOwnership.map((entry) => entry.specifierPrefix ?? entry.moduleSpecifier).length > 0, true);
});
