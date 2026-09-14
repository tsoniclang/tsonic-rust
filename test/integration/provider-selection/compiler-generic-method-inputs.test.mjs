import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("compiler generic container methods instantiate receiver and method arguments independently", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "generic_method_inputs" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
import type { uint32 } from "@tsonic/core/types.js";
class Values<T> {
  constructor(private readonly items: T[]) {}
  set(index: number, value: T): void { this.items[index] = value; }
  get(index: number): T { return this.items[index]; }
  identity<U>(value: U): U { return value; }
}
export function main(): void {
  const first = new Values<uint32>([1]);
  const second = new Values<string>(["before"]);
  first.set(0, 7);
  second.set(0, "after");
  check(first.get(0) === 7 && second.get(0) === "after");
  check(first.identity<string>("separate") === "separate");
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("compiler-generic-method-inputs", result.artifacts, { run: true });
});
