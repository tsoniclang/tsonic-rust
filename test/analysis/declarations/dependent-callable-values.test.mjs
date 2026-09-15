import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, acmeTestingPackage } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import {
  dependentCallableValueFiles,
  genericCallableValueFiles,
} from "../../fixtures/dependent-callable-values.mjs";

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces.length === 0 ? "native" : "js";
  for (const [name, files] of [
    ["generic", genericCallableValueFiles],
    ["indexed", dependentCallableValueFiles],
  ]) {
    test(`${name} generic callable values preserve typed results and captured identity (${profile})`,
      { timeout: 300_000 }, () => {
        const { result } = compileRust({ surfaces, files, packages: [acmeTestingPackage()],
          target: { id: "rust", options: { outputType: "bin", crateName: `callable_values_${name}` } } });
        assert.deepEqual(result.diagnostics, []);
        const native = validateGeneratedProject(`callable-values-${name}-${profile}`, result.artifacts, { run: true });
        assert.equal(native.status, 0, JSON.stringify(native));
      });
  }

  test(`indexed generic callbacks reject keys absent from the selected owner (${profile})`, () => {
    const files = { ...dependentCallableValueFiles,
      "index.ts": dependentCallableValueFiles["index.ts"].replace(
        'alias("count", value => value + 1)', 'alias("missing", value => value + 1)') };
    const { result } = compileRust({ surfaces, files, packages: [acmeTestingPackage()] });
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "TS2345"), JSON.stringify(result.diagnostics));
    assert.equal(result.artifacts.length, 0);
  });

  test(`indexed generic callbacks reject a result belonging to another field (${profile})`, () => {
    const files = { ...dependentCallableValueFiles,
      "index.ts": dependentCallableValueFiles["index.ts"].replace(
        'alias("count", value => value + 1)', 'alias("count", value => "wrong")') };
    const { result } = compileRust({ surfaces, files, packages: [acmeTestingPackage()] });
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "TS2322"), JSON.stringify(result.diagnostics));
    assert.equal(result.artifacts.length, 0);
  });
}
