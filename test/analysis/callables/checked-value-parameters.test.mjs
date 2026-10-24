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
    const { result, source } = compileRust({ surfaces, files: { "index.ts": sourceText } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 6).map(issue => {
        const node = issue.sourceNode;
        const name = node === undefined ? undefined : source.ast.name(node);
        return `${issue.code}: ${issue.message.slice(0, 256)}; node=${node === undefined ? "absent" : source.ast.kindName(node)}; name=${name === undefined ? "absent" : source.ast.text(name).slice(0, 128)}`;
      }).join("\n"));
    assert.equal(result.artifacts.length > 0, true, "the complete checked source reaches target emission");
    assert.equal(/fn run\(/u.test(rustSourceText(result)), true,
      "the exported ordinary native function is retained");
    if (name === "original tuple-rest and pseudo-this parameters") {
      const emitted = rustSourceText(result);
      assert.match(emitted, /\bvalues: \[f64; 2\]/u, "the homogeneous checked tuple keeps its fixed native array carrier");
      assert.match(emitted, /sum\(\s*1\.0,\s*\[2\.0_f64,\s*3\.0_f64\]\s*\)/u,
        "the three source values become one scalar and one exact native fixed array");
      assert.doesNotMatch(emitted, /vec!\[|Vec::/u, "a finite native rest tuple never allocates a dynamic rest vector");
    }
  });
}

for (const surfaces of [[], ["js"]]) {
  test(`fixed native tuple rest preserves heterogeneous positions, optional absence and checked spreads in ${surfaces[0] ?? "native"}`, () => {
    const { result } = compileRust({ surfaces, files: { "index.ts": `
      import type { int32 } from "@tsonic/core/types.js";
      function payload(...values: [int32, string, int32?]): int32 { return values[0] + (values[2] ?? 0); }
      function empty(...values: []): int32 { return 1; }
      export function run(): int32 {
        const values: [int32, string, int32] = [1, "value", 2];
        return payload(1, "value") + payload(...values) + empty();
      }
    ` } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 6).map(issue => `${issue.code}: ${issue.message.slice(0, 256)}`).join("\n"));
    assert.equal(result.artifacts.length > 0, true, "the complete tuple-rest program reaches target emission");
    const emitted = rustSourceText(result);
    assert.equal(/vec!\[|Vec::/u.test(emitted), false, "fixed tuple rest never allocates a native rest vector");
    assert.equal(/Option::<i32>::None/u.test(emitted), true, "the omitted checked optional tuple element retains its native absence");
    assert.equal(/empty\(\s*\(\)\s*\)/u.test(emitted), true, "an actual empty rest tuple is an explicit native argument, not a missing slot");
  });

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
    assert.equal(/combine\(\s*1,\s*Option::<i32>::None\s*\)/u.test(source), true,
      "the direct function call supplies the implementation's optional native slot");
    assert.equal(/Counter::new\(\s*1,\s*Option::<i32>::None\s*\)/u.test(source), true,
      "the overloaded constructor supplies its actual implementation's optional native slot");
    assert.equal(/\.total\(\s*1,\s*Option::<i32>::None\s*\)/u.test(source), true,
      "the bound method supplies its implementation's optional slot without duplicating the receiver");
  });
}
