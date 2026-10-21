import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";

for (const [name, expression] of [
  ["true or false", "condition() ? true : false"],
  ["false or true", "condition() ? false : true"],
  ["both true", "condition() ? true : true"],
  ["both false", "condition() ? false : false"],
  ["nested matching branches", "condition() ? true : other() ? true : false"],
]) {
  test("source conditional retains exact effect order: " + name, () => {
    const { result } = compileRust({ files: { "index.ts": `
function condition(): boolean { return true; }
function other(): boolean { return false; }
export function run(): boolean { return ${expression}; }
` } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(issue => issue.code + ": " + issue.message).join("; "));
    const text = artifactText(result, "src/index.rs");
    const body = text.slice(text.indexOf("pub fn run"));
    assert.equal((body.match(/condition\(\)/gu) ?? []).length, 1, "the source condition is evaluated exactly once");
    if (name === "nested matching branches") {
      assert.equal((body.match(/other\(\)/gu) ?? []).length, 1);
      assert.equal(body.indexOf("condition()") < body.indexOf("other()"), true, "the second guard follows the original first guard");
    }
    assert.doesNotMatch(body, /Box::new|Rc::new|RefCell::new|\.clone\(/u, "branch construction adds no allocation or copy");
  });
}
