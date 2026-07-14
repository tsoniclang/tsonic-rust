import { test } from "node:test";
import assert from "node:assert/strict";
import { compileRust, createRustSession, nodejsCapability, rustSourceDiagnostics } from "./helpers/rust-session.mjs";

// Capability ledger: every unsupported lane must diagnose deterministically.
// Rows name the capability, a minimal repro, and the required behavior.
const unsupportedLanes = [
  {
    capability: "rust.backend.statement (switch)",
    files: { "index.ts": "export function f(x: number): number {\n  switch (x) {\n    default:\n      return x;\n  }\n}\n" },
  },
  {
    capability: "discriminated object unions (require narrowing facts)",
    files: { "index.ts": "export type Shape = { kind: \"circle\"; radius: number } | { kind: \"square\"; size: number };\nexport function make(): Shape {\n  return { kind: \"circle\", radius: 1 };\n}\n" },
  },
  {
    capability: "RegExp constructs outside the oracle-proven subset",
    surfaces: ["js"],
    files: { "index.ts": "export function f(text: string): boolean {\n  const pattern = /x(?=y)/;\n  return pattern.test(text);\n}\n" },
    finalizedDiagnostic: {
      code: "RUST_REGEXP_UNSUPPORTED",
      message: "RegExp construct outside the oracle-proven subset: lookahead `(?=` is not supported.",
    },
  },
  {
    capability: "undefined unions without js surface",
    files: { "index.ts": "import type { int32 } from \"@tsonic/core/types.js\";\nexport function f(value: int32 | undefined): int32 {\n  return value ?? 0;\n}\n" },
    sourceDiagnostic: /Checked nullish coalescing requires an Option carrier/u,
  },
];

for (const lane of unsupportedLanes) {
  test(`unsupported lane stays fail-closed: ${lane.capability}`, async () => {
    if (lane.finalizedDiagnostic !== undefined) {
      const { result } = compileRust({
        files: lane.files,
        ...(lane.surfaces === undefined ? {} : { surfaces: lane.surfaces }),
      });
      assert.deepEqual(result.artifacts, []);
      assert.deepEqual(result.diagnostics.map(({ code, message }) => ({ code, message })), [lane.finalizedDiagnostic]);
      return;
    }
    if (lane.sourceDiagnostic !== undefined) {
      const options = {
        files: lane.files,
        ...(lane.surfaces === undefined ? {} : { surfaces: lane.surfaces }),
      };
      const diagnostics = rustSourceDiagnostics(createRustSession(options), ["/src/index.ts"]);
      assert.match(diagnostics, lane.sourceDiagnostic);
      assert.throws(() => compileRust(options), /TypeScript diagnostics:/u);
      return;
    }
    const { result } = compileRust({
      files: lane.files,
      ...(lane.surfaces === undefined ? {} : { surfaces: lane.surfaces }),
    });
    assert.equal(result.artifacts.length, 0, "unsupported lanes must not emit artifacts");
    assert.ok(result.diagnostics.length > 0, "unsupported lanes must diagnose");
    assert.ok(result.diagnostics.every((diagnostic) =>
      typeof diagnostic.code === "string" && diagnostic.code.startsWith("RUST_")));
  });
}

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
