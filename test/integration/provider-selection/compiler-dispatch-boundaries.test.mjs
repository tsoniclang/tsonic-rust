import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("fallible nullish selection retains lazy execution and its exact error domain", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "compiler_nullish_error" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
let calls = 0;
class Missing { code: number = 7; }
function missing(): never { calls++; throw new Missing(); }
function read(value: number | undefined): number { return value ?? missing(); }
export function main(): void {
  check(read(0) === 0 && calls === 0);
  let caught = false;
  try { read(undefined); } catch (error) {
    caught = true;
    check(error instanceof Missing && error.code === 7);
  }
  check(caught && calls === 1);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("compiler-nullish-error", result.artifacts, { run: true });
});

test("compiler union methods use the selected polymorphic dispatch and lexical receiver", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "compiler_dispatch" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
class Base { value: number = 0; }
class First extends Base {
  read(step: number): number { this.value += step; return this.value; }
  matches(values: number[]): boolean { return values.every((value: number): boolean => this.value === value); }
}
class Second extends Base {
  read(step: number): number | undefined { if (step < 0) throw new Error("negative"); return step === 0 ? undefined : step + 10; }
}
function read(value: First | Second, step: number): number | undefined { return value.read(step); }
export function main(): void {
  const first = new First();
  const second = new Second();
  check(read(first, 3) === 3 && first.matches([3, 3]));
  check(read(first, 2) === 5 && !first.matches([3, 3]));
  check(read(second, 2) === 12 && read(second, 0) === undefined);
  let caught = false;
  try { read(second, -1); } catch (error) { caught = true; check(\`\${error}\` === "Error: negative"); }
  check(caught);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("compiler-dispatch-boundaries", result.artifacts, { run: true });
});

test("structural callable storage retains the component error domain", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "compiler_callback_errors" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
class Failure { value: number = 7; }
export function raise(): never { throw new Failure(); }
function forward(value: { call: () => number }): number { return value.call(); }
export function main(): void {
  check(forward({ call: (): number => 7 }) === 7);
  let caught = false;
  try { forward({ call: (): number => { throw new Error("callback"); } }); }
  catch (error) { caught = true; check(\`\${error}\` === "Error: callback"); }
  check(caught);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("compiler-callback-errors", result.artifacts, { run: true });
});

test("escaping arrows retain their polymorphic instance after its creating call returns", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "compiler_lexical_this" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
class Base { value: number = 7; }
class Counter extends Base {
  reader(): () => number { return (): number => this.value; }
}
function create(): () => number { return new Counter().reader(); }
export function main(): void {
  const read = create();
  check(read() === 7 && read() === 7);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("compiler-lexical-this", result.artifacts, { run: true });
});

test("cross-file structural fields share one representation and preserve the original object", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "compiler_structural_fields" } },
    files: {
      "base.ts": `
export class Base {
  readonly info: { count: number };
  constructor(info: { count: number }) { this.info = info; }
}
`,
      "derived.ts": `
import { Base } from "./base.js";
export class Derived extends Base {
  readonly info: { count: number };
  constructor(info: { count: number }) { super(info); this.info = info; }
}
`,
      "index.ts": `
import { check } from "@acme/testing";
import { Base } from "./base.js";
import { Derived } from "./derived.js";
export function main(): void {
  const info = { count: 1 };
  const value: Base = new Derived(info);
  info.count = 9;
  check(value.info === info && value.info.count === 9);
  const distinct = { count: 9 };
  check(value.info !== distinct);
  value.info.count = 12;
  check(info.count === 12);
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("compiler-structural-fields", result.artifacts, { run: true });
});
