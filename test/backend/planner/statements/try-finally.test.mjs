import assert from "node:assert/strict";
import test from "node:test";

import {
  acmeTestingPackage,
  artifactText,
  compileRust,
} from "../../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../../helpers/cargo-projects.mjs";

test("try regions preserve exact catch/finally and abrupt-completion ordering", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "try_finally_proof" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

function returnThroughFinally(): int32 {
  let marker: int32 = 0;
  try {
    marker = 1;
    return marker;
  } finally {
    marker = 2;
  }
}

function finallyOverridesReturn(): int32 {
  try {
    return 1;
  } finally {
    return 2;
  }
}

function caughtThenFinalized(): int32 {
  let marker: int32 = 0;
  try {
    throw new Error("body");
  } catch (error) {
    marker = 3;
  } finally {
    marker += 4;
  }
  return marker;
}

function loopCompletions(): int32 {
  let index: int32 = 0;
  let finalized: int32 = 0;
  while (index < 4) {
    index += 1;
    try {
      if (index === 1) {
        continue;
      }
      if (index === 3) {
        break;
      }
    } finally {
      finalized += 1;
    }
  }
  return finalized;
}

async function asyncFinally(): Promise<int32> {
  let marker: int32 = 0;
  try {
    await asyncValue(1);
    marker = 5;
    return marker;
  } finally {
    await asyncValue(2);
    marker = 6;
  }
}

async function asyncValue(value: int32): Promise<int32> {
  return value;
}

export async function main(): Promise<void> {
  check(returnThroughFinally() === 1);
  check(finallyOverridesReturn() === 2);
  check(caughtThenFinalized() === 7);
  check(loopCompletions() === 3);
  check((await asyncFinally()) === 5);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /rt::Completion</u);
  assert.match(source, /rt::Completion::Continue/u);
  assert.match(source, /rt::Completion::Break/u);
  assert.match(source, /\(async \{/u);
  const run = validateGeneratedProject("try-finally-proof", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("try without catch propagates the finally failure rather than suppressing it", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function fails(): int32 {
  try {
    throw new Error("body");
  } finally {
    throw new Error("finally");
  }
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /pub fn fails\(\) -> rt::TsonicResult<i32>/u);
  assert.match(source, /rt::finish_finally/u);
  assert.doesNotMatch(source, /finish_resource/u);
});
