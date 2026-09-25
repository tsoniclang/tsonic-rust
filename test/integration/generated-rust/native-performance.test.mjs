import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText, acmeTestingPackage, analyzeRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("native String operations retain UTF-8 units without a JS surface", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
export function main(): void {
  const text = "café😀";
  check(text.len() === 9);
  check(!text.is_empty());
  check(text.contains("😀"));
  check(text.starts_with("café"));
  check(text.ends_with("😀"));
  check(text.find("😀") === 5);
  check(text.rfind("é") === 3);
  check(text.find("missing") === undefined);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /\.len\(\)/u);
  assert.doesNotMatch(output, /encode_utf16|js_string::/u);
  validateGeneratedProject("native-string-operations", result.artifacts, { run: true });
});

test("read-only string forwarding and fresh async results preserve values", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin" } },
    files: { "length.ts": `export function readLength(value: string): number { return value.length; }`, "index.ts": `
import { readLength } from "./length.js";
interface Point { x: number; y: number }
function forward(value: string): number { return readLength(value); }
function retain(value: string): () => string { return () => value; }
function localRecord(): number {
  const point: Point = { x: 3, y: 4 };
  point.x += 1;
  return point.x + point.y;
}
async function text(): Promise<string> { return "result"; }
export async function main(): Promise<void> {
  const value = "café😀";
  const retained = retain(value);
  if (forward(value) !== 9 || retained() !== value || localRecord() !== 8 ||
      await text() !== "result") throw new Error("native ownership contract");
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /fn forward\(value: &(?:String|str)\)/u);
  assert.match(output, /fn retain\(value: String\)/u);
  assert.doesNotMatch(output, /PointState|ObjectHandle/);
  assert.match(output, /into_(?:result|value)\(\)/u);
  validateGeneratedProject("native-read-only-forwarding", result.artifacts, { run: true });
});

test("local record value storage never erases observable identity or escape", () => {
  const cases = [
    { body: `const point: Point = { x: 3, y: 4 }; return point.x + point.y;`, result: "number", kind: "value" },
    { body: `const point: Point = { x: 3, y: 4 }; const alias = point; alias.x = 8; return point.x;`, result: "number", kind: "shared-mutable" },
    { body: `const point: Point = { x: 3, y: 4 }; return point === point;`, result: "boolean", kind: "shared-mutable" },
    { body: `const point: Point = { x: 3, y: 4 }; return point;`, result: "Point", kind: "shared-mutable" },
    { body: `const point: Point = { x: 3, y: 4 }; return () => point.x;`, result: "() => number", kind: "shared-mutable" },
    { body: `let point: Point = { x: 3, y: 4 }; point = { x: 5, y: 6 }; return point.x;`, result: "number", kind: "shared-mutable" },
    { body: `const point: Point = { x: 3, y: 4 }; return point.x;`, result: "number", kind: "shared-mutable", exported: true },
  ];
  for (const scenario of cases) {
    const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
${scenario.exported ? "export " : ""}interface Point { x: number; y: number }
export function proof(): ${scenario.result} { ${scenario.body} }
` } });
    const representation = program.objectRepresentations.representations.find(value => value.definition.sourceName === "Point");
    assert.equal(representation?.kind, scenario.kind, scenario.body);
  }
});

test("native string dispatch borrows read-only inputs and owns retained inputs", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
interface Reader { read(value: string): number; }
class BorrowingReader implements Reader {
  read(value: string): number { return value.length; }
}
class RetainingReader implements Reader {
  value = "";
  read(value: string): number { this.value = value; return value.length; }
}
function invoke(reader: Reader, value: string): number { return reader.read(value); }
export function main(): void {
  const borrowing = new BorrowingReader();
  const retaining = new RetainingReader();
  const value = "café😀";
  check(invoke(borrowing, value) === 9);
  check(invoke(retaining, value) === 9);
  check(retaining.value === value);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.doesNotMatch(output, /\(\*[^)]+\)\.clone\(\)/u);
  validateGeneratedProject("native-string-dispatch", result.artifacts, { run: true });
});

for (const edition of ["2021", "2024"]) {
  test(`owned indexed reads preserve ${edition} evaluation regions`, { timeout: 300_000 }, () => {
    const { result } = compileRust({
      surfaces: ["js"],
      packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin", edition } },
      files: { "index.ts": `
import { check } from "@acme/testing";
let calls = 0;
function append(values: string[]): number {
  calls += 1;
  values.push("tail");
  return values.length - 1;
}
export function main(): void {
  const flow_input = "kept";
  const values = ["é", "😀"];
  const last = values[values.length - 1]!;
  const appended = values[append(values)]!;
  check(last === "😀" && appended === "tail");
  check(flow_input === "kept" && calls === 1 && values.length === 3);
}
` },
    });
    assert.deepEqual(result.diagnostics, []);
    const output = artifactText(result, "src/index.rs");
    assert.doesNotMatch(output, /match\s*\{/u);
    assert.doesNotMatch(output, /blocks_in_conditions/u);
    validateGeneratedProject(`native-owned-index-regions-${edition}`, result.artifacts, { run: true });
  });
}
