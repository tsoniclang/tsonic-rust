import { test } from "node:test";
import assert from "node:assert/strict";
import { compileRust, nodejsCapability } from "../helpers/rust-session.mjs";

test("capability ledger: supported lanes compile a representative program", async () => {
  const { result } = compileRust({
    surfaces: ["js"],
    capabilities: [await nodejsCapability()],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import { join } from "node:path";

export interface Point {
  x: int32;
  y: int32;
}

export type Mode = "off" | "on";

export enum Level {
  Low,
  High = 9,
}

export class Counter {
  value: int32;

  constructor(value: int32) {
    this.value = value;
  }

  add(delta: int32): int32 {
    this.value += delta;
    return this.value;
  }
}

export function sum(xs: readonly int32[]): int32 {
  let total: int32 = 0;
  for (const x of xs) {
    total += x;
  }
  return total;
}

export function main_lane(flag: boolean): int32 {
  const point: Point = { x: 1, y: 2 };
  const values: int32[] = [1, 2, 3];
  const entry: [int32, string] = [5, join("a", "b")];
  const counter = new Counter(point.x);
  const mode: Mode = "on";
  let result: int32 = sum(values) + entry[0] + counter.add(point.y);
  if (flag && mode === "on" && Level.High === Level.High) {
    result += 1;
  }
  return result;
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.artifacts.length > 0);
});
