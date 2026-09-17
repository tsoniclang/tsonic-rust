import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("compiler parameter properties preserve fields, defaults and constructor order", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "parameter_properties" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
let order = 0;
function step(value: number): number { order = order * 10 + value; return value; }
class Box {
  field: number = step(2);
  constructor(private readonly value: string, public count: number = step(1)) {
    check(this.value === value && this.count === count && this.field === 2);
    value = "changed";
    check(this.value === "kept" && value === "changed");
    step(3);
  }
  text(): string { return this.value; }
}
class Holder<T> {
  constructor(readonly value: T) {}
  read(): T { return this.value; }
}
class Base {
  constructor(protected readonly base: number) { step(4); }
  getBase(): number { return this.base; }
}
class Derived extends Base {
  field: number = step(5);
  constructor(readonly amount: number) {
    super(amount);
    check(this.amount === amount && this.field === 5);
    step(6);
  }
}
export function main(): void {
  const box = new Box("kept");
  check(order === 123 && box.text() === "kept" && box.count === 1);
  box.count = 8;
  const holder = new Holder<Box>(box);
  check(holder.read() === box && holder.value.count === 8);
  order = 0;
  const derived = new Derived(7);
  check(order === 456 && derived.amount === 7 && derived.getBase() === 7);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("compiler-parameter-properties", result.artifacts, { run: true });
});
