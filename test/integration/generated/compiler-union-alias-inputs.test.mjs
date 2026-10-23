import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, analyzeRust, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { rustTargetOperationResultCarrier } from "../../../dist/target-model/records/operations.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

test("narrowed class fields project from the selected physical union receiver", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
type Region = { readonly kind: "dense"; readonly value: number } |
  { readonly kind: "remote"; readonly offset: number };
export class Backing {
  constructor(readonly region: Region) {}
  read(): number {
    return this.region.kind === "dense" ? this.region.value : this.region.offset;
  }
}
` } });
  const ast = program.source.ast;
  const accesses = [];
  const visit = node => {
    if (ast.is.IsPropertyAccessExpression(node)) {
      const access = ast.as.AsPropertyAccessExpression(node);
      if (["value", "offset"].includes(ast.text(access.Name))) accesses.push({ node, receiver: access.Expression });
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(accesses.length, 2, "both checked discriminant branches retain their exact field receiver");
  for (const { node, receiver } of accesses) {
    const label = ast.text(node);
    const physical = program.records.targetOperation.get(receiver);
    const flow = program.records.flowReadProjection.get(receiver);
    assert.equal(physical !== undefined, true, `${label}: native field storage has a selected operation`);
    const carrier = rustTargetOperationResultCarrier(physical);
    assert.equal(carrier !== undefined && flow !== undefined, true, `${label}: narrowing is an explicit admitted projection`);
    assert.equal(rustTargetTypeRefEquals(carrier, flow.sourceCarrier), true,
      `${label}: the projection starts at actual physical storage, not the checker's logical narrowed type`);
    assert.equal(rustTargetTypeRefEquals(flow.sourceCarrier, flow.selectedCarrier), false,
      `${label}: the native union is projected before its selected payload member is accessed`);
  }
});

test("compiler union aliases retain their selected carrier across an undefined guard", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "union_alias_inputs" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
type Region = { readonly kind: "dense"; readonly value: number } |
  { readonly kind: "remote"; readonly offset: number };
class Backing {
  constructor(readonly region: Region) {}
  read(): number {
    return this.region.kind === "dense" ? this.region.value : this.region.offset;
  }
}
function read(region: Region | undefined): number {
  if (region === undefined) return -1;
  return new Backing(region).read();
}
export function main(): void {
  check(read(undefined) === -1);
  check(read({ kind: "dense", value: 7 }) === 7);
  check(read({ kind: "remote", offset: 9 }) === 9);
}
main();
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("compiler-union-alias-inputs", result.artifacts, { run: true });
});
