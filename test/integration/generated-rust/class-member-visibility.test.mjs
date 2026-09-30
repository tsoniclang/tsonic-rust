import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, createRustSession, rustSourceDiagnostics } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { classMemberVisibilityFiles } from "../../../../tsonic/test/fixtures/class-member-visibility.mjs";

for (const surface of ["native", "js"]) {
  test(`checked member visibility retains native subclass and lexical dispatch (${surface})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: surface === "js" ? ["js"] : [],
      target: { id: "rust", options: { outputType: "bin" } }, files: {
        ...classMemberVisibilityFiles,
        "index.ts": classMemberVisibilityFiles["index.ts"] + '\nexport function main(): void { if (!run()) throw new Error("member visibility"); }',
      } });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject(`class-member-visibility-${surface}`, result.artifacts, { run: true });
  });
}

test("checked private and protected members remain unavailable outside their owner", () => {
  const session = createRustSession({ files: { ...classMemberVisibilityFiles,
    "index.ts": 'import { Child } from "./child.js"; const child = new Child(); child.bump(); child.read(); child.count;',
  } });
  const diagnostics = rustSourceDiagnostics(session);
  assert.match(diagnostics, /private/);
  assert.match(diagnostics, /protected/);
  session.targetSession.close();
});
