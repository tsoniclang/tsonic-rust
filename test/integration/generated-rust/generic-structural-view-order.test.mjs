import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, createRustSession, rustSourceDiagnostics, rustSourceText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

function orderedDeclarations(order, closed, open) {
  return order === "open-first" ? `${open}\n${closed}` : order === "closed-first" ? `${closed}\n${open}` : closed;
}

function constantSource(order) {
  return `
type Tagged = { tag(): string; readonly label?: string };
class Base {}
class Box<T> extends Base {
  label: string = "tag";
  constructor(public value: T) { super(); }
  tag(): string { return this.label; }
}
${orderedDeclarations(order,
  `function closed(): Tagged { return new Box<string>("closed"); }`,
  `function open<T>(owner: Box<T>): Tagged { return owner; }`)}
export function run(): boolean {
  const owner = new Box<string>("value");
  const view: Tagged = owner;
  owner.label = "changed";
  if (view.tag() !== "changed" || view.label !== "changed" || closed().tag() !== "tag") return false;
  ${order === "closed-only" ? "" : `const numeric = new Box<number>(3); if (open(numeric).tag() !== "tag") return false;`}
  return true;
}
export function main(): void { if (!run()) throw new Error("constant structural view order"); }
`;
}

function dependentSource(order) {
  return `
type Values<T> = { readonly value: T; read(): T; write(value: T): void; readonly identity: (value: T) => T; readonly adapted: (value: T, ignored: number) => T };
type Maybe<T> = { readonly value?: T; read(): T | undefined };
type Head<T> = { head(...values: T[]): T };
type Default<T> = { defaulted(value: T): T };
class Base<T> {
  constructor(public value: T) {}
  read(): T { return this.value; }
  write(value: T): void { this.value = value; }
  head(first: T, ...rest: T[]): T { return first; }
  defaulted(value: T = this.value): T { return value; }
}
class Box<T> extends Base<T> {
  constructor(value: T) { super(value); }
  identity = (value: T): T => value;
  adapted = (value: T): T => value;
}
${orderedDeclarations(order,
  `function closed(): Values<string> { return new Box<string>("closed"); }
function closedMaybe(): Maybe<string> { return new Box<string>("closed-maybe"); }
function closedHead(): Head<string> { return new Box<string>("closed-head"); }
function closedDefault(): Default<string> { return new Box<string>("closed-default"); }`,
  `function open<T>(owner: Box<T>): Values<T> { return owner; }
function openMaybe<T>(owner: Box<T>): Maybe<T> { return owner; }
function openHead<T>(owner: Box<T>): Head<T> { return owner; }
function openDefault<T>(owner: Box<T>): Default<T> { return owner; }`)}
export function run(): boolean {
  const owner = new Box<string>("before");
  const view: Values<string> = owner;
  const maybe: Maybe<string> = owner;
  view.write("after");
  if (owner.value !== "after" || view.value !== "after" || view.read() !== "after" ||
      maybe.value !== "after" || maybe.read() !== "after" || view.identity("identity") !== "identity" || view.adapted("adapted", 42) !== "adapted") return false;
  if (closed().read() !== "closed" || closedMaybe().read() !== "closed-maybe" ||
      closedHead().head("a", "b") !== "a" || closedDefault().defaulted("explicit") !== "explicit") return false;
  ${order === "closed-only" ? "" : `
  const numeric = new Box<number>(3);
  const generic = open(numeric);
  generic.write(7);
  if (numeric.value !== 7 || generic.read() !== 7 || generic.identity(9) !== 9 || generic.adapted(10, 42) !== 10 ||
      openMaybe(numeric).value !== 7 || openHead(numeric).head(11, 12) !== 11 || openDefault(numeric).defaulted(13) !== 13) return false;
  `}
  return true;
}
export function main(): void { if (!run()) throw new Error("dependent structural view order"); }
`;
}

