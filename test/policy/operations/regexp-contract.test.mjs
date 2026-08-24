import assert from "node:assert/strict";
import test from "node:test";

import {
  artifactText,
  compileRust,
  createRustSession,
  rustSourceDiagnostics,
} from "../../helpers/rust-session.mjs";

test("TSTS rejects invalid authored RegExp literals before Rust planning", () => {
  const harness = createRustSession({
    surfaces: ["js"],
    files: {
      "index.ts": `
export function invalid(value: string): boolean {
  return /[z-a]/.test(value);
}
`,
    },
  });
  const diagnostics = rustSourceDiagnostics(harness, ["/src/index.ts"]);

  assert.match(diagnostics, /TS1517/u);
});

test("dynamic RegExp construction is validated by the complete runtime engine", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
export function dynamic(pattern: string, flags: string, value: string): boolean {
  return new RegExp(pattern, flags).test(value);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /js_abi::regexp_from_string_with_flags_native\(&pattern, &flags\)\?/u);
  assert.match(source, /js_abi::regexp_test_native\(/u);
  assert.doesNotMatch(source, /REGEXP_UNSUPPORTED|subset|validator/u);
});

test("complete ECMAScript RegExp syntax lowers without a target-owned subset", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    compilerOptions: { target: "es2024" },
    files: {
      "index.ts": `
export function complete(value: string): boolean {
  const lookbehind = /(?<=prefix)(?<word>\\p{Letter}+)/dgu;
  const unicodeSets = /[\\p{ASCII}&&\\p{Letter}]/v;
  return lookbehind.test(value) || unicodeSets.test(value);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /regexp_new_native/u);
  assert.match(source, /\(\?<word>/u);
  assert.match(source, /dgu/u);
  assert.match(source, /\\p\{ASCII\}/u);
});

test("native and exact RegExp inputs select distinct result carriers", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import { jsstr } from "@tsonic/js/lang.js";
import type { JsString } from "@tsonic/js/types.js";

export function lanes(value: string): string {
  const native = /./.exec(value);
  const exact: JsString = jsstr(value);
  const exactMatch = /./.exec(exact);
  return (native?.[0] ?? "") + RegExp.escape(exact.charAt(0)) +
    (exactMatch?.[0] ?? exact).toWellFormed();
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /regexp_exec_native/u);
  assert.match(source, /\.exec\(&exact\)\?/u);
  assert.match(source, /regexp_escape_exact_native/u);
  assert.match(source, /js_exact_string::to_well_formed/u);
});
