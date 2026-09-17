import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, acmeTestingPackage } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { compoundTypeFamilyOwnerFiles } from "../../fixtures/compound-type-family-owners.mjs";

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces.length === 0 ? "native" : "js";
  test(`compound conditional-type owners retain their exact generic bounds (${profile})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, files: compoundTypeFamilyOwnerFiles, packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin", crateName: "compound_type_families" } } });
    assert.deepEqual(result.diagnostics, []);
    const native = validateGeneratedProject(`compound-type-families-${profile}`, result.artifacts, {run: true});
    assert.equal(native.status, 0, JSON.stringify(native));
  });

  test(`computed pointer annotations still require a non-nullish guard (${profile})`, () => {
    const files = { ...compoundTypeFamilyOwnerFiles,
      "storage.ts": compoundTypeFamilyOwnerFiles["storage.ts"].replace(
        "if (value === undefined) return undefined;", "") };
    assert.throws(() => compileRust({ surfaces, files, packages: [acmeTestingPackage()] }),
      /error TS2345:.*Pointer<Job<Value>> \| undefined.*Pointer<Job<Value>>/u);
  });

  test(`structural alias instantiation preserves incompatible field types (${profile})`, () => {
    const files = { ...compoundTypeFamilyOwnerFiles,
      "index.ts": compoundTypeFamilyOwnerFiles["index.ts"].replace(
        "{ key: 1, value: numeric }", '{ key: "wrong", value: numeric }') };
    assert.throws(() => compileRust({ surfaces, files, packages: [acmeTestingPackage()] }),
      /error TS2322: Type 'string' is not assignable to type 'number'/u);
  });
}
