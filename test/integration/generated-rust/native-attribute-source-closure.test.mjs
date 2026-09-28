import assert from "node:assert/strict";
import { test } from "node:test";
import { artifactText, compileRustThroughTargetPack } from "../../helpers/rust-session.mjs";
import { assertMacroProjectUnpublished, createMacroProject, verifyMacroProject } from "../../helpers/native-macro-project.mjs";

test("module attributes expose exact generated exports to source callers", { timeout: 300_000 }, () => {
  const project = createMacroProject("native_generated_exports", { procedural: true });
  const { result } = compileRustThroughTargetPack({ target: project.target, files: {
    "values.ts": `
      import type { int32 } from "@tsonic/core/types.js";
      import { attribute } from "@tsonic/core/lang.js";
      import { publish } from "@tsonic/rust/crates/native_macros/index.js";
      attribute.module().add(() => publish());
      export function value(input: int32): int32 { return input + 7; }
    `,
    "index.ts": `
      import { check } from "@tsonic/rust/crates/macro_proofs/index.js";
      import { generated_value } from "./values.js";
      export function main(): void { check(generated_value(13) === 20); }
    `,
  } });
  assert.deepEqual(result.diagnostics, []);
  const source = result.artifacts.map(artifact => artifact.text).join("\n");
  assert.match(source, /#\[native_macros::publish(?:\(\))?\]/u);
  assert.match(source, /generated_value\(13\)/u);
  assert.doesNotMatch(source, /pub fn generated_value/u);
  verifyMacroProject(project, result.artifacts);
});

test("body-sensitive attributes receive the actual body and source sees only the effective body", { timeout: 300_000 }, () => {
  const project = createMacroProject("native_effective_body", { procedural: true });
  const { result } = compileRustThroughTargetPack({ target: project.target, files: { "index.ts": `
    import type { int32 } from "@tsonic/core/types.js";
    import { attribute } from "@tsonic/core/lang.js";
    import { check } from "@tsonic/rust/crates/macro_proofs/index.js";
    import { offset, replaced } from "@tsonic/rust/crates/native_macros/index.js";
    function calculate(input: int32): int32 { return input * 2; }
    attribute<typeof calculate>().add(() => offset(5));
    function replacement(): int32 { return missingInReplacedBody(); }
    attribute<typeof replacement>().add(() => replaced(41));
    export function main(): void {
      check(calculate(6) === 17);
      check(replacement() === 41);
    }
  ` } });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /#\[native_macros::offset\(5\)\]/u);
  assert.match(source, /#\[native_macros::replaced\(41\)\]/u);
  assert.match(source, /missingInReplacedBody\(\)/u);
  verifyMacroProject(project, result.artifacts);
});

test("generated functions retain exact argument types rather than accepting arbitrary source calls", { timeout: 300_000 }, () => {
  const project = createMacroProject("native_generated_type_control", { procedural: true });
  assert.throws(() => compileRustThroughTargetPack({ target: project.target, files: {
    "values.ts": `
      import type { int32 } from "@tsonic/core/types.js";
      import { attribute } from "@tsonic/core/lang.js";
      import { publish } from "@tsonic/rust/crates/native_macros/index.js";
      attribute.module().add(() => publish());
      export function value(input: int32): int32 { return input; }
    `,
    "index.ts": `
      import { generated_value } from "./values.js";
      export function main(): void { generated_value("wrong"); }
    `,
  } }), error => {
    assert.match(error.message, /(?:not assignable|mismatched types)/u);
    assert.doesNotMatch(error.message, /has no exported member/u);
    return true;
  });
  assertMacroProjectUnpublished(project);
});
