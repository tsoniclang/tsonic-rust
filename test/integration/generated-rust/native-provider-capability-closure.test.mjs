import assert from "node:assert/strict";
import { test } from "node:test";

import {
  artifactText,
  compileRustThroughTargetPack,
} from "../../helpers/rust-session.mjs";
import { createMacroProject, verifyMacroProject } from "../../helpers/native-macro-project.mjs";

test("native compiler-resolved macros retain their exact delimiter", { timeout: 300_000 }, () => {
  const project = createMacroProject("native_macro_contract");
  const { result } = compileRustThroughTargetPack({
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "native_macro_contract", projectFile: project.manifestPath },
    },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check, sum_pair as sum } from "@tsonic/rust/crates/macro_proofs/index.js";
import { tokens } from "@tsonic/rust/lang.js";

export function main(): void {
  const first: int32 = sum(1, 2);
  const second: int32 = sum([3, 4]);
  const third: int32 = sum(tokens\`{5, 6}\`);
  check(first === 3 && second === 7 && third === 11);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /macro_proofs::sum_pair!\(1, 2\)/u);
  assert.match(source, /macro_proofs::sum_pair!\[3, 4\]/u);
  assert.match(source, /macro_proofs::sum_pair!\s*\{\s*5, 6\s*\}/u);
  verifyMacroProject(project, result.artifacts);
});

test("native macro repetition uses native count and evaluates its element once, including zero", { timeout: 300_000 }, () => {
  const project = createMacroProject("native_macro_repeat");
  const { result } = compileRustThroughTargetPack({
    target: { id: "rust", options: {
      outputType: "bin", crateName: "native_macro_repeat", projectFile: project.manifestPath,
    } },
    files: { "index.ts": `
      import type { int32, nativeUint } from "@tsonic/core/types.js";
      import { check, repeat_sum as repeat } from "@tsonic/rust/crates/macro_proofs/index.js";
      import { tokens } from "@tsonic/rust/lang.js";
      let calls: int32 = 0;
      function next(): int32 { calls += 1; return calls; }
      export function main(): void {
        const count: nativeUint = 3;
        check(repeat(tokens\`[\${next()}; \${count}]\`) === 3);
        check(calls === 1);
        check(repeat(tokens\`[\${next()}; 0]\`) === 0);
        check(calls === 2);
        check(repeat(tokens\`[\${next()}; 1]\`) === 3);
        check(calls === 3);
      }
    ` },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /macro_proofs::repeat_sum!\[[^;]+; count\]/u);
  assert.doesNotMatch(source, /repeat_sum!\[[^;\]]+,/u);
  verifyMacroProject(project, result.artifacts);
});
