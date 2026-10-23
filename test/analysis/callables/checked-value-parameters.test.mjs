import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, rustSourceText } from "../../helpers/rust-session.mjs";

const examples = [
  ["implicit and inherited construction with callable fields", `
    class Base { constructor(readonly value: number) {} }
    class Derived extends Base {}
    class Owner { readonly read = (value: number): number => value + 1; }
    export function run(): number { return new Owner().read(new Derived(3).value); }
  `],
  ["typed parameters, properties and callable getters", `
    interface Reader { read: (value: number) => number; }
    class Owner { get read(): (value: number) => number { return value => value + 1; } }
    function apply(callback: (value: number) => number, value: number): number { return callback(value); }
    export function run(reader: Reader): number { return apply(new Owner().read, reader.read(2)); }
  `],
  ["original tuple-rest and pseudo-this parameters", `
    function sum(this: void, thisValue: number, ...values: [number, number]): number {
      return thisValue + values[0] + values[1];
    }
    export function run(): number { return sum(1, 2, 3); }
  `],
];

for (const surfaces of [[], ["js"]]) for (const [name, sourceText] of examples) {
  test(`checked callable values retain ${name} in ${surfaces[0] ?? "native"}`, () => {
    const { result } = compileRust({ surfaces, files: { "index.ts": sourceText } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 6).map(issue => `${issue.code}: ${issue.message.slice(0, 256)}`).join("\n"));
    assert.equal(result.artifacts.length > 0, true, "the complete checked source reaches target emission");
    assert.equal(/fn run\(/u.test(rustSourceText(result)), true,
      "the exported ordinary native function is retained");
  });
}

for (const surfaces of [[], ["js"]]) {
  test(`public overloads retain their implementations' omitted native inputs in ${surfaces[0] ?? "native"}`, () => {
    const { result } = compileRust({ surfaces, files: { "index.ts": `
      import type { int32 } from "@tsonic/core/types.js";
      function combine(value: int32): int32;
      function combine(value: int32, delta?: int32): int32 { return value + (delta ?? 0); }
      class Counter {
        value: int32;
        constructor(value: int32);
        constructor(value: int32, delta?: int32) { this.value = value + (delta ?? 0); }
        total(value: int32): int32;
        total(value: int32, delta?: int32): int32 { return this.value + value + (delta ?? 0); }
      }
      export function run(): int32 {
        const counter = new Counter(1);
        return combine(1) + counter.total(1);
      }
    ` } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 6).map(issue => `${issue.code}: ${issue.message.slice(0, 256)}`).join("\n"));
    const source = rustSourceText(result);
    assert.equal(/combine\(\s*1,\s*None\s*\)/u.test(source), true,
      "the direct function call supplies the implementation's optional native slot");
    assert.equal(/Counter::new\(\s*1,\s*None\s*\)/u.test(source), true,
      "the overloaded constructor supplies its actual implementation's optional native slot");
    assert.equal(/\.total\(\s*1,\s*None\s*\)/u.test(source), true,
      "the bound method supplies its implementation's optional slot without duplicating the receiver");
  });
}
