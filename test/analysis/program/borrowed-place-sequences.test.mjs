import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";

test("source place sequences retain ordered effects and borrow the actual array without copying", () => {
  const { result } = compileRust({ files: { "index.ts": `
function before(): void {}
function after(): void {}
export function read(values: readonly number[]): number { return (before(), (after(), values))[0]; }
` } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(issue => issue.code + ": " + issue.message).join("; "));
  const text = artifactText(result, "src/index.rs");
  const body = text.slice(text.indexOf("pub fn read"));
  assert.equal((body.match(/before\(\)/gu) ?? []).length, 1);
  assert.equal((body.match(/after\(\)/gu) ?? []).length, 1);
  assert.equal(body.indexOf("before()") < body.indexOf("after()"), true);
  assert.doesNotMatch(body, /\.clone\(|\.to_vec\(|Vec::from|Box::new|Rc::new/u, "borrowing a sequenced place adds no copy or owner");
});
