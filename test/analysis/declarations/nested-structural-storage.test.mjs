import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, acmeTestingPackage } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nestedStructuralStorageFiles, invalidNestedStructuralStorageFiles } from "../../../../tsonic/test/fixtures/nested-structural-storage.mjs";

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces.length === 0 ? "native" : "js";
  test(`nested structural alias facts are independent of imported declaration order (${profile})`, () => {
    for (const storageName of ["a-storage", "z-storage"]) {
      const files = Object.fromEntries(Object.entries(nestedStructuralStorageFiles).map(([name, source]) => [
        name === "storage.ts" ? `${storageName}.ts` : name,
        source.replaceAll('"./storage.js"', `"./${storageName}.js"`),
      ]));
      const { result } = compileRust({ surfaces, files });
      assert.deepEqual(result.diagnostics, []);
    }
  });
  test(`nested structural storage preserves compound aliases and shared mutation (${profile})`, { timeout: 300_000 }, () => {
    const files = { ...nestedStructuralStorageFiles,
      "index.ts": `${nestedStructuralStorageFiles["index.ts"]}
        import { check } from "@acme/testing";
        export function main(): void { check(run()); }`,
    };
    const { result } = compileRust({ surfaces, files, packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin", crateName: "nested_structural_storage" } } });
    assert.deepEqual(result.diagnostics, []);
    const native = validateGeneratedProject(`nested-structural-storage-${profile}`, result.artifacts, { run: true });
    assert.equal(native.status, 0, JSON.stringify(native));
  });

  test(`nested structural storage still rejects wrong fields and unguarded pointers (${profile})`, () => {
    for (const files of invalidNestedStructuralStorageFiles) {
      assert.throws(() => compileRust({ surfaces, files }), /error TS(?:2322|2345)/u);
    }
  });
}
