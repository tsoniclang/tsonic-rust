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
