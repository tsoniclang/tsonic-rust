import assert from "node:assert/strict";
import test from "node:test";
import { recursiveCallbackProtocolCases } from "../../../../tsonic/test/fixtures/recursive-callback-protocols.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const current of recursiveCallbackProtocolCases) for (const profile of ["native", "js"]) {
  test(`${current.name} recursive callback protocol compiles and executes in ${profile}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: profile === "native" ? [] : ["js"],
      target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": current.source } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 4).map(row => row.message.slice(0, 256)).join("\n"));
    validateGeneratedProject(`recursive-callback-${current.name}-${profile}`, result.artifacts, { run: true });
  });
}
