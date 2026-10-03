import assert from "node:assert/strict";
import test from "node:test";
import { implicitErrorInterfaceSource } from "../../../../tsonic/test/fixtures/implicit-error-interfaces.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  for (const projectError of [false, true]) {
    test(`implicit Error interface preserves native identity and live fields: ${surfaces[0] ?? "native"}/${projectError}`, { timeout: 300_000 }, () => {
      const name = `implicit_error_interface_${surfaces[0] ?? "native"}_${projectError}`;
      const { result } = compileRust({ surfaces,
        target: { id: "rust", options: { outputType: "bin", crateName: name } },
        files: { "index.ts": `${implicitErrorInterfaceSource(projectError)}
export function main(): void { if (!run()) throw new Error("implicit Error interface identity"); }
` } });
      assert.equal(result.diagnostics.length, 0, result.diagnostics.map(value => value.message).join("\n"));
      const executed = validateGeneratedProject(name, result.artifacts, { run: true });
      assert.equal(executed.status, 0, executed.stderr);
    });
  }
}
