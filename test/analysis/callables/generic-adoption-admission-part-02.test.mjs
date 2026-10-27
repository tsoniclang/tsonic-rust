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

for (const [name, sourceText] of (nativeEntryInverses).slice(14, 25)) {
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
