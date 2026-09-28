import assert from "node:assert/strict";
import { test } from "node:test";
import { artifactText, compileRustThroughTargetPack } from "../../helpers/rust-session.mjs";
import { assertMacroProjectUnpublished, createMacroProject, verifyMacroProject } from "../../helpers/native-macro-project.mjs";

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces.length === 0 ? "native" : "js";
  const length = profile === "native" ? "value.len()" : "value.length";
  test(`an unannotated macro result selects its ${profile} string operation`, { timeout: 300_000 }, () => {
    const project = createMacroProject(`native_macro_string_${profile}`, { surfaces });
    const { result } = compileRustThroughTargetPack({ target: project.target, files: { "index.ts": `
      import { check, owned_text } from "@tsonic/rust/crates/macro_proofs/index.js";
      export function main(): void {
        const value = owned_text();
        check(${length} === 9);
        check(${length} === 9);
      }
    ` } });
    assert.deepEqual(result.diagnostics, []);
    const source = artifactText(result, "src/index.rs");
    assert.match(source, /macro_proofs::owned_text!\(\)/u);
    assert.doesNotMatch(source, /(?:\.clone\(|Rc::|Arc::|RefCell::|Box::)/u);
    verifyMacroProject(project, result.artifacts);
  });

  test(`a macro-generated ${profile} record field is not a string property by spelling`, { timeout: 300_000 }, () => {
    const project = createMacroProject(`native_macro_field_${profile}`, { surfaces });
    const { result } = compileRustThroughTargetPack({ target: project.target, files: { "index.ts": `
      import type { uint64 } from "@tsonic/core/types.js";
      import { check, native_record } from "@tsonic/rust/crates/macro_proofs/index.js";
      function exact(): uint64 { return 9007199254740993n as uint64; }
      export function main(): void {
        const value = native_record();
        check(value.length === exact());
      }
    ` } });
    assert.deepEqual(result.diagnostics, []);
    const source = artifactText(result, "src/index.rs");
    assert.match(source, /macro_proofs::native_record!\(\)/u);
    assert.match(source, /value\.length/u);
    assert.doesNotMatch(source, /(?:value\.len\(|u64_to_f64|\.clone\(|Rc::|Arc::|RefCell::|Box::)/u);
    verifyMacroProject(project, result.artifacts);
  });
}

test("later native uses constrain an unannotated macro result without integer fallback", { timeout: 300_000 }, () => {
  const project = createMacroProject("native_macro_later_constraint");
  const { result } = compileRustThroughTargetPack({ target: project.target, files: { "index.ts": `
    import type { uint64 } from "@tsonic/core/types.js";
    import { check, empty_values } from "@tsonic/rust/crates/macro_proofs/index.js";
    function exact(): uint64 { return 18446744073709551615n as uint64; }
    export function main(): void {
      const values = empty_values();
      values.push(exact());
      check(values.len() === 1);
      check(values[0] === exact());
    }
  ` } });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /macro_proofs::empty_values!\(\)/u);
  assert.doesNotMatch(source, /(?:u64_to_f64|\.clone\(|Rc::|Arc::|RefCell::|Box::)/u);
  verifyMacroProject(project, result.artifacts);
});

test("incompatible later constraints on a macro result reject without publication", { timeout: 300_000 }, () => {
  const project = createMacroProject("native_macro_conflicting_constraints");
  assert.throws(() => compileRustThroughTargetPack({ target: project.target, files: { "index.ts": `
    import type { uint64 } from "@tsonic/core/types.js";
    import { empty_values } from "@tsonic/rust/crates/macro_proofs/index.js";
    function exact(): uint64 { return 18446744073709551615n as uint64; }
    export function main(): void {
      const values = empty_values();
      values.push(exact());
      values.push("not an integer");
    }
  ` } }), /(?:not assignable|mismatched types)/u);
  assertMacroProjectUnpublished(project);
});
