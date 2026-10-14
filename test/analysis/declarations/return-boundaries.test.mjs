import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";

// A return statement inside a nested callable body is not a return of the enclosing function. The callable body
// boundary is the shared isSourceCallableBodyBoundary from @tsonic/target-api/source. The C# owner test
// test/analysis/declarations/return-boundaries.test.mjs uses the same sources once its C# predicate is migrated.
const localClass = constructorBody => `export function make() {
  class Local {
    tag: number = 2;
${constructorBody}
  }
  return new Local().tag;
}
`;

function makeSignature(sourceText) {
  const { result } = compileRust({ files: { "index.ts": sourceText } });
  assert.deepEqual(result.diagnostics.map(diagnostic => diagnostic.code), []);
  const rust = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  const signature = rust.match(/^pub fn make\(\) -> [^{]+/mu)?.[0].trim();
  assert.ok(signature, "make is emitted");
  return signature;
}

test("a constructor return inside a local class is not a return of the enclosing function", { timeout: 300_000 }, () => {
  const withConstructorReturn = makeSignature(localClass("    constructor() {\n      return this;\n    }"));
  const withoutConstructor = makeSignature(localClass(""));
  assert.equal(withConstructorReturn, "pub fn make() -> f64");
  assert.equal(withConstructorReturn, withoutConstructor);
});

test("an arrow function return is not a return of the enclosing function", { timeout: 300_000 }, () => {
  assert.equal(makeSignature(`export function make() {
  const inner = (): boolean => { return true; };
  return inner() ? 1 : 0;
}
`), "pub fn make() -> f64");
});
