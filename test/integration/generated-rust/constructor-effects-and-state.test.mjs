import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { classFactoryEffectsFiles } from "../../../../tsonic/test/fixtures/class-factory-effects.mjs";
import { initializedModuleStateFiles } from "../../../../tsonic/test/fixtures/initialized-module-state.mjs";
import { nativeIntegerComplementSource } from "../../../../tsonic/test/fixtures/native-integer-complement.mjs";
import { nullishNeverSource } from "../../../../tsonic/test/fixtures/nullish-never.mjs";
import { pointerOwnerNarrowingSource } from "../../../../tsonic/test/fixtures/pointer-owner-narrowing.mjs";
import { bigintTruncationSource } from "../../../../tsonic/test/fixtures/bigint-truncation.mjs";
import { selectedConstructorFiles } from "../../../../tsonic/test/fixtures/selected-constructors.mjs";

for (const [name, files] of [
  ["class-factory-effects", classFactoryEffectsFiles],
  ["initialized-module-state", initializedModuleStateFiles],
  ["selected-constructors", selectedConstructorFiles],
  ["native-integer-complement", { "index.ts": nativeIntegerComplementSource }],
  ["nullish-never", { "index.ts": nullishNeverSource }],
  ["pointer-owner-narrowing", { "index.ts": pointerOwnerNarrowingSource }],
  ["bigint-truncation", { "index.ts": bigintTruncationSource }],
]) {
  test(`${name} preserves construction, evaluation order and identity`, { timeout: 300_000 }, () => {
    const { result } = compileRust({
      surfaces: ["js"], packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin", crateName: name.replaceAll("-", "_") } },
      files: { ...files, "index.ts": `${files["index.ts"]}
        import { check } from "@acme/testing";
        export function main(): void { check(run()); }` },
    });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject(name, result.artifacts, { run: true });
  });
}
