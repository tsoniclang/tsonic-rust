import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

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
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("compiler-union-alias-inputs", result.artifacts, { run: true });
});
