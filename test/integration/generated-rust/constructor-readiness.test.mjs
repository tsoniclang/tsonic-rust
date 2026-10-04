import assert from "node:assert/strict";
import test from "node:test";
import { constructorReadinessSource, constructorLinkageFiles, parameterPropertiesSource } from "../../../../tsonic/test/fixtures/constructor-readiness.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  const lane = surfaces[0] ?? "native";
  test(`parameter properties preserve exact storage, defaults and base preparation in ${lane}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": `${parameterPropertiesSource}\nexport function main(): void { if (!run()) throw new Error("parameter-properties"); }` } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 5).map(row => row.message.slice(0, 256)).join("\n"));
    validateGeneratedProject(`parameter-properties-${lane}`, result.artifacts, { run: true });
  });
  test(`native base construction preserves source linkage and parameter ownership in ${lane}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { ...constructorLinkageFiles, "index.ts": `${constructorLinkageFiles["index.ts"]}\nexport function main(): void { if (!run()) throw new Error("constructor-linkage"); }` } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 5).map(row => row.message.slice(0, 256)).join("\n"));
    validateGeneratedProject(`constructor-linkage-${lane}`, result.artifacts, { run: true });
  });
  test(`native construction preserves cleanup, receiver identity and inherited effects in ${lane}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": `${constructorReadinessSource}\nexport function main(): void { if (!run()) throw new Error("constructor-readiness"); }` } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 5).map(row => row.message.slice(0, 256)).join("\n"));
    const generated = [...result.artifacts.values()].join("\n");
    assert.doesNotMatch(generated, /MaybeUninit|assume_init|transmute|downcast_unchecked/u);
    validateGeneratedProject(`constructor-readiness-${lane}`, result.artifacts, { run: true });
  });
}
