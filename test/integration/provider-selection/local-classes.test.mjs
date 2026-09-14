import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("closed local classes preserve lexical type identity and per-construction effects", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "local_classes" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
let calls = 0;
function next(): number { calls += 1; return calls; }
function first(): number {
  class Entry {
    value: number;
    constructor(value: number) { this.value = value; }
    read(): number { return this.value; }
  }
  const left = new Entry(next());
  const alias = left;
  const right = new Entry(next());
  check(alias === left && left !== right);
  alias.value = 9;
  check(left.read() === 9);
  return right.read();
}
function second(): string {
  class Entry {
    value: string;
    constructor(value: string) { this.value = value; }
  }
  return new Entry("second").value;
}
export function main(): void {
  check(first() === 2 && first() === 4 && calls === 4);
  check(second() === "second");
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("closed-local-classes", result.artifacts, { run: true });
});

test("unproved local class evaluation and capture contracts fail before publication", () => {
  for (const source of [
    `export function create(value: number): number { class Entry { read(): number { return value; } } return new Entry().read(); }`,
    `export function create<T>(value: T): void { class Entry { value: T; constructor(input: T) { this.value = input; } } new Entry(value); }`,
    `export function create(): number { class Entry { static count: number = 1; } return Entry.count; }`,
    `export function create(): void { class Entry {} const alias = Entry; new alias(); }`,
    `export function create(): void { const make = () => new Entry(); make(); class Entry {} }`,
    `export function create(): boolean { class Entry {} return new Entry() instanceof Entry; }`,
  ]) {
    const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": source } });
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_LOCAL_CLASS_NOT_CLOSED"),
      JSON.stringify(result.diagnostics));
    assert.equal(result.artifacts.length, 0);
  }
});
