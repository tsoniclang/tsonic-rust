import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { authoredGenericBinderFiles } from "../../../../tsonic/test/fixtures/authored-generic-binders.mjs";

test("authored generic binders retain independent identities across modules and records", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "authored_generic_binders" } },
    files: {
      "factory.ts": "export function identity<T>(value: T): T { return value; }",
      "other.ts": authoredGenericBinderFiles["other.ts"],
      "index.ts": `
        import { identity } from "./factory.js";
        import { identity as other, pair } from "./other.js";
        export { pair } from "./other.js";
        export function main(): void {
          const text = pair(other(identity("record")));
          const count = pair(identity(other(7)));
          if (text.left !== "record" || text.right !== "record" ||
            count.left !== 7 || count.right !== 7 || !other(identity(true))) {
            throw new Error("authored generic binders");
          }
        }
      `,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const generated = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.match(generated, /\bfn identity<T\b/u);
  assert.doesNotMatch(generated, /\b(?:identity|pair)<T[0-9]+\b/u);
  assert.match(generated, /fn pair<T: Clone>\(value: T\)/u);
  assert.match(generated, /let record_left = value\.clone\(\);\s*let record_right = value;/u);
  const native = validateGeneratedProject("authored-generic-binders", [...result.artifacts, {
    path: "tests/storage_cost.rs",
    text: `use authored_generic_binders::pair;
use std::sync::atomic::{AtomicUsize, Ordering};

static CLONES: AtomicUsize = AtomicUsize::new(0);
static DROPS: AtomicUsize = AtomicUsize::new(0);

struct Value;

impl Clone for Value {
    fn clone(&self) -> Self {
        CLONES.fetch_add(1, Ordering::SeqCst);
        Value
    }
}

impl Drop for Value {
    fn drop(&mut self) {
        DROPS.fetch_add(1, Ordering::SeqCst);
    }
}

#[test]
fn record_storage_clones_once_and_moves_the_last_value() {
    let record = pair(Value);
    assert_eq!(CLONES.load(Ordering::SeqCst), 1);
    assert_eq!(DROPS.load(Ordering::SeqCst), 0);
    drop(record);
    assert_eq!(DROPS.load(Ordering::SeqCst), 2);
}
`,
  }], { run: true });
  assert.equal(native.status, 0, native.stderr || native.stdout);
});

test("generic storage requirements preserve single uses, repetitions and finalizer observations", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
    import type { int32 } from "@tsonic/core/types.js";
    export type Entry<T> = { value: T };
    export function single<T>(value: T): Entry<T> { return { value }; }
    export function repeated<T>(value: T, count: int32): void {
      for (let index: int32 = 0; index < count; index++) { const entry: Entry<T> = { value }; }
    }
    export function finalized<T>(value: T): Entry<T> {
      try { return { value }; } finally { const retained: Entry<T> = { value }; }
    }
  ` } });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /fn single<T>\(value: T\)/u);
  assert.match(output, /fn repeated<T: Clone>\(value: T, count: i32\)/u);
  assert.match(output, /fn finalized<T: Clone>\(value: T\)/u);
  assert.doesNotMatch(output.slice(output.indexOf("fn single"), output.indexOf("fn repeated")), /value\.clone\(\)/u);
  assert.match(output.slice(output.indexOf("fn repeated"), output.indexOf("fn finalized")), /value\.clone\(\)/u);
  assert.equal([...output.slice(output.indexOf("fn finalized")).matchAll(/value\.clone\(\)/gu)].length, 2);
  validateGeneratedProject("generic-storage-observations", result.artifacts);
});

test("polymorphic structural factory storage rejects without publishing partial artifacts", () => {
  const { result } = compileRust({ surfaces: ["js"], files: authoredGenericBinderFiles });
  assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.code), [
    "RUST_SOURCE_CALL_RESULT_STORAGE_MISSING",
    "RUST_SOURCE_CALL_RESULT_STORAGE_MISSING",
    ...Array.from({ length: 6 }, () => "RUST_STRUCTURAL_METHOD_CONTRACT_INVALID"),
  ]);
  assert.ok(result.diagnostics.every(diagnostic => diagnostic.category === "error"));
  assert.deepEqual(result.artifacts, []);
});
