import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("the final stored field of an unaliased local generated value moves without cloning", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
class Record { text: string; count = 1; constructor(text: string) { this.text = text; } }
class SharedRecord { text: string; constructor(text: string) { this.text = text; } }
function extract(text: string): string { const value = new Record(text); return value.text; }
function afterRead(text: string): string {
  const value = new Record(text);
  if (value.count !== 1) throw new Error("count");
  return value.text;
}
function retained(text: string): string {
  const value = new Record(text);
  const first = value.text;
  value.text = "changed";
  return first + value.text;
}
function repeated(text: string): string {
  const value = new Record(text);
  let result = "";
  for (let index = 0; index < 2; index++) result += value.text;
  return result;
}
function finalized(text: string): string {
  const value = new Record(text);
  try { return value.text; } finally { if (value.text !== text) throw new Error("cleanup"); }
}
function branch(text: string, selected: boolean): string {
  const value = new Record(text);
  if (selected) return value.text;
  return value.text;
}
function observed(text: string): string {
  const value = new SharedRecord(text);
  const read = () => value.text;
  const first = value.text;
  value.text = "next";
  return first + read();
}
export function main(): void {
  if (extract("first") !== "first" || afterRead("second") !== "second" ||
    retained("old") !== "oldchanged" || repeated("x") !== "xx" ||
    finalized("cleanup") !== "cleanup" || branch("yes", true) !== "yes" ||
    branch("no", false) !== "no" || observed("old") !== "oldnext") throw new Error("field transfer");
}
` } });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  for (const name of ["extract", "after_read", "retained", "finalized", "branch", "observed"]) {
    assert.ok(output.includes(`fn ${name}(`), name);
  }
  const extract = output.slice(output.indexOf("fn extract"), output.indexOf("fn after_read"));
  const after = output.slice(output.indexOf("fn after_read"), output.indexOf("fn retained"));
  assert.doesNotMatch(extract, /value\.text\.clone\(\)/u);
  assert.doesNotMatch(after, /value\.text\.clone\(\)/u);
  assert.match(output.slice(output.indexOf("fn retained")), /value\.text\.clone\(\)/u);
  validateGeneratedProject("final-field-transfers", result.artifacts, { run: true });
});
