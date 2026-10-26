import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";

test("retained callable adapters propagate static requirements from their actual native destination", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
export function retain<Value>(value: Value): Promise<number> {
  return new Promise<number>(resolve => {
    void Promise.resolve(0).then(() => { void value; });
    resolve(7);
  });
}
` } });
  assert.equal(result.diagnostics.length, 0, "the owned generic callback is admitted");
  assert.match(artifactText(result, "src/index.rs"), /fn retain<Value: Clone \+ 'static>/u,
    "the enclosing generic contract includes the adapter's required owned lifetime");
});

test("synchronous native callback adapters do not impose a static generic bound", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
export function consume<Value>(value: Value): void {
  [0].forEach(() => { void value; });
}
` } });
  assert.equal(result.diagnostics.length, 0, "the synchronous generic callback is admitted");
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /fn consume<Value>/u, "the transferred capture requires no unnecessary generic bound");
  assert.doesNotMatch(source, /fn consume<Value:[^>]*'static/u,
    "no retained destination exists for this synchronous callback");
});
