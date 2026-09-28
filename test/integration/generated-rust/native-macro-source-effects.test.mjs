import assert from "node:assert/strict";
import { test } from "node:test";
import { artifactText, compileRustThroughTargetPack } from "../../helpers/rust-session.mjs";
import { assertMacroProjectUnpublished, createMacroProject, verifyMacroProject } from "../../helpers/native-macro-project.mjs";

test("native macros discard, repeat, assign and return without eager source-call effects", { timeout: 300_000 }, () => {
  const project = createMacroProject("native_macro_effects");
  const { result } = compileRustThroughTargetPack({ target: project.target, files: { "index.ts": `
    import type { int32 } from "@tsonic/core/types.js";
    import { check, discard, twice, initialize, leave } from "@tsonic/rust/crates/macro_proofs/index.js";
    import { tokens } from "@tsonic/rust/lang.js";
    let calls: int32 = 0;
    function next(): int32 { calls += 1; return calls; }
    function choose(early: boolean): int32 {
      if (early) { leave(19); }
      return 7;
    }
    export function main(): void {
      check(discard(missingBinding()) === 31);
      check(discard(next()) === 31);
      check(calls === 0);
      check(twice(next()) === 3);
      check(calls === 2);
      let value: int32;
      initialize(value, 23);
      check(value === 23);
      check(twice(tokens\`(\${next()})\`) === 7);
      check(calls === 4);
      check(choose(true) === 19 && choose(false) === 7);
    }
  ` } });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /macro_proofs::discard!\(missingBinding\(\)\)/u);
  assert.match(source, /macro_proofs::twice!\(next\(\)\)/u);
  assert.match(source, /macro_proofs::initialize!\(value, 23\)/u);
  assert.match(source, /macro_proofs::leave!\(19\)/u);
  verifyMacroProject(project, result.artifacts);
});

test("a conditional native assignment does not establish definite initialization", { timeout: 300_000 }, () => {
  const project = createMacroProject("native_macro_conditional");
  assert.throws(() => compileRustThroughTargetPack({ target: project.target, files: { "index.ts": `
    import type { int32 } from "@tsonic/core/types.js";
    import { check, initialize_when } from "@tsonic/rust/crates/macro_proofs/index.js";
    function read(condition: boolean): int32 {
      let value: int32;
      initialize_when(condition, value, 1);
      return value;
    }
    export function main(): void { check(read(false) === 0); }
  ` } }), /(?:possibly-uninitialized|used before being assigned)/u);
  assertMacroProjectUnpublished(project);
});

test("ordinary calls still check operands beside a discarding native macro", { timeout: 300_000 }, () => {
  const project = createMacroProject("native_macro_ordinary_control");
  assert.throws(() => compileRustThroughTargetPack({ target: project.target, files: { "index.ts": `
    import { check, discard } from "@tsonic/rust/crates/macro_proofs/index.js";
    export function main(): void {
      check(discard(missingInsideMacro()) === 31);
      check(missingOutsideMacro());
    }
  ` } }), error => {
    assert.match(error.message, /Cannot find name 'missingOutsideMacro'/u);
    assert.doesNotMatch(error.message, /Cannot find name 'missingInsideMacro'/u);
    return true;
  });
  assertMacroProjectUnpublished(project);
});

test("native macro facets and ordinary native functions keep their distinct contracts", { timeout: 300_000 }, () => {
  const project = createMacroProject("native_macro_facets", { procedural: true });
  const { result } = compileRustThroughTargetPack({ target: project.target, files: { "index.ts": `
    import type { int32 } from "@tsonic/core/types.js";
    import { check, sum_pair as plus, selected } from "@tsonic/rust/crates/macro_proofs/index.js";
    import * as proofs from "@tsonic/rust/crates/macro_proofs/index.js";
    import { triple as timesThree } from "@tsonic/rust/crates/native_macros/index.js";
    import { native } from "@tsonic/rust/lang.js";
    function ordinary(left: int32, right: int32): int32 { return left * right; }
    export function main(): void {
      const inferred = plus(4, 5);
      check(inferred === 9);
      check(proofs.sum_pair(3, 7) === 10);
      check(timesThree(4) === 12);
      check(native.macro(selected)(7, 3) === 10);
      check(native.value(selected)(7, 3) === 4);
      check(ordinary(7, 3) === 21);
    }
  ` } });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /macro_proofs::selected!\(7, 3\)/u);
  assert.match(source, /macro_proofs::selected\(7, 3\)/u);
  assert.match(source, /native_macros::triple!\(4\)/u);
  verifyMacroProject(project, result.artifacts);
});

test("macro borrows retain the native carrier without an extra payload owner", { timeout: 300_000 }, () => {
  const project = createMacroProject("native_macro_borrow");
  const { result } = compileRustThroughTargetPack({ target: project.target, files: { "index.ts": `
    import { check, OwnedValue, borrow } from "@tsonic/rust/crates/macro_proofs/index.js";
    export function main(): void {
      const value = new OwnedValue(11);
      const borrowed = borrow(value);
      check(borrowed.value === 11 && value.value === 11);
    }
  ` } });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /macro_proofs::borrow!\(value\)/u);
  assert.doesNotMatch(source, /(?:\.clone\(|Rc::|Arc::|RefCell::|Box::)/u);
  verifyMacroProject(project, result.artifacts);
});

test("a consuming macro cannot silently clone a non-Clone native value", { timeout: 300_000 }, () => {
  const project = createMacroProject("native_macro_moved");
  assert.throws(() => compileRustThroughTargetPack({ target: project.target, files: { "index.ts": `
    import { check, OwnedValue, consume } from "@tsonic/rust/crates/macro_proofs/index.js";
    export function main(): void {
      const value = new OwnedValue(11);
      consume(value);
      check(value.value === 11);
    }
  ` } }), /(?:use|borrow) of moved value/u);
  assertMacroProjectUnpublished(project);
});

test("a contextual source annotation is a native constraint, not evidence of the macro result", { timeout: 300_000 }, () => {
  const project = createMacroProject("native_macro_result_control");
  assert.throws(() => compileRustThroughTargetPack({ target: project.target, files: { "index.ts": `
    import type { int32 } from "@tsonic/core/types.js";
    import { check, string_value } from "@tsonic/rust/crates/macro_proofs/index.js";
    export function main(): void {
      const value: int32 = string_value();
      check(value === 0);
    }
  ` } }), /(?:not assignable|mismatched types)/u);
  assertMacroProjectUnpublished(project);
});
