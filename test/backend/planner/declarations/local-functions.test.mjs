import assert from "node:assert/strict";
import test from "node:test";
import { artifactText, compileRust } from "../../../helpers/rust-session.mjs";
import { finiteCompletionSequencingSource } from "../../../../../tsonic/test/fixtures/finite-completion-sequencing.mjs";
import { lexicalGenericFunctionsSource } from "../../../../../tsonic/test/fixtures/lexical-generic-functions.mjs";

function generated(source, surface) {
  const { result } = compileRust({ files: { "index.ts": source }, surfaces: surface === "js" ? ["js"] : [] });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(diagnostic => diagnostic.message).join("\n"));
  return artifactText(result, "src/index.rs");
}

for (const surface of ["native", "js"]) {
  test(`lexical functions retain exact outer binders and generic shadowing in ${surface}`, () => {
    const source = generated(lexicalGenericFunctionsSource, surface);
    assert.match(source, /fn forward<T>\(inner: T\) -> T/u);
    assert.match(source, /forward::<T>\(outer\)/u);
    assert.match(source, /fn through<U, T[^>]*>/u);
    assert.match(source, /fn identity<T[^>]*>\(inner: T\) -> T/u);
    assert.match(source, /fn captureOuter<T>\(value: T\) -> T/u);
    assert.match(source, /fn read<T>\([^)]*: T\) -> T/u);
    assert.doesNotMatch(source.slice(source.indexOf("fn captureOuter"), source.indexOf("fn shadowOuter")), /clone\(/u);
    assert.doesNotMatch(source, /Any|Box::|Location::allocate|Function::new/u);
  });
  test(`lexical functions retain hoisting and mutual recursion in ${surface}`, () => {
    const source = generated(`
      import type { int32 } from "@tsonic/core/types.js";
      export function run(): int32 {
        const before = even(4 as int32);
        function even(value: int32): int32 { if (value === 0) return 1 as int32; return odd((value - 1) as int32); }
        function odd(value: int32): int32 { if (value === 0) return 0 as int32; return even((value - 1) as int32); }
        return before;
      }`, surface);
    assert.match(source, /fn even\(value: i32\)/u);
    assert.match(source, /fn odd\(value: i32\)/u);
    assert.doesNotMatch(source, /(?:crate::index|self)::(?:even|odd)|Rc|RefCell|Location::allocate|Function::new/u);
  });

  test(`direct lexical captures use invocation-scoped stack borrows in ${surface}`, () => {
    const source = generated(`
      import type { int32 } from "@tsonic/core/types.js";
      export function run(): int32 {
        let current = 0 as int32;
        function increment(): int32 { current += 1; return current; }
        function outer(): int32 { return increment(); }
        const first = outer();
        return (current + increment() + first) as int32;
      }`, surface);
    assert.match(source, /fn increment\([^)]*: &mut i32\)/u);
    assert.match(source, /fn outer\([^)]*: &mut i32\)/u);
    assert.match(source, /increment\(&mut /u);
    assert.doesNotMatch(source, /Rc|RefCell|Location::allocate|Function::new|clone\(/u);
  });

  test(`lexical generic functions reuse their native signature owner in ${surface}`, () => {
    const source = generated(`
      import type { int32 } from "@tsonic/core/types.js";
      export function run(): int32 {
        function identity<T>(value: T): T { return value; }
        return identity(3 as int32);
      }`, surface);
    assert.match(source, /fn identity<T[^>]*>\(value: T\) -> T/u);
    assert.doesNotMatch(source, /Rc|RefCell|Location::allocate|Function::new/u);
  });

  test(`lexical readers do not borrow mutably because another function writes in ${surface}`, () => {
    const source = generated(`
      import type { int32 } from "@tsonic/core/types.js";
      export function run(): int32 {
        let current = 1 as int32;
        function read(): int32 { return current; }
        function write(): void { current = 2 as int32; }
        const before = read();
        write();
        return (before + read()) as int32;
      }`, surface);
    assert.equal(/fn read\([^)]*: i32\)/u.test(source), true, "the immutable scalar capture uses its exact native Copy contract");
    assert.equal(/fn write\([^)]*: &mut i32\)/u.test(source), true, "the exact writer takes a mutable native borrow");
    assert.equal(/Rc|RefCell|Location::allocate|Function::new|clone\(/u.test(source), false);
  });

  test(`finite sequencing retains authored lexical declarations in ${surface}`, () => {
    const source = generated(finiteCompletionSequencingSource, surface);
    assert.match(source, /fn mutate\(/u);
    assert.match(source, /fn first\(/u);
    assert.match(source, /await/u);
  });
}
