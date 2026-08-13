import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acmeTestingPackage,
  artifactText,
  compileRust,
} from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

test("never remains bottom through provider and project-source calls", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    files: {
      "index.ts": `
import { fail } from "@acme/testing";
import type { int32 } from "@tsonic/core/types.js";

export function terminate(): never {
  return fail("stop");
}

export function choose(flag: boolean): int32 {
  if (flag) {
    return terminate();
  }
  return 42;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /pub fn terminate\(\) -> !/u);
  assert.match(source, /acme_testing::fail\(String::from\("stop"\)\)/u);
  assert.match(source, /pub fn choose\(flag: bool\) -> i32/u);
  assert.match(source, /terminate\(\)/u);
  validateGeneratedProject("never-infallible", result.artifacts);
});

test("throwing sync and async never callables preserve bottom after propagation", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

class Failure {
  stop(message: string): never {
    throw new Error(message);
  }

  choose(flag: boolean): int32 {
    if (flag) {
      return this.stop("sync");
    }
    return 42;
  }
}

async function stopAsync(): Promise<never> {
  throw new Error("async");
}

export async function chooseAsync(flag: boolean): Promise<int32> {
  if (flag) {
    return await stopAsync();
  }
  return new Failure().choose(false);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /fn stop\([^)]*message: String\) -> rt::TsonicResult<\(\)>/u);
  assert.match(source, /\.stop\(String::from\("sync"\)\)\?/u);
  assert.match(source, /unreachable!/u);
  assert.match(source, /async fn stopAsync\(\) -> rt::TsonicResult<\(\)>/u);
  assert.match(source, /stopAsync\(\)\.await\?/u);
  validateGeneratedProject("never-fallible", result.artifacts);
});

test("never is rejected as stored data instead of becoming a generic Rust type", () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
export class InvalidNeverStorage {
  value: never;

  constructor(value: never) {
    this.value = value;
  }
}
`,
    },
  });

  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.code === "RUST_MISSING_TARGET_FACT" &&
    /Class field 'value' has no supported Rust carrier fact/u.test(diagnostic.message)));
  assert.equal(result.artifacts.length, 0);
});
