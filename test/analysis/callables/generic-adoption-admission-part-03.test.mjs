import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { assertRejectedAsyncSource } from "../../helpers/native-promise-lifetimes.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import {
  diagnosticSummary,
  code,
  identity,
  nativeEntryCases,
  nativeEntryInverses,
  nativeOpaquePayloadCases,
  nativeConstructorCases,
  nativeConstructorInverses,
  sourcePosition,
  sourceSpan,
  rejected,
  cases,
} from "./generic-adoption-admission-fixtures.mjs";

for (const [name, sourceText] of (nativeEntryInverses).slice(25, 37)) {
test("Rust native callback non-adoption inverse: " + name, { timeout: 300_000 }, () => {
    const { result, source } = compileRust({ surfaces: ["js"],
      target: { id: "rust", options: { outputType: "bin", crateName: "native_callback_inverse" } },
      files: { "index.ts": "export {};\n" + sourceText } });
    assert.equal(result.diagnostics.length, 0,
      diagnosticSummary(result, source));
    const output = validateGeneratedProject("native-callback-inverse-" + name, result.artifacts, { run: true }).stdout;
    assert.equal(output.trim(), "7", "only the actual resolver's same-activation payload is adopted");
  });
}

for (const [name, declarations, expression] of (nativeOpaquePayloadCases).slice(0, 5)) {
test("Rust native opaque callable input is unresolved, not safe empty: " + name, () => {
    const compilation = compileRust({ surfaces: ["js"], files: { "index.ts": declarations +
      "\nexport function reject(value: Promise<number>): void { void wrap(value); }" } });
    assertRejectedAsyncSource(compilation, [{ code: "RUST_ASYNC_RESULT_USE_NOT_PROVEN", kind: "KindCallExpression", text: expression }]);
  });

test("Rust ordinary opaque callable input keeps its native value: " + name, { timeout: 300_000 }, () => {
    const { result, source } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin",
      crateName: "ordinary_native_opaque_payload" } }, files: { "index.ts": "export {};\n" + declarations + "\nconsole.log(await wrap(7));" } });
    assert.equal(result.diagnostics.length, 0, diagnosticSummary(result, source));
    assert.equal(validateGeneratedProject("ordinary-native-opaque-" + name, result.artifacts, { run: true }).stdout.trim(), "7",
      "ordinary Awaited identity does not add a refusal or alter the native callback result");
  });
}

for (const [name, declarations, expression] of (nativeOpaquePayloadCases).slice(5, 6)) {
test("Rust native opaque callable input is unresolved, not safe empty: " + name, () => {
    const compilation = compileRust({ surfaces: ["js"], files: { "index.ts": declarations +
      "\nexport function reject(value: Promise<number>): void { void wrap(value); }" } });
    assertRejectedAsyncSource(compilation, [{ code: "RUST_ASYNC_RESULT_USE_NOT_PROVEN", kind: "KindCallExpression", text: expression }]);
  });
}
