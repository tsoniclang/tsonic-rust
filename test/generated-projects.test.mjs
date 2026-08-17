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

function append(values: int32[]): void {
  values.push(5);
}

function populate(values: Map<int32, string>): void {
  values.set(2, "two");
}

function extend(values: Set<int32>): void {
  values.add(8);
}

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
  const xsAlias = xs;
  xsAlias.push(4);
  append(xsAlias);
  check(xs.length === 5);

  const mutating: int32[] = [2];
  check(mutating.push(3, 4) === 3);
  check(mutating.join(",") === "2,3,4");
  check(mutating.unshift(0, 1) === 5);
  check(mutating.join(",") === "0,1,2,3,4");
  const removed = mutating.splice(1, 2, 8, 9);
  check(removed.join(",") === "1,2");
  check(mutating.join(",") === "0,8,9,3,4");
  mutating.fill(6);
  check(mutating.join(",") === "6,6,6,6,6");
  mutating.fill(5, 3);
  check(mutating.join(",") === "6,6,6,5,5");
  mutating.fill(7, 1, 3);
  check(mutating.join(",") === "6,7,7,5,5");
  mutating.copyWithin(3, 0, 2);
  check(mutating.join(",") === "6,7,7,6,7");
  check(mutating.reverse() === mutating);
  check(mutating.join(",") === "7,6,7,7,6");
  check(mutating.sort() === mutating);
  check(mutating.join(",") === "6,6,7,7,7");
  check((mutating.pop() ?? -1) === 7);
  check((mutating.shift() ?? -1) === 6);
  check(mutating.lastIndexOf(7) === 2);
  check(mutating.lastIndexOf(7, -2) === 1);

  const made = Array.of<int32>(10, 20, 30);
  check(made.join("-") === "10-20-30");
  check(Array.from("a😀").join("") === "a😀");
  const unknownArray = JSON.parse("[1]");
  check(Array.isArray(unknownArray));

  const concatLeft: int32[] = [1, 2, 3];
  const concatRight: int32[] = [5];
  const concatenated = concatLeft.concat(4, concatRight);
  check(concatenated.length === 5);
  check(concatenated.join(",") === "1,2,3,4,5");

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
  const mAlias = m;
  populate(mAlias);
  check(m.size === 2);
  check(m.has(1));
  check(m.has(2));
  check(m.get(2) !== undefined);
  check(m.delete(1));
  check(m.size === 1);

  const s = new Set<int32>();
  s.add(7);
  s.add(7);
  const sAlias = s;
  extend(sAlias);
  check(s.size === 2);
  check(s.has(7));
  check(s.has(8));

  const d = new Date(86400000);
  check(d.getTime() === 86400000);

  const projected = { tail: "tail", 10: "ten", 2: "two", "01": "leading" };
  check(Object.keys(projected).join(",") === "2,10,tail,01");
  check(Object.values(projected).join(",") === "two,ten,tail,leading");
  check(Object.entries(projected).length === 4);
  check(Object.hasOwn(projected, "tail"));
  check(!Object.hasOwn(projected, "missing"));
  check(projected.hasOwnProperty("01"));
  const reordered = { "01": "leading", tail: "tail", 2: "two", 10: "ten" };
  check(Object.keys(reordered).join(",") === "2,10,01,tail");
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

test("generated cargo binary proves closed JavaScript string parity", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "string_parity_proof" } },
    files: {
      "index.ts": `
import { check } from "@acme/testing";

export function main(): void {
  check("banana".lastIndexOf("ana") === 3);
  check("abc".lastIndexOf("", 1.9) === 1);
  check("abc".substring(2.9, 0) === "ab");
  check("javascript".substr(-6.9, 3.9) === "scr");
  check("abc".charCodeAt(1) === 98);
  check(Number.isNaN("abc".charCodeAt(9)));
  const pieces = "a,b,c".split(",", 2.9);
  check(pieces.length === 2);
  check((pieces[0] ?? "") === "a");
  check("hello".replace("ll", "[$&][$\`][$']") === "he[ll][he][o]o");
  check("banana".replaceAll("a", "$&$&") === "baanaanaa");
  check("a".concat("b", "c") === "abc");
  check(String.fromCharCode(65.9, 66) === "AB");
  check(String.fromCodePoint(0x1f600) === "😀");
  check("  value  ".trimLeft().trimRight().valueOf() === "value");
}
`,
    },
  });

  assert.deepEqual(result.diagnostics, []);
  const run = validateGeneratedProject("string-parity-bin", result.artifacts, { run: true });
  assert.equal(run.status, 0);
});
