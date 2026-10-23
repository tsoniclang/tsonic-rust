import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { sourceEnclosingCallable } from "@tsonic/target-api/source";

test("compiler provider array entries preserve initialized live storage and iterator aliases", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "provider_array_entries" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
function countPresent<T>(values: readonly T[]): number {
  let count = 0;
  for (const [index, value] of values.entries()) {
    if (value !== undefined) count += index + 1;
  }
  return count;
}
export function main(): void {
  const values = [10, 20];
  const readonlyValues: readonly number[] = values;
  const entries = readonlyValues.entries();
  const alias = entries;
  check(!entries.next().done);
  values[1] = 30;
  let total = 0;
  for (const [index, value] of alias) {
    if (value !== undefined) total += index + value;
    if (index === 1) values.push(40);
  }
  check(total === 73 && entries.next().done === true);
  values.push(50);
  check(alias.next().done === true);
  check(countPresent(values) === 10);
  const sparse = new Array<number>(3);
  sparse[1] = 7;
  let holes = 0;
  let seen = 0;
  let payload = 0;
  let nulls = 0;
  for (const [index, value] of sparse.entries()) {
    const alias = value;
    seen += index + 1;
    if (alias === undefined) holes++;
    else payload += value;
    if (value === null) nulls++;
  }
  check(holes === 0 && seen === 6 && countPresent(sparse) === 6 && payload === 7 && nulls === 0);
}
main();
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const program = result.program;
  assert.equal(program !== undefined, true, "the actual generic entries source publishes its sealed records");
  const ast = program.source.ast;
  let binding;
  const visit = node => {
    if (ast.is.IsBindingElement(node) && ast.text(ast.name(node)) === "value") {
      const owner = sourceEnclosingCallable(node, ast);
      if (owner !== undefined && ast.text(ast.name(owner)) === "countPresent") binding = node;
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(binding !== undefined, true, "the original unused destructuring leaf retains its authored identity");
  assert.equal(program.records.bindingLiveness.get(binding)?.unused, true,
    "only the comparison read erased by the native selector disappears from liveness");
  const output = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.match(output, /#\[expect\(unused_variables, reason = "authored binding drop scope"\)\]\s*let value: T = binding_element\.1\.clone\(\);/u,
    "the exact unused leaf keeps its selected clone, binding and native Drop scope");
  validateGeneratedProject("compiler-provider-array-entries", result.artifacts, { run: true });
});
