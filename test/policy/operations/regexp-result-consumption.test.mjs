import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acmeTestingPackage,
  artifactText,
  compileRust,
} from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("RegExp dense optional captures and indices retain exact nested reads", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
import { jsstr } from "@tsonic/js/lang.js";
let calls = 0;
function needle(): string { calls += 1; return "res"; }
export function main(): void {
  const optional: (string | undefined)[] = [undefined, "present"];
  check(optional?.[0]?.length === undefined);
  check(optional?.[0]?.length !== null);
  check(optional?.[1]?.length === 7);
  check(optional?.[9]?.length === undefined);
  check((optional[0])?.length === undefined);
  check((optional[1])?.length === 7);
  check(optional[0]?.includes(needle()) === undefined);
  check(optional[9]?.includes(needle()) === undefined);
  check(calls === 0);
  check(optional[1]?.includes(needle()) === true);
  check(calls === 1);
  const nullable: (string | null)[] = [null, "present"];
  check(nullable?.[0]?.length === undefined);
  check(nullable?.[0]?.length !== null);
  check(nullable?.[1]?.length === 7);
  const native = /(a)?(b)/d.exec("b");
  check(native?.[1] === undefined);
  check(native?.[2]?.length === 1);
  check(native?.indices?.[0]?.[0] === 0);
  check(native?.indices?.[0]?.[1] === 1);
  check(native?.indices?.[1] === undefined);
  check(native?.indices?.[2]?.[0] === 0);
  check((native?.indices?.[1])?.[0] === undefined);
  check(native?.indices?.[9] === undefined);
  const exact = /(a)?(b)/d.exec(jsstr("b"));
  check(exact?.[1] === undefined);
  check(exact?.[2]?.length === 1);
  check(exact?.indices?.[0]?.[0] === 0);
  check(exact?.indices?.[0]?.[1] === 1);
  check(exact?.indices?.[1] === undefined);
  check(exact?.indices?.[2]?.[0] === 0);
  check(exact?.indices?.[9] === undefined);
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("regexp-dense-optional-indices", result.artifacts, { run: true });
});

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
  const exactReplacement: JsString = exact.replace(
    /./gu,
    (whole, _offset, _input) => whole,
  );
  check(exactReplacement.length === 2);

  const callbackReplacement = "a1".replace(
    /([a-z])(\\d)/,
    (whole, _letter, _digit, _offset, _input) => "[" + whole + "]",
  );
  check(callbackReplacement === "[a1]");
  const allReplacement = "a1b2".replaceAll(
    /\\d/g,
    (whole, _offset, _input) => "[" + whole + "]",
  );
  check(allReplacement === "a[1]b[2]");

  const named = /(?<word>[a-z]+)/.exec("alpha");
  check(named !== null);
  if (named !== null && named.groups !== undefined) {
    check(named.groups["word"] === "alpha");
  }
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
  assert.match(source, /string_try_replace_regexp_native_with/u);
  assert.match(source, /string_try_replace_all_regexp_native_with/u);
  assert.match(source, /string_replace_regexp_with/u);
  assert.match(source, /regexp_named_groups_get_native/u);
  assert.match(source, /\.len\(\)/u);
  assert.equal(validateGeneratedProject("regexp-result-consumption", result.artifacts, { run: true }).status, 0);
});

test("dense optional reads coalesce every absence layer with lazy native fallbacks", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
let fallbackCalls = 0;
function fallback(): string {
  fallbackCalls += 1;
  if (fallbackCalls < 0) throw new Error("unreachable control");
  return "fallback";
}
function optionalFallback(): string | undefined {
  fallbackCalls += 1;
  return undefined;
}
export function main(): void {
  const captures: string[] = [];
  for (const match of "b".matchAll(/(a)?(b)/g)) {
    captures.push(match[1] ?? "missing");
    captures.push(match[2] ?? "missing");
    captures.push(match[99] ?? "missing");
  }
  check(captures.join(",") === "missing,b,missing");
  const optional: (string | undefined)[] = [undefined, "", "present"];
  const nullable: (string | null)[] = [null, "present"];
  const values: string[] = [];
  values.push(optional[0] ?? fallback());
  values.push(optional[1] ?? fallback());
  values.push(optional[99] ?? fallback());
  values.push(nullable[0] ?? fallback());
  values.push(nullable[1] ?? fallback());
  check(values.join(",") === "fallback,,fallback,fallback,present");
  check(fallbackCalls === 3);
  check((optional[2] ?? optionalFallback()) === "present");
  check(fallbackCalls === 3);
  check((optional[0] ?? optionalFallback()) === undefined);
  check(fallbackCalls === 4);
  check((optional[1] ?? undefined) === "");
  check((optional[0] ?? undefined) === undefined);
  check((optional[0] ?? optional[2]) === "present");
  check((optional[0] ?? optional[99]) === undefined);
  check((optional[2] ?? optional[0]) === "present");
  check((nullable[0] ?? null) === null);
  check((nullable[99] ?? null) === null);
  check((nullable[0] ?? nullable[0]) === null);
  check((nullable[0] ?? nullable[1]) === "present");
  const numbers: (number | undefined)[] = [undefined, 0, 7];
  check((numbers[0] ?? 42) === 42);
  check((numbers[1] ?? 42) === 0);
  check((numbers[2] ?? 42) === 7);
  const booleans: (boolean | undefined)[] = [undefined, false];
  check((booleans[0] ?? true) === true);
  check((booleans[1] ?? true) === false);
  check((optional[0] ?? (optional[99])) === undefined);
  check(((optional[99]) ?? "missing") === "missing");
}
` },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactText(result, "src/index.rs"), /\.flatten\(\)/u);
  validateGeneratedProject("dense-optional-coalescing", result.artifacts, { run: true });
});
