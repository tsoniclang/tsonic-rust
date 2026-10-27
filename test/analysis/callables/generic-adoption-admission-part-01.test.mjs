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

for (const [name, declarations] of nativeEntryCases) {
  test("Rust native callback entry keeps exact generic adoption: " + name, () => {
    const compilation = compileRust({ surfaces: ["js"], files: { "index.ts": declarations +
      "\nexport function reject(promised: Promise<number>): void { void wrap(promised); }" } });
    rejected(compilation, "wrap(promised)", "KindCallExpression", "wrap");
  });
}

test("Rust native callback ordinary matrix executes every retained entry under one real loop owner", { timeout: 300_000 }, () => {
  const files = Object.fromEntries(nativeEntryCases.map(([name, declarations], index) =>
    [`case${index}.ts`, declarations + "\nexport async function run(): Promise<number> { return await wrap(7); }"]));
  const sourceText = nativeEntryCases.map((entry, index) => `import { run as run${index} } from "./case${index}.js";`).join("\n") +
    "\n" + nativeEntryCases.map((entry, index) => `console.log(await run${index}());`).join("\n");
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "native_callback_entries" } },
    files: { ...files, "index.ts": sourceText } });
  assert.equal(result.diagnostics.length, 0,
    JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message }))));
  const output = validateGeneratedProject("native-callback-entry-matrix", result.artifacts, { run: true }).stdout;
  assert.deepEqual(output.trim().split(/\r?\n/u), nativeEntryCases.map(() => "7"),
    "every synchronous/deferred/aliased/helper/recursive entry preserves the ordinary native payload");
});

for (const [name, sourceText] of (nativeEntryInverses).slice(0, 14)) {
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
