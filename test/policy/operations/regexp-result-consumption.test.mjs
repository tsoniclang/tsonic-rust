import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acmeTestingPackage,
  artifactText,
  compileRust,
} from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("RegExp exec, match, and matchAll results remain consumable", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "regexp_result_consumption" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

export function main(): void {
  const executed = /(a)(\\d+)/g.exec("xa12");
  check(executed?.index === 1);
  check(executed?.input === "xa12");
  check(executed?.length === 3);

  const matched = "za7".match(/(a)(\\d+)/);
  check(matched?.index === 1);
  check(matched?.input === "za7");
  check(matched?.length === 3);

  let count: int32 = 0;
  for (const item of "a1 b22".matchAll(/(\\d+)/g)) {
    check(item.input === "a1 b22");
    check(item.length === 2);
    count += 1;
  }
  check(count === 2);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /\.exec\(&js_abi::JsString::from\("xa12"\)\)\?/u);
  assert.match(source, /\.match_result\(&js_abi::JsString::from\("za7"\)\)\?/u);
  assert.match(source, /\.match_all_for_string\(&js_abi::JsString::from\("a1 b22"\)\)\?/u);
  assert.match(source, /item\.input\(\) == "a1 b22"/u);
  assert.match(source, /\.len\(\)/u);
  assert.equal(validateGeneratedProject("regexp-result-consumption", result.artifacts, { run: true }).status, 0);
});
