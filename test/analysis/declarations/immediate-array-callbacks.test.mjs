import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, acmeTestingPackage } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces[0] ?? "native";
  test(`direct array callbacks preserve caller mutations across repeated calls (${profile})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin", crateName: "immediate_array_callbacks" } },
      files: { "index.ts": `
        import { check } from "@acme/testing";
        function twice(values: number[], apply: (items: number[]) => number): number {
          return apply(values) + apply(values);
        }
        export function main(): void {
          const values = [1, 2];
          const result = twice(values, items => { items[0] += 1; return items[0]; });
          check(result === 5 && values[0] === 3 && values[1] === 2);
        }
      ` },
    });
    assert.deepEqual(result.diagnostics, []);
    if (surfaces.length === 0) {
      const source = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
      assert.match(source, /impl Fn\(&mut \[f64\]\)/u);
      assert.doesNotMatch(source, /values\.to_vec\(\)/u);
    }
    validateGeneratedProject(`immediate-array-callbacks-${profile}`, result.artifacts, { run: true });
  });
}
