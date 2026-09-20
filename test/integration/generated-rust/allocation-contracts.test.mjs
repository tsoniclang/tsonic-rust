import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText, analyzeRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { rustModuleBindingFactKey } from "../../../dist/analysis/facts/keys.js";

test("owned exits, static text, direct helpers and scoped array reads execute without extra owners", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
const separator = "/";
function checkToken(value: string): boolean { return rightParen(value); }
const rightParen = (value: string): boolean => value === ")";
function ensureSlash(value: string): string { return value.endsWith("/") ? value : value + "/"; }
function dispatch(kind: string, payload: string): number { return kind === "size" ? payload.length : 0; }
function retained(value: string): () => string { return () => value; }
let calls = 0;
function append(values: string[]): number { calls++; values.push("tail"); return values.length - 1; }
export function main(): void {
  const values = ["café", "a", "😀"];
  const size = values[append(values)]!.length;
  values.sort((left, right) => left.length - right.length);
  if (size !== 4 || calls !== 1 || values[0] !== "a" || !checkToken(")") ||
    ensureSlash("ok/") !== "ok/" || ensureSlash("ok") !== "ok/" ||
    dispatch("size", "café😀") !== 9 || retained("kept")() !== "kept" || separator !== "/") {
    throw new Error("allocation contract");
  }
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /const SEPARATOR: &str|const separator: &str/u);
  assert.match(output, /fn right_paren\(value: &str\)/u);
  assert.match(output, /fn check_token\(value: &str\)/u);
  assert.match(output, /fn dispatch\(kind: &str, payload: &str\)/u);
  assert.match(output, /fn retained\(value: String\)/u);
  assert.match(output, /with_number_element/u);
  assert.match(output, /sort_borrowed/u);
  const ensure = output.slice(output.indexOf("fn ensure_slash"), output.indexOf("fn dispatch"));
  assert.doesNotMatch(ensure, /value\.clone\(\)/u);
  validateGeneratedProject("native-allocation-contracts", result.artifacts, { run: true });
});

test("ownership proof keeps loop, finalizer, retained-comparator and alias semantics", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
let observed = "";
function finalize(value: string): string { try { return value; } finally { observed = value; } }
function repeat(value: string): string { let text = ""; for (let index = 0; index < 2; index++) text += value; return text; }
export function main(): void {
  const values = ["bb", "a"];
  const saved = values[0]!;
  values[0] = "changed";
  values.sort((left, right) => { observed = left; return left.length - right.length; });
  if (saved !== "bb" || repeat(saved) !== "bbbb" || finalize(saved) !== "bb" || observed !== "bb")
    throw new Error("ownership was erased");
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.doesNotMatch(output, /sort_borrowed/u);
  assert.match(output, /get_number/u);
  validateGeneratedProject("native-retained-ownership", result.artifacts, { run: true });
});

