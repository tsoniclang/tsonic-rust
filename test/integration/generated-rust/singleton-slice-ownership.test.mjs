import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("singleton native slices borrow their exact source place before any owned clone", { timeout: 300_000 }, () => {
  const { result } = compileRust({ target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
function read(values: readonly string[]): boolean { return values[0] === "token"; }
export function main(): void {
  const text = "token";
  if (!read([text]) || text !== "token") throw new Error("singleton borrow changed");
}
main();
` } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
  const code = artifactText(result, "src/index.rs");
  assert.match(code, /read\(core::slice::from_ref\(&text\)\)/u);
  assert.doesNotMatch(code, /text\.clone\(\)|vec!\[/u);
  validateGeneratedProject("singleton-slice-place", result.artifacts, { run: true });
});

test("later source mutation retains the required singleton snapshot", { timeout: 300_000 }, () => {
  const { result } = compileRust({ target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
function read(values: readonly string[], count: int32): boolean { return values[0] === "old" && count === 1; }
export function main(): void {
  let text = "old";
  function change(): int32 { text = "new"; return 1; }
  if (!read([text], change()) || text !== "new") throw new Error("singleton snapshot changed");
}
main();
` } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
  const code = artifactText(result, "src/index.rs");
  assert.match(code, /text\.clone\(\)/u);
  assert.doesNotMatch(code, /core::slice::from_ref\(&text\)/u);
  validateGeneratedProject("singleton-slice-snapshot", result.artifacts, { run: true });
});

test("a borrowed str is not fabricated into a String storage place", { timeout: 300_000 }, () => {
  const { result } = compileRust({ target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
function read(values: readonly string[]): boolean { return values[0] === "view"; }
function pass(text: string): boolean { return read([text]); }
export function main(): void { if (!pass("view")) throw new Error("borrowed str changed"); }
main();
` } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
  assert.doesNotMatch(artifactText(result, "src/index.rs"), /core::slice::from_ref\(text\)/u);
  validateGeneratedProject("singleton-slice-str", result.artifacts, { run: true });
});
