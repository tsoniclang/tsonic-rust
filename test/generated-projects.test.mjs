import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acmeFilesPackage,
  acmePlatformPackage,
  acmeTestingPackage,
  compileRust,
} from "./helpers/rust-session.mjs";
import { validateGeneratedProject } from "./helpers/cargo-projects.mjs";

test("generated cargo library builds, formats, and tests clean", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { clamp } from "./math_utils.js";

export function add(a: int32, b: int32): int32 {
  return a + b;
}

export function abs(value: int32): int32 {
  if (value < 0) {
    return -value;
  }
  return value;
}

export function total(limit: int32): int32 {
  let sum: int32 = 0;
  for (let i: int32 = 0; i < limit; i++) {
    sum = sum + clamp(i, limit);
  }
  return sum;
}
`,
      "math_utils.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function clamp(value: int32, max: int32): int32 {
  if (value > max) {
    return max;
  }
  return value;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("static-native-lib", result.artifacts);
});

test("generated cargo binary runs static-native and provider behavior end to end", { timeout: 300_000 }, () => {
  const packages = [acmeFilesPackage(), acmeTestingPackage(), acmePlatformPackage()];
  const { result } = compileRust({
    packages,
    target: { id: "rust", options: { outputType: "bin", crateName: "r2_proof" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { readText } from "@acme/files";
import { check } from "@acme/testing";
import { Env, Store } from "@acme/platform";
import { add, abs } from "./math.js";

export function main(): void {
  check(add(2, 3) === 5);
  check(abs(-4) === 4);
  let total: int32 = 0;
  for (let i: int32 = 0; i < 5; i++) {
    total = total + i;
  }
  check(total === 10);
  let n: int32 = 3;
  while (n > 0) {
    n--;
  }
  check(n === 0);
  const text: string = readText("data.txt");
  check(text === "content:data.txt");
  const combined: string = "a" + "b";
  check(combined === "ab");
  check(Env.homeDir === "/home/acme");
  const store = new Store("seed");
  check(store.count === 4);
  check(store[2] === 6);
}
`,
      "math.ts": `
import type { int32 } from "@tsonic/core/types.js";

export function add(a: int32, b: int32): int32 {
  return a + b;
}

export function abs(value: int32): int32 {
  if (value < 0) {
    return -value;
  }
  return value;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const paths = result.artifacts.map((artifact) => artifact.path);
  assert.ok(paths.includes("src/main.rs"));
  const run = validateGeneratedProject("static-native-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});
