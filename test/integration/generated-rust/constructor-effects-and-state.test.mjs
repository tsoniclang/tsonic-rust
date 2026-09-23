import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { classFactoryEffectsFiles } from "../../../../tsonic/test/fixtures/class-factory-effects.mjs";
import { initializedModuleStateFiles } from "../../../../tsonic/test/fixtures/initialized-module-state.mjs";

for (const [name, files] of [
  ["class-factory-effects", classFactoryEffectsFiles],
  ["initialized-module-state", initializedModuleStateFiles],
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
