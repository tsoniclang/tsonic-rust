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

test("generated cargo binary proves JS surface lanes at runtime", { timeout: 300_000 }, () => {
  const packages = [acmeTestingPackage()];
  const { result } = compileRust({
    packages,
    surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "r3_js_proof" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

export function main(): void {
  const xs: int32[] = [1, 2, 3];
  let total: int32 = 0;
  for (const value of xs) {
    total += value;
  }
  check(total === 6);
  check(xs.length === 3);
  check(xs.includes(2));
  check(xs.indexOf(3) === 2);

  const values = [1, , 3];
  values.length = 5;
  values[3] = 4;
  check(values.length === 5);
  check(values.at(-1) === undefined);
  check(values.at(-2) !== undefined);
  check(values[1] === undefined);
  check(values[3] !== undefined);

  const name: string = "tsonic";
  check(name.length === 6);
  check(name.toUpperCase() === "TSONIC");
  check(name.includes("son"));
  check(name.startsWith("tso"));

  const m = new Map<int32, string>();
  m.set(1, "one");
  m.set(1, "uno");
  check(m.size === 1);
  check(m.has(1));
  check(m.get(2) === undefined);
  check(m.delete(1));
  check(m.size === 0);

  const s = new Set<int32>();
  s.add(7);
  s.add(7);
  check(s.size === 1);
  check(s.has(7));

  const d = new Date(86400000);
  check(d.getTime() === 86400000);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const run = validateGeneratedProject("js-surface-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("generated cargo binary proves R4b semantic lanes at runtime", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "r4b_proof" } },
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";

export interface Point {
  x: int32;
  y: int32;
}

export type Mode = "off" | "on";

export class Box {
  size: int32;

  constructor(size: int32) {
    this.size = size;
  }

  static unit(): Box {
    return new Box(1);
  }
}

export function pass_through<T>(value: T): T {
  return value;
}

export function value_or_zero(value: int32 | null): int32 {
  return value ?? 0;
}

export function main(): void {
  const p: Point = { x: 3, y: 4 };
  const shifted: Point = { x: p.x + 1, y: p.y };
  check(shifted.x === 4);
  check(shifted.y === 4);

  const entry: [int32, string] = [7, "seven"];
  check(entry[0] === 7);

  const mode: Mode = "on";
  check(mode === "on");
  check(pass_through(3) === 3);

  check(value_or_zero(5) === 5);
  check(value_or_zero(null) === 0);

  const unit_box = Box.unit();
  check(unit_box.size === 1);
  check(pass_through(41) + 1 === 42);
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const run = validateGeneratedProject("r4b-lanes-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});

test("generated cargo library proves the async lane compiles clean", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";

export async function fetch_value(seed: int32): Promise<int32> {
  return seed + 1;
}

export async function drive(): Promise<int32> {
  const value = await fetch_value(41);
  return value;
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("r4b-async-lib", result.artifacts);
});
