import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("constructor values retain selected generics, class aliases and live static fields", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "constructor_adapters" } }, files: {
      "model.ts": `
        export interface Box<Value> { readonly value: Value; }
        export interface Factory<Value> {
          new(value: Value): Box<Value>;
          count: number;
          accepts(value: number): boolean;
        }
        export class NumberBox implements Box<number> {
          static count = 0;
          readonly value: number;
          constructor(value: number) { this.value = value; NumberBox.count++; }
          static accepts(value: number): boolean { return value >= 0; }
        }
        export class TextBox implements Box<string> {
          static count = 0;
          readonly value: string;
          constructor(value: string) { this.value = value; TextBox.count++; }
          static accepts(value: number): boolean { return value > 0; }
        }
        export function create<Value>(factory: Factory<Value>, value: Value): Box<Value> {
          return new factory(value);
        }
      `,
      "index.ts": `
        import { NumberBox, TextBox, create } from "./model.js";
        import type { Factory } from "./model.js";
        export function main(): void {
          const numbers: Factory<number> = NumberBox;
          const same: Factory<number> = NumberBox;
          if (numbers !== same) throw new Error("class identity");
          const first = create(numbers, 3);
          const second = create(numbers, 8);
          const text = create(TextBox, "native");
          if (first === second || first.value !== 3 || second.value !== 8 || text.value !== "native") throw new Error("instances");
          if (!numbers.accepts(0) || TextBox.accepts(0)) throw new Error("static method");
          numbers.count = 10;
          if (NumberBox.count !== 10 || same.count !== 10 || TextBox.count !== 1) throw new Error("static storage");
        }
      `,
    } });
  assert.deepEqual(result.diagnostics, []);
  const native = validateGeneratedProject("constructor-adapters", result.artifacts, { run: true });
  assert.equal(native.status, 0, native.stdout + native.stderr);
});

test("constructor values preserve callee-before-argument order and constructor errors", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "constructor_effects" } }, files: {
      "index.ts": `
        interface Box { readonly value: number; }
        interface Factory { new(value: number): Box; }
        let trace = "";
        class Value implements Box {
          readonly value: number;
          constructor(value: number) {
            trace += "c";
            if (value < 0) throw new Error("negative");
            this.value = value;
          }
        }
        function select(): Factory { trace += "s"; return Value; }
        function input(): number { trace += "a"; return 4; }
        function expectTrace(expected: string): void { if (trace !== expected) throw new Error("order"); }
        export function main(): void {
          const value = new (select())(input());
          expectTrace("sac");
          if (value.value !== 4) throw new Error("value");
          let rejected = false;
          try { new (select())(-1); } catch { rejected = true; }
          if (!rejected) throw new Error("failure");
          expectTrace("sacsc");
        }
      `,
    } });
  assert.deepEqual(result.diagnostics, []);
  const native = validateGeneratedProject("constructor-effects", result.artifacts, { run: true });
  assert.equal(native.status, 0, native.stdout + native.stderr);
});

test("constructor static methods cannot silently become copied or independently mutable function values", () => {
  for (const operation of ["const method = factory.accepts;", "factory.accepts = value => true;"]) {
    const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
      interface Box { readonly value: number; }
      interface Factory { new(value: number): Box; accepts(value: number): boolean; }
      class Value implements Box {
        readonly value: number;
        constructor(value: number) { this.value = value; }
        static accepts(value: number): boolean { return value > 0; }
      }
      export function main(): void { const factory: Factory = Value; ${operation} }
    ` } });
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "RUST_CONSTRUCTOR_METHOD_VALUE_UNSUPPORTED"));
    assert.equal(result.artifacts.length, 0);
  }
});

test("constructor predicates retain closed base-interface narrowing and native dispatch entries", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "constructor_predicates" } }, files: {
      "index.ts": `
        interface Base { kind(): number; }
        interface Box<Value> extends Base { readonly value: Value; }
        interface Factory<Value> {
          new(value: Value): Box<Value>;
          accepts(value: Base | undefined): value is Box<Value>;
        }
        class NumberBox implements Box<number> {
          readonly value: number;
          constructor(value: number) { this.value = value; }
          kind(): number { return 1; }
          static accepts(value: Base | undefined): value is NumberBox { return value instanceof NumberBox; }
        }
        class Other implements Base { kind(): number { return 2; } }
        class TextBox implements Box<string> {
          readonly value: string;
          constructor(value: string) { this.value = value; }
          kind(): number { return 3; }
          static accepts(value: Base | undefined): value is TextBox { return value instanceof TextBox; }
        }
        function create<Value>(factory: Factory<Value>, value: Value): Box<Value> { return new factory(value); }
        function extract<Value>(factory: Factory<Value>, value: Base | undefined, otherwise: Value): Value {
          return factory.accepts(value) ? value.value : otherwise;
        }
        export function main(): void {
          const factory: Factory<number> = NumberBox;
          const value = create(factory, 7);
          if (extract(factory, value, -1) !== 7 || extract(factory, new Other(), -1) !== -1 ||
            extract(factory, undefined, -1) !== -1) throw new Error("predicate");
          const textFactory: Factory<string> = TextBox;
          const text = create(textFactory, "native");
          if (extract(textFactory, text, "missing") !== "native" || extract(factory, text, -1) !== -1 ||
            extract(textFactory, value, "missing") !== "missing") throw new Error("independent native types");
        }
      `,
    } });
  assert.deepEqual(result.diagnostics, []);
  const emitted = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.match(emitted, /fn accepts\(&self, argument: Option<Base>\) -> Result<bool, rt::TsonicError>/u);
  assert.doesNotMatch(emitted, /Callable.*accepts|accepts.*Callable/);
  assert.match(emitted, /identity: upcast_value\.identity,/);
  assert.match(emitted, /TryFrom</);
  assert.doesNotMatch(emitted, /\bAny\b|transmute|downcast_ref/);
  const native = validateGeneratedProject("constructor-predicates", result.artifacts, { run: true });
  assert.equal(native.status, 0, native.stdout + native.stderr);
});
