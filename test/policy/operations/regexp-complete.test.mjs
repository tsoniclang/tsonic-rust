import assert from "node:assert/strict";
import test from "node:test";

import {
  artifactText,
  compileRust,
} from "../../helpers/rust-session.mjs";

test("complete RegExp operations consume selected JS-source-profile evidence", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
        import type { int32 } from "@tsonic/core/types.js";

        export function construct(pattern: string, flags: string): RegExp {
          const dynamic = new RegExp(pattern, flags);
          const called = RegExp(dynamic);
          return new RegExp(called, "dgu");
        }

        export function consume(input: string): string {
          const expression = /(?<word>\\p{Letter}+)(\\d+)?/dgu;
          expression.lastIndex = 2;
          const executed = expression.exec(input);
          const first = executed?.[0] ?? "";
          const named = executed?.groups?.word ?? "";
          const matched = input.match(expression)?.[0] ?? "";
          let count: int32 = 0;
          for (const item of input.matchAll(expression)) {
            count += item.length;
          }
          const replaced = input.replace(
            expression,
            (whole, capture, offset, original, groups) => whole,
          );
          const tokenReplacement = input.replace(/\\d+/g, "[$&]");
          const all = input.replaceAll(/\\d+/g, (whole, ...rest) => whole);
          const searched = input.search(expression);
          const split = input.split(expression, 3);
          return RegExp.escape(first) + named + matched + replaced + tokenReplacement + all +
            count.toString() + searched.toString() + split.length.toString();
        }
      `,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /js_abi::JsRegExp::new/u);
  assert.match(source, /call_from_regexp/u);
  assert.match(source, /construct_from_regexp_with_flags/u);
  assert.match(source, /match_result/u);
  assert.match(source, /match_all_for_string/u);
  assert.match(source, /replace_with/u);
  assert.match(source, /replace_all_for_string_with/u);
  assert.match(source, /replacement_arguments/u);
  assert.match(source, /JsRegExp::escape/u);
});

test("custom well-known RegExp protocols dispatch through exact structural facts", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
        export function protocols(input: string): string {
          const matcher = {
            [Symbol.match](value: string): RegExpMatchArray | null {
              return /a/.exec(value);
            },
          };
          const searcher = {
            [Symbol.search](_value: string): number { return 7; },
          };
          const replacer = {
            [Symbol.replace](_value: string, replacement: string): string {
              return replacement;
            },
          };
          const splitter = {
            [Symbol.split](value: string, _limit?: number): string[] {
              return [value];
            },
          };
          return (input.match(matcher)?.[0] ?? "") + input.search(searcher).toString() +
            input.replace(replacer, "x") + input.split(splitter)[0];
        }
      `,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /symbol_match/u);
  assert.match(source, /symbol_search/u);
  assert.match(source, /symbol_replace/u);
  assert.match(source, /symbol_split/u);
  assert.doesNotMatch(source, /regexp_protocol.*"match"/u);
});

test("same-spelled project members never acquire RegExp runtime identity", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
        class Local {
          replace(_input: string, _value: string): string { return "local"; }
          search(_input: string): number { return 9; }
        }
        export function local(): string {
          const value = new Local();
          return value.replace("a", "b") + value.search("a").toString();
        }
      `,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /Local::new/u);
  assert.doesNotMatch(source, /JsRegExp/u);
  assert.doesNotMatch(source, /js_string::replace/u);
});
