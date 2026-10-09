import assert from "node:assert/strict";
import test from "node:test";
import { closedNativeAbsenceGuardSource } from "../../../../tsonic/test/fixtures/closed-native-absence-guards.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces[0] ?? "native";
  test(`closed native absence guards preserve parameter, local, optional member and runtime category in ${profile}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": closedNativeAbsenceGuardSource },
    });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 5)
      .map(diagnostic => diagnostic.message.slice(0, 256)).join("\n"));
    assert.equal(validateGeneratedProject(`closed-native-absence-guards-${profile}`, result.artifacts, { run: true }).status, 0);
  });
}
