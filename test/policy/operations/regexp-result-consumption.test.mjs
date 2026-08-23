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
import { jsstr } from "@tsonic/js/lang.js";
import type { int32 } from "@tsonic/core/types.js";
import type { JsString } from "@tsonic/js/types.js";

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

  const exact: JsString = jsstr("😀");
  check(exact.length === 2);
  check(exact.charAt(0).charCodeAt(0) === 55357);
  const exactExecuted = /(.)/du.exec(exact);
  check(exactExecuted?.[0]?.length === 2);
  check(exactExecuted?.input.length === 2);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /js_abi::regexp_exec_native/u);
  assert.match(source, /js_abi::string_match_regexp_native/u);
  assert.match(source, /js_abi::string_match_all_regexp_native/u);
  assert.match(source, /js_abi::js_string_from_utf8/u);
  assert.match(source, /js_exact_string::char_at/u);
  assert.match(source, /\.exec\(&exact\)/u);
  assert.match(source, /\.len\(\)/u);
  assert.equal(validateGeneratedProject("regexp-result-consumption", result.artifacts, { run: true }).status, 0);
});
