import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";

test("native artifact publication preserves exact public signatures and implementations", () => {
  const compile = source => {
    const { result } = compileRust({ files: { "index.ts": source } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(issue => issue.code + ": " + issue.message).join("; "));
    return result;
  };
  const first = compile("export function value(): number { return 1; }");
  const changedBody = compile("export function value(): number { return 2; }");
  const changedSignature = compile("export function value(): boolean { return true; }");
  const text = result => artifactText(result, "src/index.rs");
  const signature = result => text(result).match(/pub fn value\([^\n]*\{/u)?.[0];
  assert.equal(signature(first) !== undefined, true, "the authored exported function has a native signature");
  assert.equal(signature(first), signature(changedBody), "body changes do not change the native public ABI");
  assert.notEqual(text(first), text(changedBody), "the changed implementation is published");
  assert.notEqual(signature(first), signature(changedSignature), "a changed return carrier changes the native ABI");
  for (const result of [first, changedBody, changedSignature]) {
    const artifacts = result.program.records.sourceArtifacts.get();
    assert.equal(artifacts.length, 1, "the checked module has one pre-seal artifact owner");
    assert.equal(Object.isFrozen(artifacts) && Object.isFrozen(artifacts[0]), true);
    assert.equal(Object.hasOwn(result.program, "artifactGraph"), false, "the planner has no lazy reconstruction service");
  }
});