test("local receiver field results do not force shared object storage", () => {
  for (const [body, expected] of [
    ["read(): number { return this.position; }", "value"],
    ["read(): Parser { return this; }", "shared-immutable"],
    ["read(): () => number { return () => this.position; }", "shared-immutable"],
  ]) {
    const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
      class Parser { position = 0; ${body} }
      export function run(): void { const parser = new Parser(); parser.read(); }
    ` } });
    assert.equal(program.objectRepresentations.representations.find(value => value.definition.sourceName === "Parser")?.kind,
      expected, body);
  }
});

test("last-use moves respect overlapping argument borrows without penalizing completed reads", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
function select(first: string, second: string): string { return first.length === 0 ? "empty" : second; }
function identity(value: string): string { return value; }
function length(value: string): number { return value.length; }
function afterLength(size: number, value: string): string { return size === 0 ? "empty" : value; }
function owned(first: string, second: string): string[] { return [first, second]; }
export function main(): void {
  const direct = "direct";
  const directResult = select((direct), direct);
  const nested = "nested";
  const nestedResult = select(nested, identity(nested));
  const completed = "completed";
  const completedResult = afterLength(length(completed), completed);
  const copies = "copies";
  const ownedResult = owned(copies, copies);
  if (directResult !== "direct" || nestedResult !== "nested" || completedResult !== "completed" ||
      ownedResult[0] !== "copies" || ownedResult[1] !== "copies") throw new Error("argument ownership");
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /select\(&direct, direct\.clone\(\)\)/u);
  assert.match(output, /select\(&nested, identity\(nested\.clone\(\)\)\)/u);
  assert.match(output, /after_length\(length\(&completed\)\?, completed\)/u);
  assert.match(output, /owned\(copies\.clone\(\), copies\)/u);
  validateGeneratedProject("overlapping-argument-borrows", result.artifacts, { run: true });
});

test("static string selection preserves exported bindings and deferred default reads", () => {
  for (const [source, storage] of [
    ['const value = "ready"; export function read(): string { return value; }', "native-const"],
    ['export const value = "public";', "module-cell"],
    ['import { addressOf, loadPointer } from "@tsonic/core/lang.js"; let value = "ready"; export function read(): string { return loadPointer(addressOf(value)); }', "module-cell"],
    ['export const result = read(); const value = "later"; function read(input: string = value): string { return input; }', "module-cell"],
    ['const value = "ready"; export const result = read(); function read(input: string = value): string { return input; }', "native-const"],
  ]) {
    const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": source } });
    const ast = program.source.ast;
    let declaration;
    const visit = node => {
      if (ast.is.IsVariableDeclaration(node) && ast.text(ast.name(node)) === "value") declaration = node;
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    program.sourceFiles.forEach(visit);
    assert.notEqual(declaration, undefined);
    assert.equal(program.facts.getFact(declaration, rustModuleBindingFactKey)?.storage, storage, source);
  }
  assert.throws(() => analyzeRust({ surfaces: ["js"], files: { "index.ts":
    'import { addressOf } from "@tsonic/core/lang.js"; const value = "ready"; export const pointer = addressOf(value);',
  } }), /addressOf\(\.\.\.\) requires writable storage/u);
});

test("non-consuming comparisons preserve authored clone calls and their effects", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
let calls = 0;
class Counter { clone(): string { calls++; return "value"; } }
export function main(): void {
  const counter = new Counter();
  let matches = 0;
  if (counter.clone() !== undefined) matches++;
  if ((counter.clone()) === "value") matches++;
  if ((counter.clone() as string) !== undefined) matches++;
  if (matches !== 3 || calls !== 3) throw new Error("authored call was erased");
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.equal([...output.matchAll(/counter\.clone\(\)/gu)].length, 3);
  validateGeneratedProject("authored-clone-effects", result.artifacts, { run: true });
});

test("borrow proofs respect retained callable ABIs through direct and indirect forwarding", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
const normalize = (value: string): string => value.replaceAll("x", "");
function width(value: string): number { return normalize(value).length; }
function direct(values: string[]): void { values.sort((left, right) => normalize(left).length - normalize(right).length); }
function indirect(values: string[]): void { values.sort((left, right) => width(left) - width(right)); }
export function main(): void {
  const first = ["bbb", "xa", "cc"];
  const second = ["xxxz", "yyy", "aa"];
  direct(first);
  indirect(second);
  if (first.join("|") !== "xa|cc|bbb" || second.join("|") !== "xxxz|aa|yyy")
    throw new Error("retained callable ABI");
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /ModuleCell<NormalizeCallable>/u);
  assert.match(output, /fn width\(value: String\)/u);
  assert.doesNotMatch(output, /sort_borrowed/u);
  validateGeneratedProject("retained-callable-borrow-proof", result.artifacts, { run: true });
});

test("value and retained cursor methods keep exact receiver lint contracts", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
class LocalCursor {
  position = 0;
  next(): number { this.position++; return this.position; }
}
export class RetainedCursor {
  position = 0;
  next(): number { this.position++; return this.position; }
}
export function retain(): RetainedCursor { return new RetainedCursor(); }
export function main(): void {
  const local = new LocalCursor();
  const retained = retain();
  const alias = retained;
  if (local.next() !== 1 || local.next() !== 2 || retained.next() !== 1 || alias.next() !== 2)
    throw new Error("cursor receiver contract");
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /fn next\(&mut self\)/u);
  assert.match(output, /fn next\(&self\)/u);
  validateGeneratedProject("cursor-receiver-lint-contract", result.artifacts, { run: true });
});
