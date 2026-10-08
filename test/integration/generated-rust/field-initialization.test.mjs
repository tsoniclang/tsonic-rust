import test from "node:test";
import assert from "node:assert/strict";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { fieldInitializationSource } from "../../../../tsonic/test/fixtures/field-initialization.mjs";

for (const surface of ["native", "js"]) {
  test(`explicit native fields have no runtime marker initializer on ${surface}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: surface === "js" ? ["js"] : [],
      target: { id: "rust", options: { outputType: "bin" } }, files: {
        "index.ts": fieldInitializationSource + '\nexport function main(): void { if (!run()) throw new Error("field initialization"); }',
      } });
    assertNoTargetDiagnostics(result.diagnostics);
    const text = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
    assert.match(text, /<i32 as Default>::default\(\)/u);
    assert.match(text, /<i64 as Default>::default\(\)/u);
    assert.doesNotMatch(text, /(?:nativefield|field)::|::field\(/u);
    validateGeneratedProject(`field-initialization-${surface}`, result.artifacts, { run: true });
  });
  test(`field markers cannot become unproved runtime values on ${surface}`, () => {
    assert.throws(() => compileRust({ surfaces: surface === "js" ? ["js"] : [], files: {
      "index.ts": 'import { field } from "@tsonic/core/lang.js"; import type { int32 } from "@tsonic/core/types.js"; export const invalid = field<int32>();',
    } }), /field<T>\(\) requires a proven static field-containing context/u);
  });
}
