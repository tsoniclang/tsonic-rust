import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("checked polymorphic this returns preserve the actual result and derived members", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
import { check } from "@acme/testing";
class Base<T> {
  value: T;
  constructor(value: T) { this.value = value; }
  set(value: T): this { this.value = value; return this; }
  inferred() { return this; }
  choose(other: this): this { return other; }
  asBase(): Base<T> { return this; }
}
class Child extends Base<number> {
  extra(): number { return this.value + 1; }
}
function receiver(child: Child, calls: number[]): Child { calls.push(1); return child; }
function optional(child: Child | undefined): number | undefined { return child?.set(3).extra(); }
export function run(): boolean {
  const calls: number[] = [];
  const child = new Child(1);
  const other = new Child(9);
  const selected = receiver(child, calls).set(4).extra();
  const inferred = child.inferred().extra();
  const chosen = child.choose(other).extra();
  const base = child.asBase();
  return selected === 5 && inferred === 5 && chosen === 10 && base.value === 4 &&
    calls.length === 1 && optional(undefined) === undefined && optional(child) === 4;
}
export function main(): void { check(run()); }
` } });
  assert.deepEqual(result.diagnostics, []);
  const emitted = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.match(emitted, /Child::try_from\(/);
  assert.doesNotMatch(emitted, /downcast_unchecked|transmute/);
  validateGeneratedProject("polymorphic-this-results", result.artifacts, { run: true });
});
