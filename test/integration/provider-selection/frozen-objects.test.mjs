import assert from "node:assert/strict";
import test from "node:test";
import { frozenObjectSources } from "../../fixtures/frozen-objects.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const [name, source] of Object.entries(frozenObjectSources)) {
  test(`frozen objects preserve ${name}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: ["js"],
      target: { id: "rust", options: { outputType: "bin", crateName: "frozen_objects" } },
      files: { "index.ts": source },
    });
    assert.deepEqual(result.diagnostics, []);
    assert.equal(validateGeneratedProject(`frozen-objects-${name}`, result.artifacts, { run: true }).status, 0);
  });
}
