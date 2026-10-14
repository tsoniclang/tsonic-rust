import assert from "node:assert/strict";
import test from "node:test";
import { nativeFunction, nativeType } from "../../helpers/native-ast.mjs";
import { lexicalCaptureConversionSource } from "../../../../tsonic/test/fixtures/lexical-capture-conversions.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces[0] ?? "native";
  test(`lexical captures retain native storage before contextual conversions in ${profile}`,
    { timeout: 300_000 }, () => {
      const name = `lexical_capture_conversions_${profile}`;
      const { result } = compileRust({ surfaces,
        target: { id: "rust", options: { outputType: "bin", crateName: name } },
        files: { "index.ts": (lexicalCaptureConversionSource + "\nmain();\n") },
      });
      assert.equal(result.diagnostics.length, 0, result.diagnostics.map(value => value.message).join("\n"));
      assert.deepEqual(nativeFunction(result, "read").params.map(parameter => parameter.type), [nativeType("i32")]);
      const failure = nativeFunction(result, "fail").params;
      assert.equal(failure.length, 1);
      assert.equal(failure[0].type.kind, "reference");
      assert.equal(failure[0].type.mutable, false);
      assert.equal(failure[0].type.referent.path, "Failure", "the exact exception is borrowed before contextual conversion");
      const executed = validateGeneratedProject(name, result.artifacts, { run: true });
      assert.equal(executed.status, 0, executed.stderr);
    });
}
