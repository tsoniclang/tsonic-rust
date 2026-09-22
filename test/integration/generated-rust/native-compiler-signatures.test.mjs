import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

function compileAndRun(name, files) {
  const { result } = compileRust({ surfaces: ["js"], files,
    target: { id: "rust", options: { outputType: "bin", crateName: name } } });
  assert.deepEqual(result.diagnostics, []);
  const native = validateGeneratedProject(name, result.artifacts, { run: true });
  assert.equal(native.status, 0, native.stdout + native.stderr);
}

test("closed primitive unions retain native number, bigint and string identity", { timeout: 300_000 }, () => {
  compileAndRun("native_primitive_union", {
    "values.ts": `
      export type Value = number | bigint | string;
      export type Alias = Value;
      export function identity(value: Alias): Value { return value; }
      export function describe(value: Value): string {
        if (typeof value === "number") return value === 7.5 ? "number" : "wrong";
        if (typeof value === "bigint") return value === 9007199254740993n ? "bigint" : "rounded";
        return value;
      }
    `,
    "index.ts": `
      import { identity, describe } from "./values.js";
      export function main(): void {
        if (describe(identity(7.5)) !== "number" || describe(identity(9007199254740993n)) !== "bigint" ||
          describe(identity("native")) !== "native") throw new Error("union carrier");
      }
    `,
  });
});

test("constructor signatures retain inherited cross-file intersection members", { timeout: 300_000 }, () => {
  compileAndRun("native_constructor_intersection", {
    "base.ts": `
      export abstract class Base {
        abstract readonly kind: number;
        abstract hash(): number;
      }
    `,
    "factory.ts": `
      import type { Base } from "./base.js";
      export interface Factory<Value> {
        new(value: Value): Base & { readonly value: Value };
        accepts(value: Base | undefined): value is Base & { readonly value: Value };
      }
      export function create<Value>(factory: Factory<Value>, value: Value): Base & { readonly value: Value } {
        return new factory(value);
      }
    `,
    "index.ts": `
      import { Base } from "./base.js";
      import { create } from "./factory.js";
      class Numeric extends Base {
        readonly kind = 1;
        readonly value: number;
        constructor(value: number) { super(); this.value = value; }
        hash(): number { return this.value; }
        static accepts(value: Base | undefined): value is Numeric { return value instanceof Numeric; }
      }
      export function main(): void {
        const value = create(Numeric, 7);
        if (value.value !== 7 || value.kind !== 1 || value.hash() !== 7) throw new Error("intersection");
      }
    `,
  });
});

test("nested generic structural storage retains exact substituted fields", { timeout: 300_000 }, () => {
  compileAndRun("native_nested_generic_storage", { "index.ts": `
    type Storage<Key, Value> = { readonly key: Key; readonly value: Value };
    class Slice<Element> {
      readonly first: Element;
      constructor(first: Element) { this.first = first; }
    }
    function select<Key, Value>(read: (values: Slice<Storage<Key, Value>>) => Value,
      values: Slice<Storage<Key, Value>>): Value { return read(values); }
    export function main(): void {
      const pair: Storage<string, number> = { key: "value", value: 7 };
      if (select((values: Slice<Storage<string, number>>) => values.first.value, new Slice(pair)) !== 7) {
        throw new Error("nested storage");
      }
    }
  ` });
});

test("conditional storage in nested generic signatures preserves both checked branches", { timeout: 300_000 }, () => {
  compileAndRun("native_conditional_storage", { "index.ts": `
    import type { Pointer } from "@tsonic/core/types.js";
    import { allocatePointer, loadPointer } from "@tsonic/core/lang.js";
    interface Stored<Storage> { readonly storage: Storage; }
    type StorageOf<Value> = Value extends Stored<infer Storage> ? Storage : Value;
    type Pair<Key, Value> = { readonly key: StorageOf<Key>; readonly value: StorageOf<Value> };
    class Job<Element> {
      readonly value: Element;
      constructor(value: Element) { this.value = value; }
    }
    class Slice<Element> {
      readonly first: Element;
      constructor(first: Element) { this.first = first; }
    }
    function read<Key, Element>(callback: (value: Slice<Pair<Key, Pointer<Job<Element>> | undefined>>) => number,
      value: Slice<Pair<Key, Pointer<Job<Element>> | undefined>>): number { return callback(value); }
    function project<Key, Value>(callback: (value: Slice<Pair<Key, Value>>) => StorageOf<Value>,
      value: Slice<Pair<Key, Value>>): StorageOf<Value> { return callback(value); }
    export function main(): void {
      const pointer = allocatePointer(new Job(7));
      const values: Pair<string, Pointer<Job<number>> | undefined> = { key: "item", value: pointer };
      const result = read<string, number>(input => {
        const location = input.first.value;
        return location === undefined ? 0 : loadPointer(location).value;
      }, new Slice(values));
      const absent: Pair<string, Pointer<Job<number>> | undefined> = { key: "none", value: undefined };
      const empty = read<string, number>(input => input.first.value === undefined ? 1 : 0, new Slice(absent));
      const stored: Pair<number, Stored<string>> = { key: 3, value: "native" };
      const storage = project<number, Stored<string>>(input => input.first.value, new Slice(stored));
      if (result !== 7 || empty !== 1 || storage !== "native") throw new Error("conditional storage");
    }
  ` });
});
