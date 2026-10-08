import assert from "node:assert/strict";
import test from "node:test";
import { awaitOperandCallableSource, nativeAwaitOperandCallableSource } from "../../../../tsonic/test/fixtures/await-operand-callables.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces[0] ?? "native";
  test(`await operands close nested callable evidence and retain error identity in ${profile}`,
    { timeout: 300_000 }, () => {
      const name = `await_operand_callables_${profile}`;
      const { result } = compileRust({ surfaces,
        target: { id: "rust", options: { outputType: "bin", crateName: name } },
        files: { "index.ts": surfaces.length === 0 ? nativeAwaitOperandCallableSource : awaitOperandCallableSource },
      });
      assert.equal(result.diagnostics.length, 0, result.diagnostics.map(value => value.message).join("\n"));
      const executed = validateGeneratedProject(name, result.artifacts, { run: true });
      assert.equal(executed.status, 0, executed.stderr);
    });
}