function permutedSource(order) {
  return `
type View<First, Second> = { readonly first?: First; readFirst(): First; readonly second?: Second; readSecond(): Second; writeFirst(value: First): void };
class Base<Left, Right> {
  constructor(public first: Left, public second: Right) {}
  readFirst() { return this.first; }
  readSecond() { return this.second; }
  writeFirst(value: Left): void { this.first = value; }
}
class Box<Outer, Inner> extends Base<Inner, Outer> {
  constructor(first: Inner, second: Outer) { super(first, second); }
}
${orderedDeclarations(order,
  `function closed(): View<number, string> { return new Box<string, number>(3, "closed"); }`,
  `function open<Outer, Inner>(owner: Box<Outer, Inner>): View<Inner, Outer> { return owner; }`)}
export function run(): boolean {
  const owner = new Box<string, number>(3, "before");
  const view: View<number, string> = owner;
  view.writeFirst(7);
  owner.second = "after";
  if (owner.first !== 7 || view.first !== 7 || view.readFirst() !== 7 || view.second !== "after" || view.readSecond() !== "after") return false;
  const selected = closed();
  if (selected.first !== 3 || selected.readSecond() !== "closed") return false;
  ${order === "closed-only" ? "" : `const reversed = new Box<number, string>("inner", 9); if (open(reversed).readFirst() !== "inner" || open(reversed).readSecond() !== 9) return false;`}
  return true;
}
export function main(): void { if (!run()) throw new Error("permuted inherited structural view"); }
`;
}

function getterSource(order) {
  return `
type Selected<T> = { readonly selected?: T };
class Base<T> {
  fail = false;
  constructor(public value: T) {}
  get selected(): T {
    if (this.fail) throw new Error("selected getter failed");
    return this.value;
  }
}
class Box<T> extends Base<T> { constructor(value: T) { super(value); } }
${orderedDeclarations(order,
  `function closed(): Selected<string> { return new Box<string>("closed"); }`,
  `function open<T>(owner: Box<T>): Selected<T> { return owner; }`)}
export function run(): boolean {
  const owner = new Box<string>("before");
  const selected: Selected<string> = owner;
  owner.value = "after";
  if (selected.selected !== "after" || closed().selected !== "closed") return false;
  owner.fail = true;
  let caught = false;
  try { const ignored = selected.selected; if (ignored === "before") return false; } catch { caught = true; }
  if (!caught) return false;
  ${order === "closed-only" ? "" : `const numeric = new Box<number>(7); if (open(numeric).selected !== 7) return false;`}
  return true;
}
export function main(): void { if (!run()) throw new Error("fallible structural view order"); }
`;
}

for (const surfaces of [[], ["js"]]) {
  for (const order of ["closed-only", "closed-first", "open-first"]) {
    for (const [name, source] of [["constant", constantSource], ["dependent", dependentSource], ["permuted", permutedSource], ["getter", getterSource]]) {
      test(`${name} generic structural views preserve native ABI and live state ${order} in ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
        const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
          files: { "index.ts": source(order) } });
        assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 6).map(row => row.message.slice(0, 256)).join("\n"));
        const emitted = rustSourceText(result);
        assert.equal(/unsafe\s*\{|MaybeUninit|assume_init|transmute|downcast_unchecked/u.test(emitted), false,
          "the structural ABI must retain statically selected native dispatch");
        const native = validateGeneratedProject(`generic-structural-view-${name}-${order}-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
        assert.equal(native.status, 0, native.stdout + native.stderr);
      });
    }
  }
  test(`generic structural views reject incompatible carriers and readonly destinations in ${surfaces[0] ?? "native"}`, () => {
    for (const [name, source] of [
      ["incompatible field", "type View<T> = { readonly value?: T }; class Box<T> { constructor(public value: T) {} } const view: View<string> = new Box<number>(1);"],
      ["incompatible method", "type View<T> = { read(): T }; class Box<T> { constructor(public value: T) {} read(): T { return this.value; } } const view: View<string> = new Box<number>(1);"],
      ["readonly write", "type View<T> = { readonly value?: T }; class Box<T> { constructor(public value: T) {} } const view: View<number> = new Box<number>(1); view.value = 2;"],
    ]) {
      const session = createRustSession({ surfaces, files: { "index.ts": source } });
      assert.match(rustSourceDiagnostics(session), /error TS(?:2322|2540)/u, name);
    }
  });
}
