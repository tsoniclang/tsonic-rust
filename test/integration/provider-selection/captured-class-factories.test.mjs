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
  return result.artifacts;
}

test("direct local classes preserve lexical captures without per-method allocation", { timeout: 300_000 }, () => {
  const artifacts = compileAndRun("direct_class_captures", { "index.ts": `
    interface Counter { read(): number; increment(): void; }
    function create(initial: number): { value: Counter; change: (value: number) => void } {
      let offset = initial;
      class Selected implements Counter {
        private value = 0;
        read(): number { return this.value + offset; }
        increment(): void { this.value++; }
      }
      return { value: new Selected(), change: value => { offset = value; } };
    }
    function local(offset: number): number {
      class Inline {
        read(): number { return offset; }
        static captured(): number { return offset; }
      }
      return new Inline().read() + Inline.captured();
    }
    function owned(prefix: string) {
      class Text {
        suffix = "!";
        read(): string { return prefix + this.suffix; }
      }
      return { first: new Text(), second: new Text() };
    }
    export function main(): void {
      const first = create(4);
      const second = create(9);
      first.value.increment();
      first.change(20);
      if (first.value.read() !== 21 || second.value.read() !== 9 || local(7) !== 14) throw new Error("capture");
      const text = owned("native");
      const alias = text.first;
      alias.suffix = "?";
      if (text.first.read() !== "native?" || text.second.read() !== "native!") throw new Error("context");
    }
  ` });
  const rust = artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.match(rust, /struct LocalInlineClass/);
  assert.doesNotMatch(rust, /Rc<(?:LocalInlineClass|CreateSelectedClass)>/);
  assert.match(rust, /with_context\(/);
});

test("captured class factories retain per-evaluation identity, static state and live captures", { timeout: 300_000 }, () => {
  compileAndRun("captured_class_identity", { "index.ts": `
    interface Counter { read(): number; }
    interface CounterClass { new(value: number): Counter; count: number; }
    function factory(initial: number): { type: CounterClass; update: (value: number) => void } {
      let offset = initial;
      const type = class CounterValue implements Counter {
        static count = 0;
        value: number;
        constructor(value: number) { this.value = value; CounterValue.count++; }
        read(): number { return this.value + offset; }
      };
      return { type, update: value => { offset = value; } };
    }
    export function main(): void {
      const first = factory(10);
      const second = factory(20);
      const alias = first.type;
      if (alias !== first.type || alias === second.type) throw new Error("class identity");
      const left = new alias(1);
      const right = new second.type(2);
      const other = new first.type(3);
      if (left.read() !== 11 || right.read() !== 22 || other.read() !== 13) throw new Error("captures");
      first.update(30);
      if (left.read() !== 31 || other.read() !== 33 || right.read() !== 22) throw new Error("live capture");
      if (alias.count !== 2 || second.type.count !== 1) throw new Error("static count");
      alias.count = 7;
      if (first.type.count !== 7 || second.type.count !== 1) throw new Error("static alias");
    }
  ` });
});

test("local static storage keeps evaluations independent and releases borrows before callbacks", { timeout: 300_000 }, () => {
  compileAndRun("local_class_static_storage", { "index.ts": `
    interface Counter { increment(): number; reset(): number; }
    function factory(initial: number): Counter {
      class Selected implements Counter {
        static count = initial;
        static reset(): number { Selected.count = 5; return 2; }
        increment(): number { return Selected.count++; }
        reset(): number { Selected.count += Selected.reset(); return Selected.count; }
      }
      return new Selected();
    }
    export function main(): void {
      const first = factory(1);
      const second = factory(9);
      if (first.increment() !== 1 || second.increment() !== 9 || first.reset() !== 4) throw new Error("static");
      if (first.increment() !== 4 || second.increment() !== 10) throw new Error("independent");
    }
  ` });
});

test("generic captured classes preserve cross-file base intersections and exact predicates", { timeout: 300_000 }, () => {
  compileAndRun("captured_class_projection", {
    "model.ts": `
      export abstract class Base { abstract readonly token: object; abstract hash(): number; }
      export interface Factory<Value> {
        new(value: Value): Base & { readonly value: Value };
        accepts(value: Base | undefined): value is Base & { readonly value: Value };
      }
      export function factory<Value>(token: object, hash: (value: Value) => number): Factory<Value> {
        return class Adapter extends Base {
          readonly value: Value;
          readonly token = token;
          constructor(value: Value) { super(); this.value = value; }
          static accepts(value: Base | undefined): value is Adapter {
            return value !== undefined && value.token === token;
          }
          hash(): number { return hash(this.value); }
        };
      }
      export function read<Value>(type: Factory<Value>, value: Base | undefined, absent: Value): Value {
        return type.accepts(value) ? value.value : absent;
      }
    `,
    "index.ts": `
      import { factory, read } from "./model.js";
      export function main(): void {
        const numberType = factory<number>(Object.freeze({}), value => value + 1);
        const textType = factory<string>(Object.freeze({}), value => value.length);
        const numeric = new numberType(7);
        const text = new textType("native");
        if (numeric.hash() !== 8 || text.hash() !== 6) throw new Error("methods");
        if (read(numberType, numeric, 0) !== 7 || read(textType, text, "missing") !== "native") throw new Error("projection");
        if (read(numberType, text, 0) !== 0 || read(textType, undefined, "missing") !== "missing") throw new Error("predicate");
      }
    `,
  });
});

test("class evaluation and throwing initialization execute once in source order", { timeout: 300_000 }, () => {
  compileAndRun("captured_class_initialization", { "index.ts": `
    interface Value { value: number; }
    interface ValueClass { new(): Value; state: number; }
    let trace = "";
    function initialize(value: number): number {
      trace += "s";
      if (value < 0) throw new Error("initialization");
      return value;
    }
    function factory(value: number): ValueClass {
      trace += "f";
      return class Selected {
        static state = initialize(value);
        value: number;
        constructor() { trace += "c"; this.value = Selected.state; }
      };
    }
    function expect(value: string): void { if (trace !== value) throw new Error("order"); }
    export function main(): void {
      const type = factory(3);
      expect("fs");
      const first = new type();
      const second = new type();
      expect("fscc");
      if (first.value !== 3 || second.value !== 3) throw new Error("values");
      let caught = false;
      try { factory(-1); } catch { caught = true; }
      if (!caught) throw new Error("exception");
      expect("fsccfs");
      const other = factory(9);
      expect("fsccfsfs");
      if (new other().value !== 9 || type.state !== 3) throw new Error("independent initialization");
    }
  ` });
});
