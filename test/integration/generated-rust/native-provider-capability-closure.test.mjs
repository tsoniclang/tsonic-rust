import assert from "node:assert/strict";
import { test } from "node:test";

import {
  acmeTestingPackage,
  artifactText,
  compileRust,
} from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("provider-authored expression macros retain their exact delimiter", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: {
      id: "rust",
      options: { outputType: "bin", crateName: "provider_macro_contract" },
    },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check, sumBraces, sumBrackets, sumParen } from "@acme/testing";

export function main(): void {
  const first: int32 = sumParen(1, 2);
  const second: int32 = sumBrackets(3, 4);
  const third: int32 = sumBraces(5, 6);
  check(first === 3 && second === 7 && third === 11);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /acme_testing::sum_pair!\(1, 2\)/u);
  assert.match(source, /acme_testing::sum_pair!\[3, 4\]/u);
  assert.match(source, /acme_testing::sum_pair! \{5, 6\}/u);
  validateGeneratedProject("provider-macro-contract", result.artifacts, { run: true });
});
