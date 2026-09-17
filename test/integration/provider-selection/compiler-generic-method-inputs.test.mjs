import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { closedGenericDispatchProofFiles } from "../../../../tsonic/test/fixtures/closed-generic-dispatch.mjs";

test("module exports inside a binary retain finite generic virtual dispatch", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "closed_generic_dispatch" } },
    files: { ...closedGenericDispatchProofFiles,
      "index.ts": `${closedGenericDispatchProofFiles["index.ts"]}
import { check } from "@acme/testing";
export function main(): void { check(run()); }
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("closed-generic-dispatch", result.artifacts, { run: true });
});

test("library exports cannot replace an open generic dispatch ABI with finite variants", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    target: { id: "rust", options: { outputType: "lib", crateName: "open_generic_dispatch" } },
    files: closedGenericDispatchProofFiles,
  });
  assert.ok(result.diagnostics.some(diagnostic =>
    diagnostic.code === "RUST_SOURCE_CALLABLE_SPECIALIZATION_NOT_CLOSED" &&
    diagnostic.message.includes("open public target contract")),
  JSON.stringify(result.diagnostics));
  assert.deepEqual(result.artifacts, []);
});

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
