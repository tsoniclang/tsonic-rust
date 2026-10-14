import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, artifactText, compileRust } from "../../helpers/rust-session.mjs";

const sourceText = [
  'import { hashptr } from "@tsonic/core/lang.js";',
  'import type { Pointer } from "@tsonic/core/types.js";',
  "export function count<T>(values: Pointer<T> | undefined): number { return hashptr(values); }",
  "export function compare(left: string, right: string): boolean { return left === right; }",
  "export function single<T>(value: T): T { return value; }",
  "export function reused(value: string): string { const first = value; return first + value; }",
].join("\n");

test("native storage borrowing is selected before planning without a Clone requirement on an unread payload", () => {
  const { program } = analyzeRust({ files: { "index.ts": sourceText } });
  const { ast } = program.source;
  const selected = new Map();
  const visit = node => {
    const binding = program.records.sourceBinding.get(node);
    if (binding?.scope === "lexical" && ast.is.IsIdentifier(node)) {
      const owner = ast.parent(binding.sourceDeclaration);
      const name = owner === undefined ? undefined : ast.text(ast.name(owner));
      if (["count", "compare", "single"].includes(name)) {
        const reads = selected.get(name) ?? [];
        const fact = program.ownership.reads.get(node);
        assert.equal(fact !== undefined, true, name + " selected read");
        reads.push(fact.value.kind);
        selected.set(name, reads);
      }
    }
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.sourceFiles) visit(file);
  assert.deepEqual(selected.get("count"), ["borrow"]);
  assert.deepEqual(selected.get("compare"), ["borrow", "borrow"]);
  assert.deepEqual(selected.get("single"), ["move"]);
  const { result } = compileRust({ files: { "index.ts": sourceText } });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  const count = output.slice(output.indexOf("pub fn count"), output.indexOf("pub fn compare"));
  assert.doesNotMatch(count, /Clone|\.clone\(\)/u);
  const single = output.slice(output.indexOf("pub fn single"), output.indexOf("pub fn reused"));
  assert.doesNotMatch(single, /Clone|\.clone\(\)/u);
});
