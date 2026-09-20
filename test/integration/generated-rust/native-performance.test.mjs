import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("native String operations retain UTF-8 units without a JS surface", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
export function main(): void {
  const text = "café😀";
  if (text.len() !== 9 || text.is_empty() || !text.contains("😀") ||
      !text.starts_with("café") || !text.ends_with("😀") ||
      text.find("😀") !== 5 || text.rfind("é") !== 3 ||
      text.find("missing") !== undefined) throw "native string contract";
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
    files: { "index.ts": `
interface Point { x: number; y: number }
function readLength(value: string): number { return value.length; }
function forward(value: string): number { return readLength(value); }
function retain(value: string): () => string { return () => value; }
function localRecord(): number {
  const point: Point = { x: 3, y: 4 };
  return point.x + point.y;
}
async function text(): Promise<string> { return "result"; }
export async function main(): Promise<void> {
  const value = "café😀";
  const retained = retain(value);
  if (forward(value) !== 9 || retained() !== value || localRecord() !== 7 ||
      await text() !== "result") throw new Error("native ownership contract");
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /fn forward\(value: &(?:String|str)\)/u);
  assert.match(output, /into_(?:result|value)\(\)/u);
  validateGeneratedProject("native-read-only-forwarding", result.artifacts, { run: true });
});
