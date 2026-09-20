import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText, analyzeRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

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
    ["read(): Parser { return this; }", "shared-mutable"],
    ["read(): () => number { return () => this.position; }", "shared-mutable"],
  ]) {
    const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
      class Parser { position = 0; ${body} }
      export function run(): void { const parser = new Parser(); parser.read(); }
    ` } });
    assert.equal(program.objectRepresentations.representations.find(value => value.definition.sourceName === "Parser")?.kind,
      expected, body);
  }
});
