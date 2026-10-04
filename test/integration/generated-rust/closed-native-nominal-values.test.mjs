import assert from "node:assert/strict";
import test from "node:test";
import { closedNativeNominalValuesSource } from "../../../../tsonic/test/fixtures/closed-native-nominal-values.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surface of ["native", "js"]) {
  test(`closed native nominal owners retain aliases, inheritance and mutation in ${surface}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: surface === "native" ? [] : ["js"],
      target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": closedNativeNominalValuesSource +
        '\nexport function main(): void { if (!run()) throw new Error("closed native nominal values"); }' },
    });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 5)
      .map(row => row.message.slice(0, 256)).join("\n"));
    assert.equal(/unsafe\s*\{|transmute|downcast_unchecked/u.test([...result.artifacts.values()].join("\n")), false,
      "closed nominal recovery uses checked native type evidence");
    validateGeneratedProject(`closed-native-nominal-values-${surface}`, result.artifacts, { run: true });
  });
}
