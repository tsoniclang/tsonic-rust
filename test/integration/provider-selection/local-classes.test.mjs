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
    `export function create(): number { class Entry { static count: number = 1; } return Entry.count; }`,
    `export function create(): void { class Entry {} const alias = Entry; new alias(); }`,
    `export function create(): void { const make = () => new Entry(); make(); class Entry {} }`,
    `export function create(): boolean { class Entry {} return new Entry() instanceof Entry; }`,
    `export function create(): number { class Entry { static make(): number { return 1; } } const make = Entry.make; return make(); }`,
    `export function create(value: number): number { class Entry { static make(): number { return value; } } return Entry.make(); }`,
  ]) {
    const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": source } });
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_LOCAL_CLASS_NOT_CLOSED"),
      JSON.stringify(result.diagnostics));
    assert.equal(result.artifacts.length, 0);
  }
});

test("local class static factories and implements clauses retain exact storage", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "local_factories" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
interface Readable { read(): number; }
let count = 0;
function next(): number { count += 1; return count; }
function create(): number {
  type Storage = { value: number };
  class Entry implements Readable {
    storage: Storage;
    constructor(storage: Storage) { this.storage = storage; }
    static from(storage: Storage): Entry { return new Entry(storage); }
    static storageOf(entry: Entry): Storage { return entry.storage; }
    read(): number { return this.storage.value; }
  }
  const original = Entry.from({ value: next() });
  const shared = Entry.from(Entry.storageOf(original));
  shared.storage.value += 10;
  return original.read();
}
export function main(): void {
  check(create() === 11 && create() === 12 && count === 2);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(validateGeneratedProject("local-static-factories", result.artifacts, { run: true }).status, 0);
});

test("local classes retain enclosing type arguments without capturing runtime values", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "local_generic_classes" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
function outer<T>(value: T) {
  class Entry<U> {
    value: T;
    extra: U;
    constructor(input: T, extra: U) { this.value = input; this.extra = extra; }
    read(): T { return this.value; }
  }
  return new Entry<number>(value, 7);
}
function simple<T>(value: T): T {
  class Entry { value: T; constructor(input: T) { this.value = input; } }
  return new Entry(value).value;
}
export function main(): void {
  const first = outer("text");
  const second = outer(5);
  check(first.read() === "text" && first.extra === 7);
  check(second.read() === 5 && second.extra === 7);
  check(simple("plain") === "plain" && simple(9) === 9);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("local-generic-classes", result.artifacts, { run: true });
});
