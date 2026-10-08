import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, acmeTestingPackage } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { compoundIndexedWriteSource } from "../../../../tsonic/test/fixtures/compound-indexed-write.mjs";
import { bigintOperatorSource } from "../../../../tsonic/test/fixtures/bigint-operators.mjs";
import { jsNumericPropertySource } from "../../../../tsonic/test/fixtures/js-numeric-properties.mjs";
import { flowClassReadSource } from "../../../../tsonic/test/fixtures/flow-class-reads.mjs";
import { referenceDefaultSource } from "../../../../tsonic/test/fixtures/reference-defaults.mjs";

test("native singleton slice inputs borrow existing values without changing authored temporaries", { timeout: 300_000 }, () => {
  const { result } = compileRust({ packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "singleton_borrows" } },
    files: { "index.ts": `
      import { check } from "@acme/testing";
      function matchesText(values: readonly string[], expected: string): boolean { return values[0] === expected; }
      function matchesArray(values: readonly number[][]): boolean { return values[0][0] === 1 && values[0][1] === 2; }
      function produce(): string { return "temporary"; }
      export function main(): void {
        const text = "retained";
        const items = [1, 2];
        check(matchesText([text], "retained"));
        check(matchesArray([items]));
        check(matchesText([produce()], "temporary"));
        check(matchesText(["literal"], "literal"));
        check(matchesText([text, "tail"], "retained"));
        check(text === "retained" && items[0] === 1 && items[1] === 2);
      }
    ` },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.match(source, /matchesText\(core::slice::from_ref\(&text\),/u);
  assert.match(source, /matchesArray\(core::slice::from_ref\(&items\)\)/u);
  assert.doesNotMatch(source, /from_ref\([^\n]*(?:produce|literal)/u);
  assert.doesNotMatch(source, /&\[(?:text|items)\.clone\(\)\]/u);
  validateGeneratedProject("singleton-borrows", result.artifacts, { run: true });
});

for (const [name, source] of [["bigint_operators", bigintOperatorSource], ["js_numeric_properties", jsNumericPropertySource]]) {
  test(`${name} preserves the shared source contract`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: ["js"], packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin", crateName: name } },
      files: { "index.ts": `${source}\nimport { check } from "@acme/testing"; export function main(): void { check(run()); }` },
    });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject(name, result.artifacts, { run: true });
  });
}

test("JS indexed compound writes preserve evaluation order and exact result carriers", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "compound_indexed_write" } },
    files: { "index.ts": `${compoundIndexedWriteSource}\nimport { check } from "@acme/testing"; export function main(): void { check(run()); }` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("compound-indexed-write", result.artifacts, { run: true });
});

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces[0] ?? "native";
  test(`reference defaults remain lazy for methods and delegates (${profile})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin", crateName: "reference_defaults" } },
      files: { "index.ts": `${referenceDefaultSource}\nimport { check } from "@acme/testing"; export function main(): void { check(run()); }` },
    });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject(`reference-defaults-${profile}`, result.artifacts, { run: true });
  });
  test(`class flow reads preserve declaration storage and selected members (${profile})`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin", crateName: "flow_class_reads" } },
      files: { "index.ts": `${flowClassReadSource}\nimport { check } from "@acme/testing"; export function main(): void { check(run()); }` },
    });
    assert.deepEqual(result.diagnostics, []);
    if (surfaces.length === 0) {
      const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
      assert.match(output, /fromElement\(core::slice::from_ref\(&base\)\)/u);
      assert.doesNotMatch(output, /fromElement\(&\[base\.clone\(\)\]\)/u);
    }
    validateGeneratedProject(`flow-class-reads-${profile}`, result.artifacts, { run: true });
  });
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
