import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

const storageDeclarations = `
export declare const storageKey: unique symbol;
export interface Stored<S> { readonly [storageKey]: S; }
export type Storage<T> = T extends Stored<infer S> ? S : T;
export declare const containerKey: unique symbol;
export interface ContainerStored<S> { readonly [containerKey]: S; }
export type ContainerStorage<T> = T extends ContainerStored<infer S> ? S : T;
`;

test("metadata declarations cannot hide executable symbol or interface-member reads", () => {
  for (const executable of [
    "export function read(): unknown { return storageKey; }",
    "export function read(value: Stored<number>): number { return value[storageKey]; }",
  ]) {
    const { result } = compileRust({
      surfaces: ["js"],
      files: { "index.ts": `${storageDeclarations}
        export function select<T>(value: Storage<T>): Storage<T> { return value; }
        ${executable}` },
    });
    assert.notEqual(result.diagnostics.length, 0);
    assert.deepEqual(result.artifacts, []);
  }
});

test("generic storage families preserve scalar widths and record aliasing across files", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "generic_storage_families" } },
    files: {
      "storage.ts": storageDeclarations,
      "value.ts": `
import { storageKey, type Storage } from "./storage.js";
export type Data = { count: number };
export class Value {
  declare readonly [storageKey]: Data;
  data: Data;
  constructor(data: Data) { this.data = data; }
}
export class Holder<T> {
  storage: Storage<T>;
  constructor(storage: Storage<T>) { this.storage = storage; }
  get current(): Storage<T> { return this.storage; }
}
export function roundTrip<T>(
  from: (stored: Storage<T>) => T,
  to: (value: T) => Storage<T>,
  value: T,
): Storage<T> {
  return to(from(to(value)));
}
export function read<T>(holder: Holder<T>): Storage<T> { return holder.storage; }
export function destructure<T>(holder: Holder<T>): Storage<T> {
  const { storage } = holder;
  return storage;
}
export function fromData(data: Data): Value { return new Value(data); }
export function toData(value: Value): Data { return value.data; }
`,
      "index.ts": `
import { check } from "@acme/testing";
import type { int32, uint32 } from "@tsonic/core/types.js";
import { Holder, Value, destructure, fromData, read, roundTrip, toData } from "./value.js";
function signed(value: int32): int32 { return value; }
function unsigned(value: uint32): uint32 { return value; }
export function main(): void {
  const negative: int32 = -7;
  const maximum: uint32 = 4294967295;
  check(roundTrip<int32>(signed, signed, negative) === negative);
  check(roundTrip<uint32>(unsigned, unsigned, maximum) === maximum);
  const data = { count: 4 };
  const value = new Value(data);
  const result = roundTrip<Value>(fromData, toData, value);
  result.count = 8;
  check(data.count === 8 && value.data.count === 8);
  const holder = new Holder<Value>(result);
  const alias = read<Value>(holder);
  alias.count = 11;
  check(holder.storage.count === 11 && value.data.count === 11);
  const scalar = new Holder<uint32>(maximum);
  check(read<uint32>(scalar) === maximum && scalar.current === maximum);
  check(destructure<uint32>(scalar) === maximum);
  destructure<Value>(holder).count = 13;
  check(data.count === 13 && holder.current.count === 13);
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("generic-storage-families", result.artifacts, { run: true });
});

test("independent generic storage families retain distinct nested results", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "independent_storage_families" } },
    files: {
      "storage.ts": storageDeclarations,
      "nested.ts": `
import type { ContainerStorage, Storage as Selected } from "./storage.js";
export type Local<T> = Selected<T>;
export type Pair<T> = { value: Local<T>; container: ContainerStorage<T> };
export function pair<T>(value: Local<T>, container: ContainerStorage<T>): Pair<T> {
  return { value, container };
}
export function first<T>(values: Local<T>[]): Local<T> { return values[0]; }
`,
      "index.ts": `
import { check } from "@acme/testing";
import { containerKey, storageKey } from "./storage.js";
import { first, pair } from "./nested.js";
type Left = { count: number };
type Right = { label: string };
class Both {
  declare readonly [storageKey]: Left;
  declare readonly [containerKey]: Right;
}
export function main(): void {
  const left = { count: 3 };
  const right = { label: "right" };
  const stored = pair<Both>(left, right);
  stored.value.count = 9;
  stored.container.label = "changed";
  check(left.count === 9 && right.label === "changed");
  const values = [left];
  const selected = first<Both>(values);
  selected.count = 12;
  check(stored.value.count === 12);
  const ordinary = pair<number>(4, 5);
  check(ordinary.value === 4 && ordinary.container === 5);
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("independent-storage-families", result.artifacts, { run: true });
});
