import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { moduleInitializationErrorCases } from "../../../../tsonic/test/fixtures/module-initialization-errors.mjs";

for (const surfaces of [[], ["js"]]) {
  for (const current of moduleInitializationErrorCases) {
    test(`module initialization preserves ${current.name} on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
      const { result } = compileRust({ surfaces,
        target: { id: "rust", options: { outputType: "bin", crateName: `init_${current.name}` } },
        files: { ...current.files, "index.ts": current.source },
        ...(current.sourcePackages === undefined ? {} : { sourcePackages: current.sourcePackages }),
      });
      assert.equal(result.diagnostics.length, 0, result.diagnostics.map(diagnostic => diagnostic.message).join("\n"));
      const native = validateGeneratedProject(`module-errors-${current.name}`, result.artifacts, { run: true });
      assert.equal(native.stdout, "");
    });
  }
}
