import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`rest dispatch preserves logical heads, tails and fixed prefixes on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
import { check } from "@acme/testing";
class Base {
  collect(...values: string[]): string { return values[0]; }
  prefix(first: string, ...values: string[]): string { return first; }
  fixed(first: string, second: string): string { return first + second; }
  optional(...values: number[]): number { return 0; }
}
class Derived extends Base {
  collect(first: string, ...rest: string[]): string {
    let result = first;
    for (const value of rest) result += value;
    return result;
  }
  prefix(...values: string[]): string {
    let result = "";
    for (const value of values) result += value;
    return result;
  }
  fixed(...values: string[]): string { return values[0] + values[1]; }
  optional(first?: number, ...rest: number[]): number {
    let result = first ?? 4;
    for (const value of rest) result += value;
    return result;
  }
}
export function run(): boolean {
  const derived = new Derived();
  const base: Base = derived;
  return base.collect("a", "b", "c") === "abc" && base.collect("a") === "a" &&
    base.prefix("a", "b", "c") === "abc" && base.prefix("a") === "a" &&
    base.fixed("a", "b") === "ab" && base.optional() === 4 && base.optional(7, 3) === 10;
}
export function main(): void { check(run()); }
` } });
    assert.deepEqual(result.diagnostics, []);
    const output = artifactText(result, "src/index.rs");
    assert.doesNotMatch(output, /\.values\(\)\.into_iter\(\)/);
    if (surfaces.length !== 0) assert.match(output, /\.into_values\(\)\.into_iter\(\)/);
    validateGeneratedProject("rest-dispatch-adapters", result.artifacts, { run: true });
  });

  test(`rest dispatch instantiates generics and preserves defaults and element identity on ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
import { check } from "@acme/testing";
class Item { value: number = 1; }
abstract class AbstractHead { abstract head(...values: string[]): string; }
class ConcreteHead extends AbstractHead { head(first: string, ...rest: string[]): string { return first; } }
interface Head<T> { head(...values: T[]): T; }
class InterfaceHead<T> implements Head<T> { head(first: T, ...rest: T[]): T { return first; } }
class Base<T> {
  head(...values: T[]): T { return values[0]; }
  empty(value: T): T { return value; }
  defaults(...values: number[]): number { return 0; }
  same(...values: T[]): T[] { return values; }
}
class Derived<T> extends Base<T> {
  head(first: T, ...rest: T[]): T { return first; }
  empty(value: T, ...rest: T[]): T { return value; }
  defaults(first: number = 5, ...rest: number[]): number {
    let result = first;
    for (const value of rest) result += value;
    return result;
  }
  same(...values: T[]): T[] { return values; }
}
export function run(): boolean {
  const item = new Item();
  const base: Base<Item> = new Derived<Item>();
  const first = base.head(item, new Item());
  first.value = 9;
  const values = base.same(item);
  const abstract: AbstractHead = new ConcreteHead();
  const structural: Head<Item> = new InterfaceHead<Item>();
  return first === item && item.value === 9 && base.empty(item) === item &&
    values[0] === item && base.defaults() === 5 && base.defaults(7, 3) === 10 &&
    abstract.head("x", "y") === "x" && structural.head(item, new Item()) === item;
}
export function main(): void { check(run()); }
` } });
    assert.deepEqual(result.diagnostics, []);
    validateGeneratedProject("rest-dispatch-generics", result.artifacts, { run: true });
  });
}
