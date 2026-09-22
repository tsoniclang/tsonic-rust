import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("generic property reads retain instantiated storage before null narrowing", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "generic_property_flow" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
class Storage<T> {
  private backing: T[] | null;
  constructor(backing: T[] | null) { this.backing = backing; }
  static copy<U>(target: Storage<U>, source: Storage<U>): boolean {
    const targetBacking = target.backing;
    const sourceBacking = source.backing;
    if (targetBacking !== null && sourceBacking !== null) {
      targetBacking[0] = sourceBacking[0] as U;
      return true;
    }
    return false;
  }
}
export function main(): void {
  const values = [1];
  check(Storage.copy(new Storage(values), new Storage([7])) && values[0] === 7);
  check(!Storage.copy(new Storage<number>(null), new Storage([8])));
  const text = ["before"];
  check(Storage.copy(new Storage(text), new Storage(["after"])) && text[0] === "after");
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("generic-property-flow", result.artifacts, { run: true });
});

test("generic class static calls have independent module-owned placement across files", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "generic_static_functions" } },
    files: {
      "classes.ts": `
export class Base<T> {
  value: T;
  constructor(value: T) { this.value = value; }
  read(): T { return this.value; }
  static calls: number = 0;
  static identity<U>(value: U): U { Base.calls += 1; return value; }
  static selected(value: number): number;
  static selected(value: string): string;
  static selected(value: number | string): number | string { return value; }
}
export class Derived<T> extends Base<T> {
  constructor(value: T) { super(value); }
  read(): T { return this.value; }
}
`,
      "index.ts": `
import { check } from "@acme/testing";
import { Base, Derived } from "./classes.js";
function base_identity(value: number): number { return value + 1; }
export function main(): void {
  check(Base.identity(4) === 4 && Base.identity("native") === "native");
  check(Base.selected(3) === 3 && Base.selected("selected") === "selected");
  check(Base.calls === 2 && base_identity(8) === 9);
  const value: Base<number> = new Derived(7);
  check(value.read() === 7);
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("generic-static-functions", result.artifacts, { run: true });
});
