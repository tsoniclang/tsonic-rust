import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { rustProjectCallableAdaptersKey } from "../../../dist/analysis/facts/project-callable-adapters.js";

const source = `
class Base<T> {
  collect(...values: T[]): number { return values.length; }
}
class Child<T> extends Base<T> {}
class Override<T> extends Base<T> {
  collect(...values: T[]): number { return values.length + 1; }
}
export function run(): boolean {
  const child = new Child<string>();
  const base: Base<string> = child;
  const override: Base<string> = new Override<string>();
  return child.collect() === 0 && base.collect("a", "b") === 2 &&
    override.collect("c") === 2 && override.collect() === 1;
}
`;

test("inherited native rest slots forward the selected array without reassembly", { timeout: 300_000 }, () => {
  const files = { "index.ts": `import { check } from "@acme/testing";\n${source}\nexport function main(): void { check(run()); }` };
  const { result } = compileRust({ surfaces: ["js"], packages: [acmeTestingPackage()], files,
    target: { id: "rust", options: { outputType: "bin" } } });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("inherited-rest-methods", result.artifacts, { run: true });
});

test("exact rest dispatch has one immutable runtime-value identity adapter", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": source } });
  for (const name of ["Child", "Override"]) {
    const definition = program.projectTypes.definitions.find(entry => entry.sourceName === name);
    assert.ok(definition);
    const adapters = program.facts.getFact(definition.declaration, rustProjectCallableAdaptersKey);
    assert.ok(adapters.length > 0);
    for (const adapter of adapters) {
      assert.equal(adapter.parameterAdapters.length, 1);
      const parameter = adapter.parameterAdapters[0];
      assert.equal(parameter.kind, "runtime-value");
      assert.equal(parameter.adapter.kind, "identity");
      assert.equal(parameter.source.form, "rest");
      assert.equal(parameter.target.form, "rest");
      assert.ok(Object.isFrozen(parameter));
    }
  }
});
