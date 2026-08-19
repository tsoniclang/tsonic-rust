// The compile-time RegExp validator must EQUAL the rust-js runtime parser
// contract. The shared, engine-generated corpus at
// rust-js/tests/oracle/regexp-acceptance-corpus.json records JsRegExp::new's
// construction-time verdict for every pattern/flags pair; the validator's
// acceptance decision is asserted against every entry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rustRegExpSubsetViolation } from "../../../dist/policy/regexp/subset.js";
import {
  artifactText,
  assertRustTargetRejection,
  compileRust,
} from "../../helpers/rust-session.mjs";

const corpusPath = fileURLToPath(
  new URL("../../../../rust-js/tests/oracle/regexp-acceptance-corpus.json", import.meta.url),
);
const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));

test("corpus is engine-generated and non-trivial", () => {
  assert.ok(Array.isArray(corpus));
  assert.ok(corpus.length >= 100, `corpus has ${corpus.length} entries`);
  assert.ok(corpus.some((entry) => entry.accepted === true));
  assert.ok(corpus.some((entry) => entry.accepted === false));
});

test("compile-time validator equals the engine acceptance on every corpus entry", () => {
  for (const entry of corpus) {
    const { pattern, flags, accepted } = entry;
    const violation = rustRegExpSubsetViolation(pattern, flags);
    if (accepted) {
      assert.equal(
        violation,
        undefined,
        `validator rejects /${pattern}/${flags} (\`${violation}\`) but the engine accepts it`,
      );
    } else {
      assert.notEqual(
        violation,
        undefined,
        `validator accepts /${pattern}/${flags} but the engine rejects it (\`${entry.reason}\`)`,
      );
    }
  }
});

test("validator violation text matches the engine rejection reason on every corpus entry", () => {
  for (const entry of corpus) {
    if (entry.accepted) {
      continue;
    }
    assert.equal(
      rustRegExpSubsetViolation(entry.pattern, entry.flags),
      entry.reason,
      `violation text drifted for /${entry.pattern}/${entry.flags}`,
    );
  }
});

// Reviewer probes: each engine-rejected pattern must fail closed at compile
// time even when constructed inside a try block.
const rejectedProbes = [
  "{",
  "}",
  "+a",
  "^*",
  "a{1001}",
  "a{2,1}",
  "a{1,2}?",
  "[z-a]",
  "[\\d-x]",
  "[a-\\n]",
  "\\e",
  "\\A",
  "\\01",
];

test("reviewer probes fail closed as compiled constants", () => {
  for (const probe of rejectedProbes) {
    const literal = JSON.stringify(probe);
    const options = {
      surfaces: ["js"],
      files: {
        "index.ts": `
export function f(s: string): boolean {
  try {
    const re = new RegExp(${literal});
    return re.test(s);
  } catch {
    return false;
  }
}
`,
      },
    };
    const violation = rustRegExpSubsetViolation(probe, "");
    assert.notEqual(violation, undefined, `new RegExp(${literal}) must violate the runtime oracle contract`);
    assertRustTargetRejection(options, [{
      code: "RUST_REGEXP_UNSUPPORTED",
      message: violation,
    }]);
  }
});

test("backspace class [\\b] compiles clean", () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
export function probe(text: string): boolean {
  const re = /[\\b]/;
  return re.test(text);
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.artifacts.length > 0);
  assert.match(artifactText(result, "src/index.rs"), /JsRegExp::new\("\[\\\\b\]", ""\)\?/u);
});
