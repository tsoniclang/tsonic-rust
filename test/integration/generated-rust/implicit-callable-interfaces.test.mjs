import assert from "node:assert/strict";
import test from "node:test";
import { implicitCallableInterfaceSource } from "../../../../tsonic/test/fixtures/implicit-callable-interfaces.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces[0] ?? "native";
  test(`implicit callable interfaces separate generic signature inference from physical storage in ${profile}`,
    { timeout: 300_000 }, () => {
      const name = `implicit_callable_interface_${profile}`;
      const { result } = compileRust({ surfaces,
        target: { id: "rust", options: { outputType: "bin", crateName: name } },
        files: { "index.ts": implicitCallableInterfaceSource },
      });
      assert.equal(result.diagnostics.length, 0, result.diagnostics.map(value => value.message).join("\n"));
      const executed = validateGeneratedProject(name, result.artifacts, { run: true });
      assert.equal(executed.status, 0, executed.stderr);
    });
}
